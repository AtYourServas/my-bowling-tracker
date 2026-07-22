import type { SupabaseClient } from '@supabase/supabase-js';
import { fetchDerivedScoresForGames, frameProgress, computeFrameRolls, FULL_RACK } from './scoring';
import { isSplit, leaveDisplayName, sortedLeave } from './leaves';
import type { SessionForHandicap, SessionHandicapResolver } from './handicap';
import { laneForFrame, type LaneConfig } from './lanes';

export type ScoredGame = {
  gameId: string;
  score: number;
  sessionId: string;
  sessionDate: string;
  sessionType: string;
  isPractice: boolean;
  leagueId: string | null;
  manualHandicap: number | null;
  laneCondition: string | null;
};

export type StatsFilter = {
  /** Include games from standalone practice sessions, not just league sessions. */
  includePracticeSessions: boolean;
  /** Narrow every stat to one league's sessions; null/undefined = all leagues. */
  leagueId?: string | null;
};

/**
 * Every game ever logged with a resolvable score (final_score, falling back to a
 * derived score), including is_warmup games and practice-session games. Scores
 * are derived in a single bulk pass rather than one query per game. Callers slice
 * this down in memory: filterScoredGames for averages, the full list for all-time
 * "best game"/"best series" bragging-rights stats.
 */
export async function fetchAllGamesWithScores(supabase: SupabaseClient): Promise<ScoredGame[]> {
  const { data: games } = await supabase
    .from('games')
    .select('id, final_score, session_id, is_warmup, ended_early, sessions(session_date, lane_condition_notes, session_type, league_id, manual_handicap)');

  if (!games) return [];

  const derivedByGame = await fetchDerivedScoresForGames(
    supabase,
    (games as any[]).map((g) => g.id),
  );

  const results: ScoredGame[] = [];
  for (const game of games as any[]) {
    // a game ended early on purpose (partial-score practice) never counts
    // toward averages/bests/handicap trend -- it still bowled real shots, so
    // shot-level rate stats (strike%, spare%, carry) are unaffected
    if (game.ended_early) continue;
    const score = game.final_score ?? derivedByGame.get(game.id) ?? null;
    if (score == null) continue;
    results.push({
      gameId: game.id,
      score,
      sessionId: game.session_id,
      sessionDate: game.sessions.session_date,
      sessionType: game.sessions.session_type,
      isPractice: game.is_warmup,
      leagueId: game.sessions.league_id,
      manualHandicap: game.sessions.manual_handicap,
      laneCondition: game.sessions.lane_condition_notes,
    });
  }

  return results.sort((a, b) => a.sessionDate.localeCompare(b.sessionDate));
}

/**
 * The non-practice-segment games used for averages: excludes the Practice segment
 * of a league night (is_warmup) and, unless the filter opts in, standalone
 * practice sessions too. Pure in-memory slice of fetchAllGamesWithScores.
 */
export function filterScoredGames(allGames: ScoredGame[], filter: StatsFilter): ScoredGame[] {
  return allGames.filter(
    (g) =>
      !g.isPractice &&
      (filter.includePracticeSessions || g.sessionType !== 'practice') &&
      (!filter.leagueId || g.leagueId === filter.leagueId),
  );
}

export type BestStat = { value: number; date: string; gameCount?: number };

/** Shapes a ScoredGame into the session view the handicap resolver expects. */
function sessionForHandicap(game: ScoredGame): SessionForHandicap {
  return {
    id: game.sessionId,
    session_date: game.sessionDate,
    session_type: game.sessionType,
    league_id: game.leagueId,
    manual_handicap: game.manualHandicap,
  };
}

/** Highest single game, scratch and (if a handicap resolves) handicapped, across every game ever logged. */
export function fetchBestGameStats(
  games: ScoredGame[],
  handicapOf: SessionHandicapResolver,
): { scratch: BestStat | null; handicapped: BestStat | null } {
  let scratch: BestStat | null = null;
  let handicapped: BestStat | null = null;

  for (const g of games) {
    if (!scratch || g.score > scratch.value) scratch = { value: g.score, date: g.sessionDate };

    if (g.sessionType !== 'league' || !g.leagueId) continue;
    const h = handicapOf(sessionForHandicap(g));
    if (h == null) continue;
    const total = g.score + h;
    if (!handicapped || total > handicapped.value) handicapped = { value: total, date: g.sessionDate };
  }

  return { scratch, handicapped };
}

