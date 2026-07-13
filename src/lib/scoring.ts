import type { SupabaseClient } from '@supabase/supabase-js';

export type ShotLite = {
  pins_standing: number[] | null;
  strike: boolean;
  spare: boolean;
  foul?: boolean;
};

export type FrameLite = {
  frame_number: number;
  shots: ShotLite[];
};

/** Knocked-pin count for a roll plus whether the delivery was fouled. */
export type Roll = { knocked: number; foul: boolean };

/**
 * Per-roll pinfall for a single frame's shots, derived from per-shot pin state.
 * Pinfall for a roll is (pins standing before) - (pins standing after); the rack
 * resets to 10 after any roll that clears it. A fouled delivery counts zero
 * regardless of pins knocked down (USBC), and respots the full rack for the next
 * ball in the frame -- so a first-ball foul leaves 10 standing for ball 2.
 */
function frameRollsDetailed(shots: ShotLite[]): Roll[] {
  const rolls: Roll[] = [];
  let priorStanding = 10;
  for (const shot of shots) {
    const standingAfter = shot.pins_standing?.length ?? 0;
    const foul = shot.foul ?? false;
    const knocked = foul ? 0 : shot.strike ? 10 : Math.max(0, Math.min(10, priorStanding - standingAfter));
    rolls.push({ knocked, foul });
    // a foul respots the rack (pins knocked by a foul ball don't stay down)
    priorStanding = foul || standingAfter === 0 ? 10 : standingAfter;
  }
  return rolls;
}

/**
 * Derives a standard ten-pin score from per-shot pin state. Each shot's
 * pins_standing is the full state of the rack after that shot, so pinfall
 * for a roll is (pins standing before) - (pins standing after). The rack
 * resets to 10 whenever a prior roll in the same frame cleared it (a
 * strike, or the ball that completes a spare) -- this only matters for the
 * bonus rolls in frame 10.
 *
 * Returns null if any of frames 1-10 is missing, or if there isn't enough
 * roll data yet to resolve a strike/spare bonus (i.e. scoring isn't fully
 * determined until later frames are logged).
 */
export function computeDerivedScore(frames: FrameLite[]): number | null {
  const byNumber = new Map(frames.map((f) => [f.frame_number, f]));
  for (let n = 1; n <= 10; n++) {
    const frame = byNumber.get(n);
    if (!frame || frame.shots.length === 0) return null;
  }

  const frameRolls: number[][] = [];
  const flatRolls: number[] = [];

  for (let n = 1; n <= 10; n++) {
    const frame = byNumber.get(n)!;
    const rolls = frameRollsDetailed(frame.shots).map((r) => r.knocked);
    frameRolls.push(rolls);
    flatRolls.push(...rolls);
  }

  const frameStartIndex: number[] = [];
  let flatIndex = 0;
  for (let n = 1; n <= 10; n++) {
    frameStartIndex.push(flatIndex);
    flatIndex += frameRolls[n - 1].length;
  }

  let total = 0;

  for (let n = 1; n <= 9; n++) {
    const rolls = frameRolls[n - 1];
    const start = frameStartIndex[n - 1];
    const isStrike = rolls[0] === 10;
    const isSpare = !isStrike && rolls.length >= 2 && rolls[0] + rolls[1] === 10;

    if (isStrike) {
      const bonus1 = flatRolls[start + 1];
      const bonus2 = flatRolls[start + 2];
      if (bonus1 === undefined || bonus2 === undefined) return null;
      total += 10 + bonus1 + bonus2;
    } else if (isSpare) {
      const bonus1 = flatRolls[start + 2];
      if (bonus1 === undefined) return null;
      total += 10 + bonus1;
    } else {
      if (rolls.length < 2) return null;
      total += rolls[0] + rolls[1];
    }
  }

  const tenRolls = frameRolls[9];
  const firstIsStrike = tenRolls[0] === 10;
  const firstTwoSpare = !firstIsStrike && tenRolls.length >= 2 && tenRolls[0] + tenRolls[1] === 10;

  if (firstIsStrike || firstTwoSpare) {
    if (tenRolls.length < 3) return null;
  } else if (tenRolls.length < 2) {
    return null;
  }

  total += tenRolls.reduce((a, b) => a + b, 0);

  return total;
}

