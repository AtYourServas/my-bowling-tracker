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
};

function gameLabel(game: { is_practice: boolean | null; game_number: number | null }): string {
  if (game.is_practice) return 'Practice';
  return game.game_number ? `Game ${game.game_number}` : 'Game';
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
      .select('id, note, created_at, frames!inner(frame_number, games!inner(id, game_number, is_practice, session_id))')
      .eq('frames.games.session_id', sessionId)
      .not('note', 'is', null),
  ]);

  const shotRows = (shotsRes.data ?? []) as any[];

  // shot_id -> deep link + label, so a session_note that references a shot can
  // reuse the same link the per-shot entry would render.
  const shotLink = new Map<string, { href: string; label: string }>();
  for (const shot of shotRows) {
    const frame = shot.frames;
    const game = frame?.games;
    if (!game) continue;
    shotLink.set(shot.id, {
      href: `/sessions/${sessionId}/games/${game.id}/shots/${shot.id}`,
      label: `${gameLabel(game)} · Frame ${frame.frame_number}`,
    });
  }

  const entries: NoteEntry[] = [];

  for (const note of notesRes.data ?? []) {
    const body = (note.body ?? '').trim();
    if (!body) continue;
    entries.push({
      id: note.id,
      kind: 'note',
      body,
      createdAt: note.created_at,
      link: note.shot_id ? shotLink.get(note.shot_id) : undefined,
    });
  }

  for (const shot of shotRows) {
    const body = (shot.note ?? '').trim();
    if (!body) continue;
    entries.push({
      id: shot.id,
      kind: 'shot',
      body,
      createdAt: shot.created_at,
      link: shotLink.get(shot.id),
    });
  }

  entries.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return entries;
}