/**
 * Highest series (sum of a session's non-practice-segment games), scratch
 * and handicapped, across every session ever logged. Handicapped series
 * uses the session's single handicap applied to each of its games.
 */
export function fetchBestSeriesStats(
  games: ScoredGame[],
  handicapOf: SessionHandicapResolver,
): { scratch: BestStat | null; handicapped: BestStat | null } {
  const bySession = new Map<string, ScoredGame[]>();
  for (const g of games) {
    if (g.isPractice) continue;
    const list = bySession.get(g.sessionId) ?? [];
    list.push(g);
    bySession.set(g.sessionId, list);
  }

  let scratch: BestStat | null = null;
  let handicapped: BestStat | null = null;

  for (const sessionGames of bySession.values()) {
    const scratchSum = sessionGames.reduce((sum, g) => sum + g.score, 0);
    const date = sessionGames[0].sessionDate;
    const gameCount = sessionGames.length;

    if (!scratch || scratchSum > scratch.value) {
      scratch = { value: scratchSum, date, gameCount };
    }

    const first = sessionGames[0];
    if (first.sessionType === 'league' && first.leagueId) {
      const h = handicapOf(sessionForHandicap(first));
      if (h != null) {
        const total = scratchSum + h * gameCount;
        if (!handicapped || total > handicapped.value) {
          handicapped = { value: total, date, gameCount };
        }
      }
    }
  }

  return { scratch, handicapped };
}

export type StatShot = {
  pins_standing: number[] | null;
  strike: boolean;
  spare: boolean;
  foul?: boolean;
  ball_id: string | null;
  lineup_position: string | null;
  slide_position: string | null;
  balls: { name: string } | null;
};

export type StatFrame = {
  frameNumber: number;
  gameId: string | null;
  isPractice: boolean;
  sessionType: string | null;
  leagueId: string | null;
  /** The session's date, straight off this frame's own join -- NOT sourced
   *  from ScoredGame, which drops ended_early/unscored games (see
   *  fetchAllGamesWithScores) that shot-level stats must still include. */
  sessionDate: string | null;
  /** Shots in delivery order. */
  shots: StatShot[];
};

/**
 * ONE frames+shots fetch feeding every shot-level stat (ball carry, drift,
 * strike/spare rates, conversion by leave) -- the compute* functions below all
 * slice this in memory rather than each re-querying every frame and shot.
 * Frames without a resolvable game are dropped; the practice filter is applied
 * per-stat (each compute takes the StatsFilter) so one fetch serves any filter.
 */
export async function fetchStatFrames(supabase: SupabaseClient): Promise<StatFrame[]> {
  const { data: frames } = await supabase
    .from('frames')
    .select(
      'frame_number, games(id, is_warmup, sessions(session_type, league_id, session_date)), shots(pins_standing, strike, spare, foul, ball_id, created_at, lineup_position, slide_position, balls(name))',
    )
    .order('created_at', { foreignTable: 'shots', ascending: true });

  if (!frames) return [];

  const results: StatFrame[] = [];
  for (const frame of frames as any[]) {
    const game = frame.games;
    if (!game) continue;
    results.push({
      frameNumber: frame.frame_number,
      gameId: game.id ?? null,
      isPractice: game.is_warmup,
      sessionType: game.sessions?.session_type ?? null,
      leagueId: game.sessions?.league_id ?? null,
      sessionDate: game.sessions?.session_date ?? null,
      shots: frame.shots ?? [],
    });
  }
  return results;
}

/**
 * One session's frames in the same StatFrame shape, for the per-game and
 * per-session rate tiles -- scoped at the query so a session page doesn't pull
 * the whole shot history the way fetchStatFrames does.
 */