export async function fetchDerivedScoreForGame(
  supabase: SupabaseClient,
  gameId: string,
): Promise<number | null> {
  const { data: frames } = await supabase
    .from('frames')
    .select('frame_number, shots(pins_standing, strike, spare, foul, created_at)')
    .eq('game_id', gameId)
    .order('frame_number', { ascending: true })
    .order('created_at', { foreignTable: 'shots', ascending: true });

  if (!frames) return null;
  return computeDerivedScore(frames as unknown as FrameLite[]);
}

/**
 * Derived scores for many games in a single round-trip (bulk version of
 * fetchDerivedScoreForGame). Fetches every frame+shot for the given games at
 * once, groups by game, and scores each in memory -- avoiding the per-game N+1
 * that made the stats page slow. Every requested id gets an entry (null when the
 * game has no resolvable score yet). Chunked so a huge id list stays within
 * PostgREST's URL length limit.
 */
export async function fetchDerivedScoresForGames(
  supabase: SupabaseClient,
  gameIds: string[],
): Promise<Map<string, number | null>> {
  const result = new Map<string, number | null>();
  if (gameIds.length === 0) return result;

  const CHUNK = 200;
  for (let i = 0; i < gameIds.length; i += CHUNK) {
    const chunk = gameIds.slice(i, i + CHUNK);
    const { data: frames } = await supabase
      .from('frames')
      .select('game_id, frame_number, shots(pins_standing, strike, spare, foul, created_at)')
      .in('game_id', chunk)
      .order('frame_number', { ascending: true })
      .order('created_at', { foreignTable: 'shots', ascending: true });

    const framesByGame = new Map<string, FrameLite[]>();
    for (const frame of (frames ?? []) as any[]) {
      const list = framesByGame.get(frame.game_id) ?? [];
      list.push(frame as FrameLite);
      framesByGame.set(frame.game_id, list);
    }

    for (const id of chunk) {
      const gameFrames = framesByGame.get(id);
      result.set(id, gameFrames ? computeDerivedScore(gameFrames) : null);
    }
  }

  return result;
}

/**
 * Knocked-pin count for each roll in a single frame, derived from per-shot
 * pin state (the same rule computeScoresheet uses). The rack resets to 10
 * after any roll that clears it (or is fouled), which only matters for the
 * 10th frame's bonus balls. A fouled delivery counts zero.
 */
export function computeFrameRolls(shots: ShotLite[]): number[] {
  return frameRollsDetailed(shots).map((r) => r.knocked);
}

export type FrameProgress = {
  count: number; // shots logged so far
  complete: boolean; // frame is fully bowled per ten-pin rules
  canAdd: boolean; // another roll is allowed (always the inverse of complete)
  nextBall: number | null; // 1-based ordinal of the next expected ball, null once complete
};

/**
 * Where a frame stands, reusing the scoresheet's roll logic. A strike completes
 * frames 1-9 in a single ball, so once a frame is `complete` no further shot is
 * allowed -- to add a second ball to a struck frame you must first edit the
 * strike away. In the 10th a third ball opens up only when a strike or spare
 * earns it.
 */
export function frameProgress(frameNumber: number, shots: ShotLite[]): FrameProgress {
  const rolls = computeFrameRolls(shots);
  const count = shots.length;

  let complete: boolean;
  if (frameNumber < 10) {
    const strike = count >= 1 && rolls[0] === 10;
    complete = strike || count >= 2;
  } else {
    // tenth frame: a third ball only when the first two earn it (strike or spare)
    const [r0, r1] = rolls;
    const firstStrike = r0 === 10;
    const spare = !firstStrike && r0 !== undefined && r1 !== undefined && r0 + r1 === 10;
    complete = count >= (firstStrike || spare ? 3 : 2);
  }

  return { count, complete, canAdd: !complete, nextBall: complete ? null : count + 1 };
}

export type AllowedMarks = { strike: boolean; spare: boolean };

