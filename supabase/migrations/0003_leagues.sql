-- Phase 5.5: leagues + per-session handicap settings.
-- Run this in the Supabase SQL Editor after 0001_init.sql and 0002_frames_unique.sql.

create table public.leagues (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  handicap_basis integer not null default 200,
  handicap_percent numeric not null default 0.8,
  handicap_type text not null default 'rolling' check (handicap_type in ('rolling', 'book_average', 'manual')),
  book_average integer,
  notes text,
  created_at timestamptz not null default now()
);

create index leagues_user_id_idx on public.leagues (user_id);

alter table public.leagues enable row level security;

create policy "leagues are own" on public.leagues
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

alter table public.sessions
  add column league_id uuid references public.leagues (id) on delete set null,
  add column manual_handicap integer;

create index sessions_league_id_idx on public.sessions (league_id);
