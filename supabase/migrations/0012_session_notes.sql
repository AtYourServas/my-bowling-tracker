-- Phase 25: in-session notes stream.
-- A running note stream per session — free thoughts you jot while bowling. Each
-- note optionally links to a specific shot (shot_id) so the stream can deep-link
-- to that ball's detail. Per-shot notes (shots.note) surface in the same stream.
-- Run this in the Supabase SQL Editor after 0011_shot_logger_fields.sql.

create table public.session_notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  session_id uuid not null references public.sessions (id) on delete cascade,
  shot_id uuid references public.shots (id) on delete set null,
  body text not null,
  created_at timestamptz not null default now()
);

create index session_notes_session_id_idx on public.session_notes (session_id);
create index session_notes_user_id_idx on public.session_notes (user_id);

alter table public.session_notes enable row level security;

create policy "session notes are own" on public.session_notes
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
