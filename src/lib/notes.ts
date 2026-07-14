import type { SupabaseClient } from '@supabase/supabase-js';
import { sortedLeave, leaveDisplayName } from './leaves';
import { pinsFacedBefore } from './scoring';

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
  // the leave this ball faced (e.g. "1-2" or "Full Rack"), set on leave-grouped
  // entries so a card can read "Faced 1-2 · Left 2"
  faced?: string;
};

function gameLabel(game: { is_practice: boolean | null; game_number: number | null }): string {
  if (game.is_practice) return 'Practice';
  return game.game_number ? `Game ${game.game_number}` : 'Game';
}

// Shot columns needed to render a shot-linked note entry (outcome + marks + link).
const SHOT_NOTE_SELECT =
  'id, frame_id, note, created_at, pins_standing, strike, spare, foul, hook_timing, miss_direction, target_type, target_value, slide_position, breakpoint_board, ball_id, balls(name), frames!inner(frame_number, games!inner(id, game_number, is_practice, session_id))';

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

const cap = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

// The shot's other logged detail, one labelled + icon'd row each.
function shotDetails(shot: any): NoteDetail[] {
  const d: NoteDetail[] = [];
  if (shot.balls?.name) d.push({ icon: '🎳', label: 'Ball', value: shot.balls.name });
  if (shot.target_type && shot.target_value != null)
    d.push({ icon: '🎯', label: 'Target', value: `${cap(shot.target_type)} ${shot.target_value}` });
  if (shot.slide_position) d.push({ icon: '👟', label: 'Slide', value: shot.slide_position });
  if (shot.breakpoint_board != null) d.push({ icon: '📍', label: 'Breakpoint', value: `Board ${shot.breakpoint_board}` });
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
  filters: { leagueId?: string; sessionId?: string; alley?: string; ballId?: string } = {},
): Promise<SessionNoteGroup[]> {
  let sessionsQuery = supabase
    .from('sessions')
    .select('id, alley_name, session_date, session_type, league_id, leagues(name)')
    .order('session_date', { ascending: false })
    .order('created_at', { ascending: false });
  if (filters.sessionId) sessionsQuery = sessionsQuery.eq('id', filters.sessionId);
  if (filters.leagueId) sessionsQuery = sessionsQuery.eq('league_id', filters.leagueId);
  if (filters.alley) sessionsQuery = sessionsQuery.eq('alley_name', filters.alley);

  const { data: sessions } = await sessionsQuery;
  const sessionList = (sessions ?? []) as any[];
  if (sessionList.length === 0) return [];
  const ids = sessionList.map((s) => s.id);

  const [notesRes, shotsRes] = await Promise.all([
    supabase.from('session_notes').select('id, body, created_at, shot_id, session_id').in('session_id', ids),
    // only shots that actually carry a note — bounded by how many the user wrote
    supabase.from('shots').select(SHOT_NOTE_SELECT).not('note', 'is', null),
  ]);

  // shot id -> { sessionId, meta, note, createdAt, ballId }, across all sessions
  const shotById = new Map<
    string,
    { sessionId: string; meta: ShotMeta; note: string; createdAt: string; ballId: string | null }
  >();
  for (const shot of (shotsRes.data ?? []) as any[]) {
    const sessionId = shot.frames?.games?.session_id;
    if (!sessionId) continue;
    const meta = shotMetaFrom(shot, sessionId);
    if (!meta) continue;
    shotById.set(shot.id, {
      sessionId,
      meta,
      note: (shot.note ?? '').trim(),
      createdAt: shot.created_at,
      ballId: shot.ball_id ?? null,
    });
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
    const linked = note.shot_id ? shotById.get(note.shot_id) : undefined;
    // ball filter keeps only notes tied to a shot with that ball; standalone
    // (shot-less) notes carry no ball, so they drop out when it's active
    if (filters.ballId && linked?.ballId !== filters.ballId) continue;
    const meta = linked?.meta;
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
    if (filters.ballId && s.ballId !== filters.ballId) continue;
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

// Notes tied to a specific leave *faced*, for surfacing "what I noted last time
// I shot this" both in the shot logger and grouped on the notes page.
export type LeaveGroup = {
  leave: number[]; // the faced pins (sorted), e.g. [3, 10]; full 10 = a fresh rack
  name: string; // leaveDisplayName(leave) — "Full Rack" for all ten
  notes: NoteEntry[]; // newest first
};

// Short "Jul 7" label for a session_date ('YYYY-MM-DD'), pinned to local noon so
// it can't slip a day. Used to prefix a leave note's link so cross-session notes
// are distinguishable.
function shortDate(date: string | null | undefined): string | null {
  if (!date) return null;
  const d = new Date(`${date}T00:00:00`);
  if (isNaN(d.getTime())) return null;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export type LeaveNoteFilters = {
  leagueId?: string;
  from?: string; // inclusive 'YYYY-MM-DD'
  to?: string; // inclusive 'YYYY-MM-DD'
};

// All note entries, grouped by the leave the noted ball *faced* (the pins
// standing before it was thrown — not what it left). A first ball faces a full
// rack. Both per-shot notes and shot-linked session_notes count; standalone
// session_notes (no shot) are excluded. Scanned across every session the user
// owns (RLS-scoped), optionally narrowed by league / date range; groups are
// ordered most-noted first. Each entry carries a date-prefixed deep link plus
// the faced leave.
export async function fetchLeaveNotes(
  supabase: SupabaseClient,
  filters: LeaveNoteFilters = {},
): Promise<LeaveGroup[]> {
  const { data: sessions } = await supabase.from('sessions').select('id, session_date, league_id');
  const dateBySession = new Map<string, string | null>((sessions ?? []).map((s: any) => [s.id, s.session_date]));

  // sessions passing the league / date-range filters; a note is kept only if its
  // shot's session is in here
  const allowedSessions = new Set(
    (sessions ?? [])
      .filter((s: any) => {
        if (filters.leagueId && s.league_id !== filters.leagueId) return false;
        if (filters.from && (!s.session_date || s.session_date < filters.from)) return false;
        if (filters.to && (!s.session_date || s.session_date > filters.to)) return false;
        return true;
      })
      .map((s: any) => s.id),
  );

  const { data: sessionNotes } = await supabase.from('session_notes').select('id, body, created_at, shot_id');
  const linkedIds = [...new Set((sessionNotes ?? []).filter((n) => n.shot_id).map((n) => n.shot_id))];

  const [notedRes, linkedRes] = await Promise.all([
    // shots that carry their own note — bounded by how many the user wrote
    supabase.from('shots').select(SHOT_NOTE_SELECT).not('note', 'is', null),
    // plus shots a session_note points at, so we know that shot's faced leave
    linkedIds.length
      ? supabase.from('shots').select(SHOT_NOTE_SELECT).in('id', linkedIds)
      : Promise.resolve({ data: [] as any[] }),
  ]);

  const notedShots = [...(notedRes.data ?? []), ...(linkedRes.data ?? [])];
  const shotById = new Map<string, any>();
  for (const shot of notedShots) shotById.set(shot.id, shot);

  // Every shot in each involved frame, ordered, so we can reconstruct the leave
  // each noted ball faced (= pins standing before it, respots included).
  const frameIds = [...new Set(notedShots.map((s) => s.frame_id).filter(Boolean))];
  const { data: frameShotRows } = frameIds.length
    ? await supabase
        .from('shots')
        .select('id, frame_id, pins_standing, strike, spare, foul')
        .in('frame_id', frameIds)
        .order('created_at', { ascending: true })
    : { data: [] as any[] };
  const shotsByFrame = new Map<string, any[]>();
  for (const s of frameShotRows ?? []) {
    const arr = shotsByFrame.get(s.frame_id) ?? [];
    arr.push(s);
    shotsByFrame.set(s.frame_id, arr);
  }

  // The leave a given noted shot faced: the pins standing before its position in
  // the frame (full rack for the first ball / after a respot).
  const facedFor = (shot: any): number[] => {
    const siblings = shotsByFrame.get(shot.frame_id) ?? [];
    const idx = siblings.findIndex((s) => s.id === shot.id);
    return sortedLeave(pinsFacedBefore(idx >= 0 ? siblings.slice(0, idx) : []));
  };

  const byLeave = new Map<string, { leave: number[]; notes: NoteEntry[] }>();

  const addNote = (shot: any, id: string, kind: 'note' | 'shot', body: string, createdAt: string) => {
    const sessionId = shot.frames?.games?.session_id;
    if (!sessionId || !allowedSessions.has(sessionId)) return;
    const meta = shotMetaFrom(shot, sessionId);
    if (!meta) return;
    const faced = facedFor(shot);
    const dp = shortDate(dateBySession.get(sessionId));
    const entry: NoteEntry = {
      id,
      kind,
      body,
      createdAt,
      link: { href: meta.link.href, label: dp ? `${dp} · ${meta.link.label}` : meta.link.label },
      result: meta.result,
      details: meta.details.length ? meta.details : undefined,
      faced: faced.length === 10 ? 'Full Rack' : faced.join('-'),
    };
    const key = faced.join('-');
    const g = byLeave.get(key) ?? { leave: faced, notes: [] };
    g.notes.push(entry);
    byLeave.set(key, g);
  };

  for (const shot of notedRes.data ?? []) {
    const body = (shot.note ?? '').trim();
    if (body) addNote(shot, shot.id, 'shot', body, shot.created_at);
  }

  for (const note of sessionNotes ?? []) {
    if (!note.shot_id) continue;
    const shot = shotById.get(note.shot_id);
    if (!shot) continue;
    const body = (note.body ?? '').trim();
    if (body) addNote(shot, note.id, 'note', body, note.created_at);
  }

  const groups: LeaveGroup[] = [];
  for (const { leave, notes } of byLeave.values()) {
    notes.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    groups.push({ leave, name: leaveDisplayName(leave), notes });
  }
  groups.sort((a, b) => b.notes.length - a.notes.length || a.leave.join('-').localeCompare(b.leave.join('-')));
  return groups;
}

// The notes for one exact leave (sorted-pin match), or [] if none.
export function notesForLeave(groups: LeaveGroup[], leave: number[]): NoteEntry[] {
  const key = sortedLeave(leave).join('-');
  return groups.find((g) => g.leave.join('-') === key)?.notes ?? [];
}

// A stable anchor id for a leave group on the notes page (e.g. "leave-3-10").
export function leaveAnchor(leave: number[]): string {
  return `leave-${sortedLeave(leave).join('-')}`;
}
