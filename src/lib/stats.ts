import type { SupabaseClient } from '@supabase/supabase-js';
import { fetchDerivedScoreForGame } from './scoring';
import { fetchSessionHandicap } from './handicap';

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
};

/** Every non-practice game with a resolvable score (final_score, falling back to derived). */
export async function fetchScoredGames(supabase: SupabaseClient, filter: StatsFilter): Promise<ScoredGame[]> {
  const { data: games } = await supabase
    .from('games')
    .select('id, final_score, session_id, sessions(session_date, lane_condition_notes, session_type, league_id, manual_handicap)')
    .eq('is_practice', false);

  if (!games) return [];

  const results: ScoredGame[] = [];
  for (const game of games as any[]) {
    if (!filter.includePracticeSessions && game.sessions.session_type === 'practice') continue;

    const derived = await fetchDerivedScoreForGame(supabase, game.id);
    const score = game.final_score ?? derived;
    if (score == null) continue;
    results.push({
      gameId: game.id,
      score,
      sessionId: game.session_id,
      sessionDate: game.sessions.session_date,
      sessionType: game.sessions.session_type,
      isPractice: false,
      leagueId: game.sessions.league_id,
      manualHandicap: game.sessions.manual_handicap,
      laneCondition: game.sessions.lane_condition_notes,
    });
  }

  return results.sort((a, b) => a.sessionDate.localeCompare(b.sessionDate));
}

/**
 * Every game ever logged with a resolvable score, with no exclusions at all --
 * unlike fetchScoredGames, this includes is_practice games (the Practice
 * segment of a league night) and practice-session games too. Meant for
 * all-time "best game"/"best series" bragging-rights stats, not averages.
 */
export async function fetchAllScoredGames(supabase: SupabaseClient): Promise<ScoredGame[]> {
  const { data: games } = await supabase
    .from('games')
    .select('id, final_score, session_id, is_practice, sessions(session_date, lane_condition_notes, session_type, league_id, manual_handicap)');

  if (!games) return [];

  const results: ScoredGame[] = [];
  for (const game of games as any[]) {
    const derived = await fetchDerivedScoreForGame(supabase, game.id);
    const score = game.final_score ?? derived;
    if (score == null) continue;
    results.push({
      gameId: game.id,
      score,
      sessionId: game.session_id,
      sessionDate: game.sessions.session_date,
      sessionType: game.sessions.session_type,
      isPractice: game.is_practice,
      leagueId: game.sessions.league_id,
      manualHandicap: game.sessions.manual_handicap,
      laneCondition: game.sessions.lane_condition_notes,
    });
  }

  return results.sort((a, b) => a.sessionDate.localeCompare(b.sessionDate));
}

export type BestStat = { value: number; date: string; gameCount?: number };

/** Highest single game, scratch and (if a handicap resolves) handicapped, across every game ever logged. */
export async function fetchBestGameStats(
  supabase: SupabaseClient,
  games: ScoredGame[],
): Promise<{ scratch: BestStat | null; handicapped: BestStat | null }> {
  let scratch: BestStat | null = null;
  for (const g of games) {
    if (!scratch || g.score > scratch.value) scratch = { value: g.score, date: g.sessionDate };
  }

  const handicapBySession = new Map<string, number | null>();
  let handicapped: BestStat | null = null;

  for (const g of games) {
    if (g.sessionType !== 'league' || !g.leagueId) continue;

    if (!handicapBySession.has(g.sessionId)) {
      const h = await fetchSessionHandicap(supabase, {
        id: g.sessionId,
        session_date: g.sessionDate,
        session_type: g.sessionType,
        league_id: g.leagueId,
        manual_handicap: g.manualHandicap,
      });
      handicapBySession.set(g.sessionId, h);
    }

    const h = handicapBySession.get(g.sessionId);
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
export async function fetchBestSeriesStats(
  supabase: SupabaseClient,
  games: ScoredGame[],
): Promise<{ scratch: BestStat | null; handicapped: BestStat | null }> {
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
      const h = await fetchSessionHandicap(supabase, {
        id: first.sessionId,
        session_date: first.sessionDate,
        session_type: first.sessionType,
        league_id: first.leagueId,
        manual_handicap: first.manualHandicap,
      });
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

export type BallStat = { ballName: string; avgPinsPerShot: number; shotCount: number };

/**
 * Average pinfall on FRESH-RACK shots, by ball -- i.e. a carry metric for how
 * well a ball clears a full rack of 10. Counts only balls thrown when all ten
 * were standing: every frame's first ball, plus a 10th-frame ball delivered at
 * a reset rack (after a strike, or the fill ball after a spare). Second/spare
 * balls are excluded because their pinfall is capped by what was left, not the
 * ball. Walks each frame in delivery order tracking the standing count, exactly
 * like the scoresheet. Always excludes is_practice games (the Practice segment
 * of a league night); standalone practice sessions are excluded unless
 * filter.includePracticeSessions.
 */
export async function fetchBallStats(supabase: SupabaseClient, filter: StatsFilter): Promise<BallStat[]> {
  const { data: frames } = await supabase
    .from('frames')
    .select('games(is_practice, sessions(session_type)), shots(pins_standing, strike, created_at, balls(name))')
    .order('created_at', { foreignTable: 'shots', ascending: true });

  if (!frames) return [];

  const totals = new Map<string, { sum: number; count: number }>();

  for (const frame of frames as any[]) {
    const game = frame.games;
    if (!game || game.is_practice) continue;
    if (!filter.includePracticeSessions && game.sessions?.session_type === 'practice') continue;

    let priorStanding = 10;
    for (const shot of frame.shots ?? []) {
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
export async function fetchHandicappedAverage(supabase: SupabaseClient, games: ScoredGame[]): Promise<number | null> {
  const handicapBySession = new Map<string, number | null>();
  const handicappedScores: number[] = [];

  for (const game of games) {
    if (game.sessionType !== 'league' || !game.leagueId) continue;

    if (!handicapBySession.has(game.sessionId)) {
      const handicap = await fetchSessionHandicap(supabase, {
        id: game.sessionId,
        session_date: game.sessionDate,
        session_type: game.sessionType,
        league_id: game.leagueId,
        manual_handicap: game.manualHandicap,
      });
      handicapBySession.set(game.sessionId, handicap);
    }

    const handicap = handicapBySession.get(game.sessionId);
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
