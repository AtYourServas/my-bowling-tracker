import type { SupabaseClient } from '@supabase/supabase-js';

// A single entry in a session's notes stream. Two sources feed it: standalone
// session_notes (a running journal for the night) and per-shot notes stored on
// shots.note. Shot-linked entries carry a deep link to that ball's detail.
export type NoteDetail = { icon: string; label: string; value: string };

export type NoteEntry = {
  id: string;
  kind: 'note' | 'shot';
  body: string;
  createdAt: string;
  // present when the entry points at a specific shot
  link?: { href: string; label: string };
  // shot outcome + labelled detail, shown on shot-linked entries for context
  result?: string;
  details?: NoteDetail[];
};

function gameLabel(game: { is_practice: boolean | null; game_number: number | null }): string {
  if (game.is_practice) return 'Practice';
  return game.game_number ? `Game ${game.game_number}` : 'Game';
}

// Shot columns needed to render a shot-linked note entry (outcome + marks + link).
const SHOT_NOTE_SELECT =
  'id, note, created_at, pins_standing, strike, spare, foul, hook_timing, miss_direction, target_type, target_value, slide_position, breakpoint_board, balls(name), frames!inner(frame_number, games!inner(id, game_number, is_practice, session_id))';

type ShotMeta = { link: { href: string; label: string }; result: string; details: NoteDetail[] };

// Build the deep link + outcome for one shot row (session_id passed since the
// href needs it and it comes from the joined game).
function shotMetaFrom(shot: any, sessionId: string): ShotMeta | null {
  const frame = shot.frames;
  const game = frame?.games;
  if (!game) return null;
  return {
    link: {
      href: `/sessions/${sessionId}/games/${game.id}/shots/${shot.id}`,
      label: `${gameLabel(game)} · Frame ${frame.frame_number}`,
    },
    result: shotResult(shot),
    details: shotDetails(shot),
  };
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

// The shot's other logged detail, one labelled + icon'd row each.
function shotDetails(shot: any): NoteDetail[] {
  const d: NoteDetail[] = [];
  if (shot.balls?.name) d.push({ icon: '🎳', label: 'Ball', value: shot.balls.name });
  if (shot.target_type && shot.target_value != null)
    d.push({ icon: '🎯', label: 'Target', value: `${shot.target_type} ${shot.target_value}` });
  if (shot.slide_position) d.push({ icon: '👟', label: 'Slide', value: shot.slide_position });
  if (shot.breakpoint_board != null) d.push({ icon: '📍', label: 'Breakpoint', value: `board ${shot.breakpoint_board}` });
  if (shot.hook_timing) d.push({ icon: '🌀', label: 'Hook', value: HOOK_LABEL[shot.hook_timing] ?? shot.hook_timing });
  if (shot.miss_direction) d.push({ icon: '⚠️', label: 'Miss', value: MISS_LABEL[shot.miss_direction] ?? shot.miss_direction });
  return d;
}

// Merge the standalone session notes and the per-shot notes for one session into
// a single stream, newest first. Shot-linked entries deep-link to the shot editor.
export async function fetchSessionNotes(supabase: SupabaseClient, sessionId: string): Promise<NoteEntry[]> {
  const [notesRes, shotsRes] = await Promise.all([
    supabase
      .from('session_notes')
      .select('id, body, created_at, shot_id')
      .eq('session_id', sessionId),
    supabase.from('shots').select(SHOT_NOTE_SELECT).eq('frames.games.session_id', sessionId),
  ]);

  const shotRows = (shotsRes.data ?? []) as any[];

  // shot_id -> deep link + label + outcome, so both a per-shot note and a
  // session_note that references that shot can render the same context.
  const shotMeta = new Map<string, ShotMeta>();
  for (const shot of shotRows) {
    const meta = shotMetaFrom(shot, sessionId);
    if (meta) shotMeta.set(shot.id, meta);
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
      details: meta?.details?.length ? meta.details : undefined,
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
      details: meta?.details?.length ? meta.details : undefined,
    });
  }

  entries.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return entries;
}

export type SessionNoteGroup = {
  session: { id: string; alley: string | null; date: string | null; type: string | null; league: string | null };
  entries: NoteEntry[];
};

// Every note across the user's sessions (RLS-scoped), grouped by session and
// ordered newest session first. Optional filters narrow to one session/league.
export async function fetchAllNotes(
  supabase: SupabaseClient,
  filters: { leagueId?: string; sessionId?: string } = {},
): Promise<SessionNoteGroup[]> {
  let sessionsQuery = supabase
    .from('sessions')
    .select('id, alley_name, session_date, session_type, league_id, leagues(name)')
    .order('session_date', { ascending: false })
    .order('created_at', { ascending: false });
  if (filters.sessionId) sessionsQuery = sessionsQuery.eq('id', filters.sessionId);
  if (filters.leagueId) sessionsQuery = sessionsQuery.eq('league_id', filters.leagueId);

  const { data: sessions } = await sessionsQuery;
  const sessionList = (sessions ?? []) as any[];
  if (sessionList.length === 0) return [];
  const ids = sessionList.map((s) => s.id);

  const [notesRes, shotsRes] = await Promise.all([
    supabase.from('session_notes').select('id, body, created_at, shot_id, session_id').in('session_id', ids),
    // only shots that actually carry a note — bounded by how many the user wrote
    supabase.from('shots').select(SHOT_NOTE_SELECT).not('note', 'is', null),
  ]);

  // shot id -> { sessionId, meta, note, createdAt }, across all sessions
  const shotById = new Map<string, { sessionId: string; meta: ShotMeta; note: string; createdAt: string }>();
  for (const shot of (shotsRes.data ?? []) as any[]) {
    const sessionId = shot.frames?.games?.session_id;
    if (!sessionId) continue;
    const meta = shotMetaFrom(shot, sessionId);
    if (!meta) continue;
    shotById.set(shot.id, { sessionId, meta, note: (shot.note ?? '').trim(), createdAt: shot.created_at });
  }

  const bySession = new Map<string, NoteEntry[]>();
  const push = (sid: string, entry: NoteEntry) => {
    const arr = bySession.get(sid) ?? [];
    arr.push(entry);
    bySession.set(sid, arr);
  };

  for (const note of notesRes.data ?? []) {
    const body = (note.body ?? '').trim();
    if (!body) continue;
    const meta = note.shot_id ? shotById.get(note.shot_id)?.meta : undefined;
    push(note.session_id, {
      id: note.id,
      kind: 'note',
      body,
      createdAt: note.created_at,
      link: meta?.link,
      result: meta?.result,
      details: meta?.details?.length ? meta.details : undefined,
    });
  }

  for (const [shotId, s] of shotById) {
    if (!s.note) continue;
    push(s.sessionId, {
      id: shotId,
      kind: 'shot',
      body: s.note,
      createdAt: s.createdAt,
      link: s.meta.link,
      result: s.meta.result,
      details: s.meta.details.length ? s.meta.details : undefined,
    });
  }

  const groups: SessionNoteGroup[] = [];
  for (const s of sessionList) {
    const entries = bySession.get(s.id);
    if (!entries || entries.length === 0) continue;
    entries.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    groups.push({
      session: {
        id: s.id,
        alley: s.alley_name,
        date: s.session_date,
        type: s.session_type,
        league: s.leagues?.name ?? null,
      },
      entries,
    });
  }
  return groups;
}
