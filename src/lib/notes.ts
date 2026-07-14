import type { SupabaseClient } from '@supabase/supabase-js';

// A single entry in a session's notes stream. Two sources feed it: standalone
// session_notes (a running journal for the night) and per-shot notes stored on
// shots.note. Shot-linked entries carry a deep link to that ball's detail.
export type NoteEntry = {
  id: string;
  kind: 'note' | 'shot';
  body: string;
  createdAt: string;
  // present when the entry points at a specific shot
  link?: { href: string; label: string };
  // shot outcome + detail, shown on shot-linked entries for context
  result?: string;
  remarks?: string;
};

function gameLabel(game: { is_practice: boolean | null; game_number: number | null }): string {
  if (game.is_practice) return 'Practice';
  return game.game_number ? `Game ${game.game_number}` : 'Game';
}

const HOOK_LABEL: Record<string, string> = { early: 'Early', 'on-time': 'On-time', late: 'Late', none: 'No hook' };
const MISS_LABEL: Record<string, string> = { high: 'High', low: 'Low', flush: 'Flush', pocket: 'Pocket' };

// One-line outcome of the ball the note is attached to.
function shotResult(shot: any): string {
  if (shot.foul) return 'Foul';
  if (shot.strike) return 'Strike';
  if (shot.spare) return 'Spare';
  const standing = (shot.pins_standing ?? []) as number[];
  if (standing.length === 0) return 'Cleared';
  return `Left ${[...standing].sort((a, b) => a - b).join('-')}`;
}

// The shot's other logged detail, condensed for the stream.
function shotRemarks(shot: any): string {
  return [
    shot.balls?.name,
    shot.target_type && shot.target_value != null ? `${shot.target_type} ${shot.target_value}` : null,
    shot.hook_timing ? (HOOK_LABEL[shot.hook_timing] ?? shot.hook_timing) : null,
    shot.miss_direction ? (MISS_LABEL[shot.miss_direction] ?? shot.miss_direction) : null,
  ]
    .filter(Boolean)
    .join(' · ');
}

// Merge the standalone session notes and the per-shot notes for one session into
// a single stream, newest first. Shot-linked entries deep-link to the shot editor.
export async function fetchSessionNotes(supabase: SupabaseClient, sessionId: string): Promise<NoteEntry[]> {
  const [notesRes, shotsRes] = await Promise.all([
    supabase
      .from('session_notes')
      .select('id, body, created_at, shot_id')
      .eq('session_id', sessionId),
    supabase
      .from('shots')
      .select(
        'id, note, created_at, pins_standing, strike, spare, foul, hook_timing, miss_direction, target_type, target_value, balls(name), frames!inner(frame_number, games!inner(id, game_number, is_practice, session_id))',
      )
      .eq('frames.games.session_id', sessionId),
  ]);

  const shotRows = (shotsRes.data ?? []) as any[];

  // shot_id -> deep link + label + outcome, so both a per-shot note and a
  // session_note that references that shot can render the same context.
  type ShotMeta = { link: { href: string; label: string }; result: string; remarks: string };
  const shotMeta = new Map<string, ShotMeta>();
  for (const shot of shotRows) {
    const frame = shot.frames;
    const game = frame?.games;
    if (!game) continue;
    shotMeta.set(shot.id, {
      link: {
        href: `/sessions/${sessionId}/games/${game.id}/shots/${shot.id}`,
        label: `${gameLabel(game)} · Frame ${frame.frame_number}`,
      },
      result: shotResult(shot),
      remarks: shotRemarks(shot),
    });
  }

  const entries: NoteEntry[] = [];

  for (const note of notesRes.data ?? []) {
    const body = (note.body ?? '').trim();
    if (!body) continue;
    const meta = note.shot_id ? shotMeta.get(note.shot_id) : undefined;
    entries.push({
      id: note.id,
      kind: 'note',
      body,
      createdAt: note.created_at,
      link: meta?.link,
      result: meta?.result,
      remarks: meta?.remarks || undefined,
    });
  }

  for (const shot of shotRows) {
    const body = (shot.note ?? '').trim();
    if (!body) continue;
    const meta = shotMeta.get(shot.id);
    entries.push({
      id: shot.id,
      kind: 'shot',
      body,
      createdAt: shot.created_at,
      link: meta?.link,
      result: meta?.result,
      remarks: meta?.remarks || undefined,
    });
  }

  entries.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return entries;
}
