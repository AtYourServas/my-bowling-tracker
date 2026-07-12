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
