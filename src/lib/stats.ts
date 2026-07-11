import type { SupabaseClient } from '@supabase/supabase-js';
import { fetchDerivedScoreForGame } from './scoring';

export type ScoredGame = {
  gameId: string;
  score: number;
  sessionDate: string;
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
    .select('id, final_score, sessions(session_date, lane_condition_notes, session_type)')
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
      sessionDate: game.sessions.session_date,
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

export function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
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
