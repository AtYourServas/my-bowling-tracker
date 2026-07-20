import type { SupabaseClient } from '@supabase/supabase-js';
import {
  fetchWarmupFrames,
  computeScoresheet,
  computeWarmupSheet,
  computeRunningScore,
  frameProgress,
  pinsFacedBefore,
  WARMUP_FRAME,
  type ShotLite,
  type FrameLite,
} from './scoring';
import { fetchSessionHandicap } from './handicap';
import { fetchLeaveNotes, notesForLeave, type NoteEntry } from './notes';

/**
 * Shared derivation for the game page's "sidebar" panels -- the handicap
 * conversion line, and the partial-score/"End Game Here" eligibility. Used
 * both by the initial server render (sessions/[id]/games/[gameId].astro,
 * which already has `frames` fetched for GameLogger's initial props -- pass
 * it straight in, no extra query) and by the sidebar.json refresh endpoint
 * the client-owned GameLogger island calls after each synced shot (which
 * fetches its own, since it's a separate request), so the two paths can't
 * drift apart.
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
  const isWarmup = game.is_warmup;
  const cells = isWarmup ? computeWarmupSheet(frames, 1) : computeScoresheet(frames);
  const runningTotal = [...cells].reverse().find((c) => c.cumulative != null)?.cumulative ?? null;
  const finalDerived = !isWarmup ? (cells[9]?.cumulative ?? null) : null;
  const scratchScore = game.final_score ?? finalDerived ?? runningTotal;

  const isPracticeSessionGame = !isWarmup && game.sessions?.session_type === 'practice';
  const partialScore =
    isPracticeSessionGame && game.final_score == null && finalDerived == null ? computeRunningScore(frames) : null;
  const canEndEarly = partialScore != null;

  const sessionHandicap =
    isWarmup || !game.sessions ? null : await fetchSessionHandicap(supabase, { id: sessionId, ...game.sessions });

  return { scratchScore, sessionHandicap, canEndEarly, partialScore };
}

/** A shot row shaped for the client-owned GameLogger island (full columns, joined ball name). */
export type ClientShotRow = {
  id: string;
  ball_id: string | null;
  approach_id: string | null;
  lineup_position: string | null;
  slide_position: string | null;
  target_type: string | null;
  target_value: number | null;
  pins_standing: number[];
  strike: boolean;
  spare: boolean;
  foul: boolean;
  hook_timing: string | null;
  miss_direction: string | null;
  breakpoint_board: number | null;
  note: string | null;
  created_at: string;
  balls: { name: string } | null;
};

/**
 * Authoritative (server-truth) shots for a single frame, full columns. Used
 * by the sidebar.json refresh endpoint to reconcile GameLogger's optimistic
 * client state (which only has client-side temp ids for a not-yet-synced
 * shot) with the real inserted row -- id, created_at, etc -- once a sync
 * completes.
 */
export async function fetchFrameShotRows(
  supabase: SupabaseClient,
  gameId: string,
  frameNumber: number,
): Promise<ClientShotRow[]> {
  const { data: frameRow } = await supabase
    .from('frames')
    .select('id')
    .eq('game_id', gameId)
    .eq('frame_number', frameNumber)
    .maybeSingle();

  if (!frameRow) return [];

  const { data: shots } = await supabase
    .from('shots')
    .select('*, balls(name)')
    .eq('frame_id', frameRow.id)
    .order('created_at', { ascending: true });

  return (shots ?? []) as unknown as ClientShotRow[];
}

export type GameLeaveNotesContext = {
  leaveNotes: NoteEntry[];
  facedNow: number[];
};

export async function fetchGameLeaveNotesContext(
  supabase: SupabaseClient,
  gameId: string,
  isWarmup: boolean,
  frameNumber: number,
): Promise<GameLeaveNotesContext> {
  const ruleFrameNumber = isWarmup ? WARMUP_FRAME : frameNumber;
  const frames = await fetchWarmupFrames(supabase, gameId);
  const frameShots = (frames.find((f) => f.frame_number === frameNumber)?.shots ?? []) as ShotLite[];
  const progress = frameProgress(ruleFrameNumber, frameShots);
  const facedNow = pinsFacedBefore(frameShots);
  const leaveNotes = progress.nextBall != null ? notesForLeave(await fetchLeaveNotes(supabase), facedNow) : [];
  return { leaveNotes, facedNow };
}