/**
 * Which of the Strike / Spare shortcuts are legal for the *next* ball in a frame,
 * given the shots logged so far. A strike is clearing a full fresh rack, so it is
 * only offered on the frame's first ball -- or, in the 10th, on a later ball that
 * faces a respotted fresh rack (after a strike, spare, or foul). A spare is
 * clearing pins a previous ball in the frame left standing, so it needs a prior
 * ball and is never the first ball (a gutter-then-clear still counts as a spare).
 * Mirrors the rack-reset rule in frameRollsDetailed / computeScoresheet.
 */
export function allowedMarks(frameNumber: number, shots: ShotLite[]): AllowedMarks {
  // pins the next ball will face (10 = fresh rack), applying the respot rule
  let priorStanding = 10;
  for (const shot of shots) {
    const standingAfter = shot.pins_standing?.length ?? 0;
    const cleared = (shot.foul ?? false) || shot.strike || standingAfter === 0;
    priorStanding = cleared ? 10 : standingAfter;
  }

  const ballIndex = shots.length; // 0-based index of the ball about to be thrown
  const freshRack = priorStanding === 10;

  const strike = freshRack && (ballIndex === 0 || frameNumber === 10);
  const spare = ballIndex >= 1 && !strike;

  return { strike, spare };
}

/**
 * The earliest frame (1-10) that is not yet fully bowled, so opening a game lands
 * you where you left off. Falls back to 10 once every frame is complete.
 */
export function earliestIncompleteFrame(frames: FrameLite[]): number {
  const byNumber = new Map(frames.map((f) => [f.frame_number, f]));
  for (let n = 1; n <= 10; n++) {
    const shots = byNumber.get(n)?.shots ?? [];
    if (!frameProgress(n, shots).complete) return n;
  }
  return 10;
}

export async function fetchEarliestIncompleteFrame(
  supabase: SupabaseClient,
  gameId: string,
): Promise<number> {
  const { data: frames } = await supabase
    .from('frames')
    .select('frame_number, shots(pins_standing, strike, spare, foul, created_at)')
    .eq('game_id', gameId)
    .order('frame_number', { ascending: true })
    .order('created_at', { foreignTable: 'shots', ascending: true });

  return earliestIncompleteFrame((frames ?? []) as unknown as FrameLite[]);
}

export type BallKind = 'strike' | 'spare' | 'pins' | 'foul' | 'empty';
export type BallMark = { text: string; kind: BallKind };
export type FrameCell = {
  frameNumber: number;
  balls: BallMark[]; // 2 boxes for frames 1-9, 3 for the 10th
  cumulative: number | null; // running total through this frame, null until resolvable
  bowled: boolean;
};

/**
 * Builds a standard ten-pin scoresheet from per-shot pin state: the display
 * mark for each ball (X / spare / pin count / miss), plus the cumulative
 * running total through each frame. Unlike computeDerivedScore this is
 * best-effort and partial -- it renders whatever has been logged so far and
 * leaves a frame's cumulative null until its strike/spare bonus resolves.
 */
