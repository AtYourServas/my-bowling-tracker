-- Moves the mini-scoresheet "Show Pinfall" toggle from a per-page, non-persisted
-- checkbox (sessions/[id].astro) to a per-profile setting, on by default.
-- Run this in the Supabase SQL Editor after 0021_drill_shots_leave.sql.

alter table public.profiles
  add column show_pinfall boolean not null default true;