export async function fetchSessionStatFrames(supabase: SupabaseClient, sessionId: string): Promise<StatFrame[]> {
  const { data: frames } = await supabase
    .from('frames')
    .select(
      'frame_number, games!inner(id, session_id, is_warmup, sessions(session_type, league_id, session_date)), shots(pins_standing, strike, spare, foul, ball_id, created_at, lineup_position, slide_position, balls(name))',
    )
    .eq('games.session_id', sessionId)
    .order('created_at', { foreignTable: 'shots', ascending: true });

  if (!frames) return [];

  return (frames as any[]).map((frame) => ({
    frameNumber: frame.frame_number,
    gameId: frame.games.id ?? null,
    isPractice: frame.games.is_warmup,
    sessionType: frame.games.sessions?.session_type ?? null,
    leagueId: frame.games.sessions?.league_id ?? null,
    sessionDate: frame.games.sessions?.session_date ?? null,
    shots: frame.shots ?? [],
  }));
}

/** The shared practice rule for shot-level stats: the Practice segment of a
 *  league night is always excluded; standalone practice sessions only when the
 *  filter opts out. */
function frameInFilter(frame: StatFrame, filter: StatsFilter): boolean {
  if (frame.isPractice) return false;
  if (!filter.includePracticeSessions && frame.sessionType === 'practice') return false;
  if (filter.leagueId && frame.leagueId !== filter.leagueId) return false;
  return true;
}

export type BallStat = { ballName: string; avgPinsPerShot: number; shotCount: number };

/**
 * Average pinfall on FRESH-RACK shots, by ball -- i.e. a carry metric for how
 * well a ball clears a full rack of 10. Counts only balls thrown when all ten
 * were standing: every frame's first ball, plus a 10th-frame ball delivered at
 * a reset rack (after a strike, or the fill ball after a spare). Second/spare
 * balls are excluded because their pinfall is capped by what was left, not the
 * ball. Walks each frame in delivery order tracking the standing count, exactly
 * like the scoresheet.
 */
export function computeBallStats(frames: StatFrame[], filter: StatsFilter): BallStat[] {
  const totals = new Map<string, { sum: number; count: number }>();

  for (const frame of frames) {
    if (!frameInFilter(frame, filter)) continue;

    let priorStanding = 10;
    for (const shot of frame.shots) {
      // a fouled delivery counts 0 and doesn't reflect carry, so leave it out of
      // the average entirely; its pins are respotted for the next ball
      if (shot.foul) {
        priorStanding = 10;
        continue;
      }

      const standingAfter = shot.strike ? 0 : shot.pins_standing?.length ?? 0;
      const freshRack = priorStanding === 10;
      const knocked = shot.strike ? 10 : Math.max(0, Math.min(10, priorStanding - standingAfter));
      const name = shot.balls?.name;

      if (freshRack && name) {
        const entry = totals.get(name) ?? { sum: 0, count: 0 };
        entry.sum += knocked;
        entry.count += 1;
        totals.set(name, entry);
      }

      priorStanding = standingAfter === 0 ? 10 : standingAfter;
    }
  }

  return Array.from(totals.entries())
    .map(([ballName, { sum, count }]) => ({ ballName, avgPinsPerShot: sum / count, shotCount: count }))
    .sort((a, b) => b.avgPinsPerShot - a.avgPinsPerShot);
}

/**
 * Average of (scratch + handicap) across league games whose session
 * resolves to a handicap. Games with no resolvable handicap (no league set,
 * or a rolling league with no prior-week average yet) are left out rather
 * than guessed at.
 */
export type DriftStat = { averageBoards: number; shotCount: number };

