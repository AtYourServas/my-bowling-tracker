import type { SupabaseClient } from '@supabase/supabase-js';

export type ShotLite = {
  pins_standing: number[] | null;
  strike: boolean;
  spare: boolean;
};

export type FrameLite = {
  frame_number: number;
  shots: ShotLite[];
};

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
    const rolls: number[] = [];
    let priorStanding = 10;

    for (const shot of frame.shots) {
      const standingAfter = shot.pins_standing?.length ?? 0;
      const knocked = shot.strike ? 10 : Math.max(0, Math.min(10, priorStanding - standingAfter));
      rolls.push(knocked);
      priorStanding = standingAfter === 0 ? 10 : standingAfter;
    }

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
    .select('frame_number, shots(pins_standing, strike, spare, created_at)')
    .eq('game_id', gameId)
    .order('frame_number', { ascending: true })
    .order('created_at', { foreignTable: 'shots', ascending: true });

  if (!frames) return null;
  return computeDerivedScore(frames as unknown as FrameLite[]);
}
