import type { APIRoute } from 'astro';
import { fetchGameScoreContext, fetchFrameShotRows } from '../../../../../lib/gameContext';
import { fetchWarmupFrames } from '../../../../../lib/scoring';

// Background refresh target for the client-owned shot logger (GameLogger.tsx):
// once shot-logging moved off full page reloads, three things stopped
// updating for free -- the handicap conversion line, the partial-score/
// "End Game Here" eligibility, and (via `frame`) the authoritative shot rows
// for a frame GameLogger just optimistically updated (so client-generated
// temp ids get replaced with the real inserted row's id/created_at once a
// sync completes). Called after every successfully-synced shot. Read-only,
// no mutation.
export const GET: APIRoute = async ({ params, url, locals }) => {
  const { supabase } = locals;
  const sessionId = params.id;
  const gameId = params.gameId;
  if (!sessionId || !gameId) {
    return new Response(JSON.stringify({ error: 'missing route params' }), { status: 400 });
  }

  const { data: game } = await supabase
    .from('games')
    .select('final_score, is_practice, sessions(session_date, session_type, league_id, manual_handicap)')
    .eq('id', gameId)
    .maybeSingle();

  if (!game) {
    return new Response(JSON.stringify({ error: 'not found' }), { status: 404 });
  }

  const frameParam = Number(url.searchParams.get('frame'));
  const frameNumber = Number.isFinite(frameParam) && frameParam > 0 ? frameParam : null;

  const frames = await fetchWarmupFrames(supabase, gameId);
  const [context, frameShots] = await Promise.all([
    fetchGameScoreContext(supabase, sessionId, game as any, frames),
    frameNumber != null ? fetchFrameShotRows(supabase, gameId, frameNumber) : Promise.resolve(null),
  ]);

  return new Response(JSON.stringify({ ...context, frameNumber, frameShots }), {
    headers: { 'Content-Type': 'application/json' },
  });
};