/** A board number stored in a text mark column, or null if it isn't numeric. */
function parseBoard(raw: unknown): number | null {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (s === '') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/**
 * Average drift across shots that recorded BOTH a numeric stance (lineup_position)
 * and slide (slide_position). Drift = stance − slide, the same value LanePicker
 * shows per shot: positive = the slide foot finishes to the RIGHT of the stance
 * (toward board 1), negative = to the LEFT. Legacy free-text marks that aren't a
 * plain board number are skipped. Returns null when no shot has both marks.
 */
export function computeDriftStat(frames: StatFrame[], filter: StatsFilter): DriftStat | null {
  let sum = 0;
  let count = 0;

  for (const frame of frames) {
    if (!frameInFilter(frame, filter)) continue;

    for (const shot of frame.shots) {
      const stance = parseBoard(shot.lineup_position);
      const slide = parseBoard(shot.slide_position);
      if (stance == null || slide == null) continue;
      sum += stance - slide;
      count += 1;
    }
  }

  if (count === 0) return null;
  return { averageBoards: sum / count, shotCount: count };
}

export type BallDetail = {
  totalShots: number;
  gamesUsed: number;
  /** Average fresh-rack pinfall with this ball (the carry metric), null if it
   *  has never been thrown at a full rack. */
  carryAvg: number | null;
  carryShots: number;
  /** Strike/spare rates for deliveries with THIS ball, classified exactly like
   *  the stats-page rates (see walkDeliveries). */
  strikes: number;
  strikeOpportunities: number;
  spares: number;
  spareOpportunities: number;
};

/**
 * "Is this ball working?" figures for one ball's detail page. The carry walk
 * mirrors computeBallStats (fresh-rack deliveries only, fouls respot and don't
 * count); strike/spare classification shares walkFrame with walkDeliveries (a
 * fresh-rack ball where a strike is legal is a strike opportunity, every other
 * ball a spare attempt, and a foul is a missed opportunity) filtered down to
 * the deliveries that used this ball. Returns null when the ball has no logged
 * shots under the filter. (Deliberately no drift here: drift is stance-vs-slide
 * footwork, a bowler metric, not a ball one.)
 */
export function computeBallDetail(frames: StatFrame[], filter: StatsFilter, ballId: string): BallDetail | null {
  let totalShots = 0;
  const games = new Set<string>();
  let carrySum = 0;
  let carryCount = 0;
  let strikes = 0;
  let strikeOpportunities = 0;
  let spares = 0;
  let spareOpportunities = 0;

  for (const frame of frames) {
    if (!frameInFilter(frame, filter)) continue;
    if (frame.shots.length === 0) continue;

    walkFrame(frame, (shot, i, freshRack, faced, cleared) => {
      if (shot.ball_id !== ballId) return;
      totalShots += 1;
      if (frame.gameId) games.add(frame.gameId);

      if (freshRack && (i === 0 || frame.frameNumber === 10)) {
        strikeOpportunities += 1;
        if (cleared) strikes += 1;
      } else {
        spareOpportunities += 1;
        if (cleared) spares += 1;
      }

      if (!shot.foul && freshRack) {
        const standingAfter = shot.strike ? 0 : shot.pins_standing?.length ?? 0;
        carrySum += shot.strike ? 10 : Math.max(0, Math.min(10, faced.length - standingAfter));
        carryCount += 1;
      }
    });
  }

  if (totalShots === 0) return null;
  return {
    totalShots,
    gamesUsed: games.size,
    carryAvg: carryCount ? carrySum / carryCount : null,
    carryShots: carryCount,
    strikes,
    strikeOpportunities,
    spares,
    spareOpportunities,
  };
}

export type RateStats = {
  strikes: number;
  strikeOpportunities: number;
  spares: number;
  spareOpportunities: number;
  openFrames: number;
  completedFrames: number;
  splitAttempts: number;
  splitConversions: number;
  gutterBalls: number;
  deliveries: number;
};

export type LeaveConversion = { name: string; pins: number[]; attempts: number; converted: number };

/** A delivery that cleared everything it faced (a foul knocks nothing down). */
function clearedRack(shot: StatShot): boolean {
  if (shot.foul) return false;
  return shot.strike || shot.spare || (shot.pins_standing?.length ?? 0) === 0;
}

/**
 * Walks one frame's shots in order, tracking the leave each ball faced (the
 * rack-reset rule: a strike, a clearing ball, or a foul respots all ten -- see
 * pinsFacedBefore). Shared by walkDeliveries (aggregate rates) and
 * computeBallDetail (same classification, attributed to one ball), so a future
 * scoring-rule change only needs fixing here.
 */
function walkFrame(
  frame: StatFrame,
  onShot: (shot: StatShot, index: number, freshRack: boolean, faced: number[], cleared: boolean) => void,
): void {
  let faced: number[] = [...FULL_RACK];
  frame.shots.forEach((shot, i) => {
    const freshRack = faced.length === 10;
    const cleared = clearedRack(shot);
    onShot(shot, i, freshRack, faced, cleared);

    const standingAfter = (shot.pins_standing ?? []) as number[];
    faced = shot.foul || shot.strike || standingAfter.length === 0 ? [...FULL_RACK] : [...standingAfter];
  });
}

/**
 * Walks every frame's shots classifying each delivery the way the scoresheet
 * does: a ball at a fresh rack where a strike is legal (the frame's first ball,
 * or any fresh-rack ball in the 10th) is a strike opportunity; every other ball
 * is a spare attempt at the leave it faced. The rack-reset rule mirrors
 * pinsFacedBefore: a strike, a clearing ball, or a foul respots all ten -- so a
 * ball 2 after a foul is a spare attempt at a "Full Rack". Fouled deliveries
 * count as missed opportunities (they score zero). Every spare attempt whose
 * faced leave is a split (isSplit) also counts toward splitAttempts/
 * splitConversions, so the split-conversion rate is a slice of the same walk.
 * onSpareAttempt reports each spare attempt's faced leave for the
 * conversion-by-leave grouping. Callers pass frames already sliced to their
 * scope (a filter, a game, a session). Every non-fouled delivery also counts
 * toward gutterBalls/deliveries -- a "gutter" here means the ball knocked down
 * nothing it faced (0 pins), whether that's a literal gutter ball or any other
 * total miss; fouls are excluded from this count (a foul is a rule violation,
 * not a miss).
 */
function walkDeliveries(
  frames: StatFrame[],
  onSpareAttempt?: (faced: number[], converted: boolean) => void,
): RateStats {
  const rates: RateStats = {
    strikes: 0,
    strikeOpportunities: 0,
    spares: 0,
    spareOpportunities: 0,
    openFrames: 0,
    completedFrames: 0,
    splitAttempts: 0,
    splitConversions: 0,
    gutterBalls: 0,
    deliveries: 0,
  };

  for (const frame of frames) {
    if (frame.shots.length === 0) continue;

    walkFrame(frame, (shot, i, freshRack, faced, cleared) => {
      const standingAfter = (shot.pins_standing ?? []) as number[];

      if (!shot.foul) {
        rates.deliveries += 1;
        if (standingAfter.length === faced.length) rates.gutterBalls += 1;
      }

      if (freshRack && (i === 0 || frame.frameNumber === 10)) {
        rates.strikeOpportunities += 1;
        if (cleared) rates.strikes += 1;
      } else {
        rates.spareOpportunities += 1;
        if (cleared) rates.spares += 1;
        if (isSplit(faced)) {
          rates.splitAttempts += 1;
          if (cleared) rates.splitConversions += 1;
        }
        onSpareAttempt?.(faced, cleared);
      }
    });

    // An open frame ended with no mark: fully bowled, first ball not a strike,
    // first two rolls short of ten. computeFrameRolls scores a foul as zero, so
    // the same expression covers fouled deliveries and the 10th frame alike.
    if (frameProgress(frame.frameNumber, frame.shots).complete) {
      rates.completedFrames += 1;
      const rolls = computeFrameRolls(frame.shots);
      if (rolls[0] !== 10 && (rolls[0] ?? 0) + (rolls[1] ?? 0) < 10) rates.openFrames += 1;
    }
  }

  return rates;
}

/**
 * Strike rate, spare-conversion rate, and open-frame rate across every logged
 * delivery. Returns null when nothing has been bowled under the filter.
 */
export function computeRateStats(frames: StatFrame[], filter: StatsFilter): RateStats | null {
  return rateStatsOrNull(frames.filter((f) => frameInFilter(f, filter)));
}

/** walkDeliveries over an already-scoped slice, null when nothing was bowled in it. */
function rateStatsOrNull(frames: StatFrame[]): RateStats | null {
  const rates = walkDeliveries(frames);
  return rates.strikeOpportunities === 0 && rates.spareOpportunities === 0 ? null : rates;
}

/**
 * Rates for ONE game, practice or not -- a game page reports on itself, so no
 * practice rule applies. Returns null before the game's first logged delivery.
 */
export function computeGameRates(frames: StatFrame[], gameId: string): RateStats | null {
  return rateStatsOrNull(frames.filter((f) => f.gameId === gameId));
}

/**
 * Rates across one session's games, excluding the Practice segment of a league
 * night -- the same slice "By Lane Tonight" reports on. Standalone practice
 * sessions count their games (that's all they have). Pass the session's frames
 * (fetchSessionStatFrames); returns null before the first logged delivery.
 */
export function computeSessionRates(frames: StatFrame[]): RateStats | null {
  return rateStatsOrNull(frames.filter((f) => !f.isPractice));
}

/**
 * Spare conversion grouped by the exact leave faced ("converted the 10 Pin
 * 4/11"), most-attempted first. Leaves are keyed by pin identity, so typed-in
 * counts (which store placeholder pin identities) group by those placeholders.
 */
export function computeLeaveConversions(frames: StatFrame[], filter: StatsFilter): LeaveConversion[] {
  const groups = new Map<string, { pins: number[]; attempts: number; converted: number }>();

  walkDeliveries(frames.filter((f) => frameInFilter(f, filter)), (faced, converted) => {
    const pins = sortedLeave(faced);
    const key = pins.join('-');
    const entry = groups.get(key) ?? { pins, attempts: 0, converted: 0 };
    entry.attempts += 1;
    if (converted) entry.converted += 1;
    groups.set(key, entry);
  });

  return Array.from(groups.values())
    .map(({ pins, attempts, converted }) => ({ name: leaveDisplayName(pins), pins, attempts, converted }))
    .sort((a, b) => b.attempts - a.attempts || a.name.localeCompare(b.name));
}

export type PinLeaveStat = { pin: number; attempts: number; converted: number };

/**
 * How often each pin (1-10) shows up in a faced spare leave, and how often
 * that leave was converted -- the per-pin counterpart to
 * computeLeaveConversions' exact-leave grouping. A leave with several pins
 * standing counts toward EACH of its pins, so a 3-6-10 attempt adds one
 * attempt to pins 3, 6, and 10 alike. Always returns all ten pins (zeroed if
 * never faced) so a pin-diagram display doesn't need to backfill gaps.
 */
export function computePinLeaveStats(frames: StatFrame[], filter: StatsFilter): PinLeaveStat[] {
  const counts = new Map<number, { attempts: number; converted: number }>();
  for (let pin = 1; pin <= 10; pin += 1) counts.set(pin, { attempts: 0, converted: 0 });

  walkDeliveries(frames.filter((f) => frameInFilter(f, filter)), (faced, converted) => {
    for (const pin of faced) {
      const entry = counts.get(pin);
      if (!entry) continue;
      entry.attempts += 1;
      if (converted) entry.converted += 1;
    }
  });

  return Array.from(counts.entries())
    .map(([pin, { attempts, converted }]) => ({ pin, attempts, converted }))
    .sort((a, b) => a.pin - b.pin);
}

export type LeaveTrendPoint = { date: string; pct: number; attempts: number };
export type LeaveTrend = { pins: number[]; name: string; totalAttempts: number; points: LeaveTrendPoint[] };

/**
 * Cumulative (running, not per-frame) spare-conversion rate over time for
 * each EXACT leave faced -- grouped by the full sorted pin combo, the same
 * way computeLeaveConversions groups its snapshot, so trending "10" only
 * counts single-pin 10 attempts, not every leave that happens to include a
 * 10 (e.g. "9-10"). A raw per-frame rate would whipsaw between 0%/100% since
 * most leaves are only faced a handful of times a session; this expands the
 * same way stats.astro's "Average Over Time" running average does. Uses each
 * frame's own sessionDate (not a join through ScoredGame, which drops
 * ended_early/unscored games that shot-level stats like this one must still
 * include -- see fetchAllGamesWithScores). Undated frames are skipped. Only
 * returns leaves actually faced at least once (no zero-filled combos --
 * there are too many possible combos to enumerate up front).
 */
export function computeLeaveTrends(frames: StatFrame[], filter: StatsFilter): LeaveTrend[] {
  const dated = frames
    .filter((f): f is StatFrame & { sessionDate: string } => frameInFilter(f, filter) && !!f.sessionDate)
    .map((f) => ({ frame: f, date: f.sessionDate }))
    .sort((a, b) => a.date.localeCompare(b.date));

  const running = new Map<string, { pins: number[]; attempts: number; converted: number; points: LeaveTrendPoint[] }>();

  for (const { frame, date } of dated) {
    walkDeliveries([frame], (faced, converted) => {
      const pins = sortedLeave(faced);
      const key = pins.join('-');
      const entry = running.get(key) ?? { pins, attempts: 0, converted: 0, points: [] };
      entry.attempts += 1;
      if (converted) entry.converted += 1;
      entry.points.push({ date, pct: entry.converted / entry.attempts, attempts: entry.attempts });
      running.set(key, entry);
    });
  }

  return Array.from(running.values())
    .map(({ pins, attempts, points }) => ({ pins, name: leaveDisplayName(pins), totalAttempts: attempts, points }))
    .sort((a, b) => b.totalAttempts - a.totalAttempts || a.name.localeCompare(b.name));
}

export type CleanGameStats = { cleanGames: number; totalGames: number };

/**
 * How often a FINISHED game had no open frame (every frame a strike, spare, or
 * split conversion -- anything but a leftover). Only fully-bowled games count
 * (an in-progress game is neither clean nor open yet); mirrors walkDeliveries'
 * per-frame open check but grouped by game so partial games don't skew the rate.
 */
export function computeCleanGameStats(frames: StatFrame[], filter: StatsFilter): CleanGameStats | null {
  const byGame = new Map<string, StatFrame[]>();
  for (const frame of frames) {
    if (!frameInFilter(frame, filter) || !frame.gameId) continue;
    const list = byGame.get(frame.gameId) ?? [];
    list.push(frame);
    byGame.set(frame.gameId, list);
  }

  let cleanGames = 0;
  let totalGames = 0;
  for (const gameFrames of byGame.values()) {
    const byNumber = new Map(gameFrames.map((f) => [f.frameNumber, f]));
    let finished = true;
    let hasOpen = false;
    for (let n = 1; n <= 10; n += 1) {
      const shots = byNumber.get(n)?.shots ?? [];
      if (!frameProgress(n, shots).complete) {
        finished = false;
        break;
      }
      const rolls = computeFrameRolls(shots);
      if (rolls[0] !== 10 && (rolls[0] ?? 0) + (rolls[1] ?? 0) < 10) hasOpen = true;
    }
    if (!finished) continue;
    totalGames += 1;
    if (!hasOpen) cleanGames += 1;
  }

  return totalGames === 0 ? null : { cleanGames, totalGames };
}

export type HandicapTrendPoint = { date: string; handicap: number };

/**
 * The resolved handicap for each league session, in chronological order -- one
 * point per session (not per game, since a session's games share one handicap).
 * Sessions with no resolvable handicap (no league, or a rolling league with no
 * prior-week average yet) are skipped. `games` should already be date-sorted
 * ascending (fetchAllGamesWithScores' order).
 */
export function computeHandicapTrend(games: ScoredGame[], handicapOf: SessionHandicapResolver): HandicapTrendPoint[] {
  const seenSessions = new Set<string>();
  const points: HandicapTrendPoint[] = [];
  for (const g of games) {
    if (g.sessionType !== 'league' || !g.leagueId || seenSessions.has(g.sessionId)) continue;
    const h = handicapOf(sessionForHandicap(g));
    if (h == null) continue;
    seenSessions.add(g.sessionId);
    points.push({ date: g.sessionDate, handicap: h });
  }
  return points;
}

export function fetchHandicappedAverage(games: ScoredGame[], handicapOf: SessionHandicapResolver): number | null {
  const handicappedScores: number[] = [];

  for (const game of games) {
    if (game.sessionType !== 'league' || !game.leagueId) continue;
    const handicap = handicapOf(sessionForHandicap(game));
    if (handicap != null) handicappedScores.push(game.score + handicap);
  }

  return average(handicappedScores);
}

export function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/** Scratch average per league, for league games only (sessions with a league assigned). */
export async function fetchLeagueStats(
  supabase: SupabaseClient,
  games: ScoredGame[],
): Promise<{ label: string; value: number; count: number }[]> {
  const leagueGames = games.filter((g) => g.sessionType === 'league' && g.leagueId);
  if (leagueGames.length === 0) return [];

  const leagueIds = Array.from(new Set(leagueGames.map((g) => g.leagueId!)));
  const { data: leagues } = await supabase.from('leagues').select('id, name').in('id', leagueIds);
  const nameById = new Map((leagues ?? []).map((l) => [l.id, l.name]));

  const groups = new Map<string, number[]>();
  for (const game of leagueGames) {
    const name = nameById.get(game.leagueId!) ?? 'Unknown league';
    const list = groups.get(name) ?? [];
    list.push(game.score);
    groups.set(name, list);
  }

  return Array.from(groups.entries())
    .map(([label, scores]) => ({ label, value: average(scores)!, count: scores.length }))
    .sort((a, b) => b.value - a.value);
}

export type SessionLaneStat = { lane: number; frames: number; strikes: number; firstBallAvg: number | null };

/**
 * Per-lane breakdown for one session's alternating pair: frames bowled on each
 * lane, first-ball strikes, and average first-ball (fresh-rack) pinfall. Each
 * frame's lane is derived from its number's parity + the session's starting lane
 * (via laneForFrame). Practice-segment games are excluded. Returns [] when the
 * session has no lane pair or no logged frames.
 */
export async function fetchSessionLaneStats(
  supabase: SupabaseClient,
  sessionId: string,
  config: LaneConfig,
): Promise<SessionLaneStat[]> {
  const { data: frames } = await supabase
    .from('frames')
    .select('frame_number, games!inner(session_id, is_warmup), shots(pins_standing, strike, foul, created_at)')
    .eq('games.session_id', sessionId)
    .eq('games.is_warmup', false)
    .order('created_at', { foreignTable: 'shots', ascending: true });

  if (!frames) return [];

  type Acc = { frames: number; strikes: number; sum: number; count: number };
  const byLane = new Map<number, Acc>();

  for (const frame of frames as any[]) {
    const lane = laneForFrame(frame.frame_number, config);
    if (lane == null) continue;

    const shots = frame.shots ?? [];
    if (shots.length === 0) continue;

    const acc = byLane.get(lane) ?? { frames: 0, strikes: 0, sum: 0, count: 0 };
    acc.frames += 1;

    // first ball is always thrown at a fresh rack of 10; a foul counts 0 and
    // isn't a carry outcome, so it feeds neither the average nor the strike count
    const first = shots[0];
    if (!first.foul) {
      const standingAfter = first.strike ? 0 : first.pins_standing?.length ?? 0;
      acc.sum += first.strike ? 10 : Math.max(0, Math.min(10, 10 - standingAfter));
      acc.count += 1;
      if (first.strike) acc.strikes += 1;
    }

    byLane.set(lane, acc);
  }

  return Array.from(byLane.entries())
    .map(([lane, a]) => ({ lane, frames: a.frames, strikes: a.strikes, firstBallAvg: a.count ? a.sum / a.count : null }))
    .sort((a, b) => a.lane - b.lane);
}

export function groupByLaneCondition(games: ScoredGame[]): { label: string; value: number; count: number }[] {
  const groups = new Map<string, number[]>();
  for (const game of games) {
    const key = game.laneCondition?.trim() || 'Not noted';
    const list = groups.get(key) ?? [];
    list.push(game.score);
    groups.set(key, list);
  }

  return Array.from(groups.entries())
    .map(([label, scores]) => ({ label, value: average(scores)!, count: scores.length }))
    .sort((a, b) => b.value - a.value);
}