export function computeScoresheet(frames: FrameLite[]): FrameCell[] {
  const byNumber = new Map(frames.map((f) => [f.frame_number, f]));

  // knocked-pin count + foul flag per roll, per frame 1..10 (empty if not bowled)
  const frameRolls: number[][] = [];
  const frameFouls: boolean[][] = [];
  for (let n = 1; n <= 10; n++) {
    const frame = byNumber.get(n);
    const detailed = frame ? frameRollsDetailed(frame.shots) : [];
    frameRolls.push(detailed.map((r) => r.knocked));
    frameFouls.push(detailed.map((r) => r.foul));
  }

  // flattened rolls (in frame order) + each frame's start index, for bonus lookups
  const flatRolls: number[] = [];
  const frameStartIndex: number[] = [];
  for (let n = 1; n <= 10; n++) {
    frameStartIndex.push(flatRolls.length);
    flatRolls.push(...frameRolls[n - 1]);
  }

  const ball = (text: string, kind: BallKind): BallMark => ({ text, kind });
  const pinBall = (n: number) => ball(n === 0 ? '-' : String(n), 'pins');
  const foulBall = ball('F', 'foul');
  const empty = ball('', 'empty');

  function marks(n: number): BallMark[] {
    const r = frameRolls[n - 1];
    const f = frameFouls[n - 1];
    if (n < 10) {
      if (r.length === 0) return [empty, empty];
      if (!f[0] && r[0] === 10) return [ball('X', 'strike'), empty];
      const m0 = f[0] ? foulBall : pinBall(r[0]);
      if (r.length < 2) return [m0, empty];
      // a first-ball foul respots the rack, so ball 2 clearing all 10 is a spare (0 + 10)
      const m1 = f[1] ? foulBall : r[0] + r[1] === 10 ? ball('/', 'spare') : pinBall(r[1]);
      return [m0, m1];
    }
    // tenth frame: up to three balls; a strike or foul respots a fresh rack for
    // the next ball. Spare notation uses the two balls sharing a rack.
    const out: BallMark[] = [empty, empty, empty];
    const [r0, r1, r2] = r;
    if (r0 !== undefined) out[0] = f[0] ? foulBall : r0 === 10 ? ball('X', 'strike') : pinBall(r0);
    if (r1 !== undefined) {
      if (f[1]) out[1] = foulBall;
      else if (r0 === 10) out[1] = r1 === 10 ? ball('X', 'strike') : pinBall(r1); // fresh rack after ball 1 strike
      else out[1] = r0 + r1 === 10 ? ball('/', 'spare') : pinBall(r1); // completes (or fails) the opening pair
    }
    if (r2 !== undefined) {
      if (f[2]) out[2] = foulBall;
      // ball 2 left a fresh rack (its own strike, or a foul respot) -> ball 3 stands alone
      else if (r1 === 10 || f[1]) out[2] = r2 === 10 ? ball('X', 'strike') : pinBall(r2);
      else if (r0 === 10) out[2] = r1 + r2 === 10 ? ball('/', 'spare') : pinBall(r2); // ball 2 opened after a strike
      else out[2] = r2 === 10 ? ball('X', 'strike') : pinBall(r2); // fresh rack after an opening-pair spare
    }
    return out;
  }

  const cumulatives: (number | null)[] = new Array(10).fill(null);
  let running = 0;
  let resolvable = true;
  for (let n = 1; n <= 9 && resolvable; n++) {
    const r = frameRolls[n - 1];
    const start = frameStartIndex[n - 1];
    if (r.length === 0) { resolvable = false; break; }
    const isStrike = r[0] === 10;
    const isSpare = !isStrike && r.length >= 2 && r[0] + r[1] === 10;
    if (isStrike) {
      const b1 = flatRolls[start + 1];
      const b2 = flatRolls[start + 2];
      if (b1 === undefined || b2 === undefined) { resolvable = false; break; }
      running += 10 + b1 + b2;
    } else if (isSpare) {
      const b1 = flatRolls[start + 2];
      if (b1 === undefined) { resolvable = false; break; }
      running += 10 + b1;
    } else {
      if (r.length < 2) { resolvable = false; break; }
      running += r[0] + r[1];
    }
    cumulatives[n - 1] = running;
  }
  if (resolvable) {
    const r = frameRolls[9];
    const firstStrike = r[0] === 10;
    const firstTwoSpare = !firstStrike && r.length >= 2 && r[0] + r[1] === 10;
    const complete = firstStrike || firstTwoSpare ? r.length >= 3 : r.length >= 2;
    if (r.length > 0 && complete) {
      running += r.reduce((a, b) => a + b, 0);
      cumulatives[9] = running;
    }
  }

  const cells: FrameCell[] = [];
  for (let n = 1; n <= 10; n++) {
    cells.push({
      frameNumber: n,
      balls: marks(n),
      cumulative: cumulatives[n - 1],
      bowled: frameRolls[n - 1].length > 0,
    });
  }
  return cells;
}

export async function fetchScoresheetForGame(
  supabase: SupabaseClient,
  gameId: string,
): Promise<FrameCell[]> {
  const { data: frames } = await supabase
    .from('frames')
    .select('frame_number, shots(pins_standing, strike, spare, foul, created_at)')
    .eq('game_id', gameId)
    .order('frame_number', { ascending: true })
    .order('created_at', { foreignTable: 'shots', ascending: true });

  return computeScoresheet((frames ?? []) as unknown as FrameLite[]);
}
