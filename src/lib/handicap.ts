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

/**
 * A session's handicap, per its league's handicap_type. Returns null when
 * the session isn't a league session, has no league set, or (for rolling
 * average) there isn't yet a prior-week average to calculate from.
 */
export async function fetchSessionHandicap(
  supabase: SupabaseClient,
  session: SessionForHandicap,
): Promise<number | null> {
  if (session.session_type !== 'league' || !session.league_id) return null;

  const { data: league } = await supabase.from('leagues').select('*').eq('id', session.league_id).maybeSingle();
  if (!league) return null;

  if (league.handicap_type === 'manual') {
    return session.manual_handicap ?? null;
  }

  if (league.handicap_type === 'book_average') {
    if (league.book_average == null) return null;
    return computeHandicapFromAverage(league.handicap_basis, league.handicap_percent, league.book_average);
  }

  const avg = await fetchPriorLeagueAverage(supabase, league.id, session.session_date);
  if (avg == null) return null;
  return computeHandicapFromAverage(league.handicap_basis, league.handicap_percent, avg);
}
