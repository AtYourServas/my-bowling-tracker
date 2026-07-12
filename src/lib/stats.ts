import type { SupabaseClient } from '@supabase/supabase-js';
import { fetchDerivedScoreForGame } from './scoring';
import { fetchSessionHandicap } from './handicap';

export type ScoredGame = {
  gameId: string;
  score: number;
  sessionId: string;
  sessionDate: string;
  sessionType: string;
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
      leagueId: game.sessions.league_id,
      manualHandicap: game.sessions.manual_handicap,
      laneCondition: game.sessions.lane_condition_notes,
    });
  }

  return results.sort((a, b) => a.sessionDate.localeCompare(b.sessionDate));
}

export type BallStat = { ballName: string; avgPinsPerShot: number; shotCount: number };

/**
 * Average pins knocked down per shot, by ball. This is a rough per-shot
 * indicator (10 - pins left standing), not frame-adjusted scoring -- a
 * second-ball shot only had however many pins were left to knock down, so
 * this slightly overstates second-ball pinfall. Good enough for "which ball
 * is working," not a substitute for the real score. Always excludes
 * is_practice games (the Practice segment of a league night); standalone
 * practice sessions are excluded unless filter.includePracticeSessions.
 */
export async function fetchBallStats(supabase: SupabaseClient, filter: StatsFilter): Promise<BallStat[]> {
  const { data: shots } = await supabase
    .from('shots')
    .select('pins_standing, strike, balls(name), frames(games(is_practice, sessions(session_type)))')
    .not('ball_id', 'is', null);

  if (!shots) return [];

  const totals = new Map<string, { sum: number; count: number }>();
  for (const shot of shots as any[]) {
    const name = shot.balls?.name;
    if (!name) continue;

    const game = shot.frames?.games;
    if (!game || game.is_practice) continue;
    if (!filter.includePracticeSessions && game.sessions?.session_type === 'practice') continue;

    const pinsDown = shot.strike ? 10 : 10 - (shot.pins_standing?.length ?? 0);
    const entry = totals.get(name) ?? { sum: 0, count: 0 };
    entry.sum += pinsDown;
    entry.count += 1;
    totals.set(name, entry);
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
