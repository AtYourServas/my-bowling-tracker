import type { SupabaseClient } from '@supabase/supabase-js';
import { fetchDerivedScoreForGame } from './scoring';

export type SessionForHandicap = {
  id: string;
  session_date: string;
  session_type: string;
  league_id: string | null;
  manual_handicap: number | null;
};

function computeHandicapFromAverage(basis: number, percent: number, avg: number): number {
  return Math.max(0, Math.round((basis - avg) * percent));
}

/** League average across a league's OTHER sessions strictly before the given date. */
async function fetchPriorLeagueAverage(
  supabase: SupabaseClient,
  leagueId: string,
  beforeDate: string,
): Promise<number | null> {
  const { data: sessions } = await supabase
    .from('sessions')
    .select('id')
    .eq('league_id', leagueId)
    .lt('session_date', beforeDate);

  if (!sessions || sessions.length === 0) return null;

  const sessionIds = sessions.map((s) => s.id);

  const { data: games } = await supabase
    .from('games')
    .select('id, final_score')
    .eq('is_practice', false)
    .in('session_id', sessionIds);

  if (!games || games.length === 0) return null;

  const scores: number[] = [];
  for (const game of games as any[]) {
    const derived = await fetchDerivedScoreForGame(supabase, game.id);
    const score = game.final_score ?? derived;
    if (score != null) scores.push(score);
  }

  if (scores.length === 0) return null;
  return scores.reduce((a, b) => a + b, 0) / scores.length;
}

export type SessionHandicap = {
  /** What actually applies: the override if set, otherwise the calculated value. */
  effective: number | null;
  /** What the league's formula produces (null for manual-type leagues, or when it can't be computed yet). */
  calculated: number | null;
  /** A per-session manual override (`manual_handicap`), when the alley's number differs from ours. */
  override: number | null;
};

/** The value a league's handicap_type formula produces. Null for manual leagues (no formula). */
async function computeCalculatedHandicap(
  supabase: SupabaseClient,
  session: SessionForHandicap,
  league: any,
): Promise<number | null> {
  if (league.handicap_type === 'manual') return null;

  if (league.handicap_type === 'book_average') {
    if (league.book_average == null) return null;
    return computeHandicapFromAverage(league.handicap_basis, league.handicap_percent, league.book_average);
  }

  const avg = await fetchPriorLeagueAverage(supabase, league.id, session.session_date);
  if (avg == null) return null;
  return computeHandicapFromAverage(league.handicap_basis, league.handicap_percent, avg);
}

/**
 * A session's handicap, split into the calculated value, the optional per-session
 * override (`manual_handicap`), and the effective value that actually applies
 * (override wins over calculated). The override lets you match whatever number the
 * alley used when it differs from ours — for any league type, not just manual.
 */
export async function fetchSessionHandicapDetail(
  supabase: SupabaseClient,
  session: SessionForHandicap,
): Promise<SessionHandicap> {
  const override = session.manual_handicap ?? null;

  if (session.session_type !== 'league' || !session.league_id) {
    return { effective: null, calculated: null, override: null };
  }

  const { data: league } = await supabase.from('leagues').select('*').eq('id', session.league_id).maybeSingle();
  if (!league) return { effective: override, calculated: null, override };

  const calculated = await computeCalculatedHandicap(supabase, session, league);
  return { effective: override ?? calculated, calculated, override };
}

/** The effective handicap for a session (override if set, else calculated). Null when none applies. */
export async function fetchSessionHandicap(
  supabase: SupabaseClient,
  session: SessionForHandicap,
): Promise<number | null> {
  return (await fetchSessionHandicapDetail(supabase, session)).effective;
}

export type SessionHandicapResolver = (session: SessionForHandicap) => number | null;

/** A league's scored games, for computing prior-league averages in memory. */
export type LeagueGameForHandicap = {
  score: number;
  sessionDate: string;
  leagueId: string | null;
  isPractice: boolean;
};

/**
 * Builds a synchronous, batched handicap resolver for many sessions. Unlike
 * fetchSessionHandicap (one league query + a nested per-game derived-score loop
 * *per call*), this loads every referenced league config in a single query and
 * computes rolling prior-league averages from an already-fetched game list --
 * so resolving each session's handicap costs zero further round-trips. Matches
 * fetchSessionHandicapDetail's rules exactly (override wins; book_average and
 * manual leagues; prior average = that league's non-practice games strictly
 * before the session date).
 */
export async function buildSessionHandicapResolver(
  supabase: SupabaseClient,
  games: LeagueGameForHandicap[],
): Promise<SessionHandicapResolver> {
  const leagueIds = Array.from(new Set(games.map((g) => g.leagueId).filter((id): id is string => !!id)));

  const leagueById = new Map<string, any>();
  if (leagueIds.length > 0) {
    const { data: leagues } = await supabase.from('leagues').select('*').in('id', leagueIds);
    for (const league of leagues ?? []) leagueById.set(league.id, league);
  }

  // per-league non-practice scores, for the rolling prior-week average
  const scoresByLeague = new Map<string, { date: string; score: number }[]>();
  for (const g of games) {
    if (!g.leagueId || g.isPractice) continue;
    const list = scoresByLeague.get(g.leagueId) ?? [];
    list.push({ date: g.sessionDate, score: g.score });
    scoresByLeague.set(g.leagueId, list);
  }

  function priorAverage(leagueId: string, beforeDate: string): number | null {
    const scores = (scoresByLeague.get(leagueId) ?? []).filter((x) => x.date < beforeDate).map((x) => x.score);
    if (scores.length === 0) return null;
    return scores.reduce((a, b) => a + b, 0) / scores.length;
  }

  return (session) => {
    const override = session.manual_handicap ?? null;
    if (session.session_type !== 'league' || !session.league_id) return null;

    const league = leagueById.get(session.league_id);
    if (!league) return override;

    let calculated: number | null;
    if (league.handicap_type === 'manual') {
      calculated = null;
    } else if (league.handicap_type === 'book_average') {
      calculated =
        league.book_average == null
          ? null
          : computeHandicapFromAverage(league.handicap_basis, league.handicap_percent, league.book_average);
    } else {
      const avg = priorAverage(league.id, session.session_date);
      calculated = avg == null ? null : computeHandicapFromAverage(league.handicap_basis, league.handicap_percent, avg);
    }

    return override ?? calculated;
  };
}
