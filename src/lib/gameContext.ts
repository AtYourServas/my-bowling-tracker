import type { SupabaseClient } from '@supabase/supabase-js';
import { computeGameScoreSummary, type FrameLite } from './scoring';
import { fetchSessionHandicap } from './handicap';

/**
 * The game page's initial "sidebar" panels -- the handicap conversion line,
 * and the partial-score/"End Game Here" eligibility -- for the server render
 * (sessions/[id]/games/[gameId].astro, which already has `frames` fetched for
 * GameLogger's initial props -- pass it straight in, no extra query). After
 * that, GameLogger recomputes the score parts itself from the same
 * computeGameScoreSummary after every ball; only the handicap needs the
 * server, and it can't change mid-game.
 */
export type GameForSidebar = {
  final_score: number | null;
  is_warmup: boolean;
  sessions: {
    session_date: string;
    session_type: string;
    league_id: string | null;
    manual_handicap: number | null;
  } | null;
};

export type GameScoreContext = {
  scratchScore: number | null;
  sessionHandicap: number | null;
  canEndEarly: boolean;
  partialScore: { score: number; throughFrame: number } | null;
};

export async function fetchGameScoreContext(
  supabase: SupabaseClient,
  sessionId: string,
  game: GameForSidebar,
  frames: FrameLite[],
): Promise<GameScoreContext> {
  const summary = computeGameScoreSummary(frames, {
    isWarmup: game.is_warmup,
    finalScore: game.final_score,
    isPracticeSession: game.sessions?.session_type === 'practice',
  });

  const sessionHandicap =
    game.is_warmup || !game.sessions ? null : await fetchSessionHandicap(supabase, { id: sessionId, ...game.sessions });

  return { ...summary, sessionHandicap };
}
