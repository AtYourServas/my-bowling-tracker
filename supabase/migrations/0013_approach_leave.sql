-- Phase 27: tie an approach to a pin leave.
-- An approach can target a specific leave (e.g. the 10 pin, or 3-6-10). We store
-- the pins left STANDING for that leave. An empty leave = a first-ball / strike
-- approach, so strike-vs-spare is derived from whether any pins are stored (no
-- separate kind column). Run this in the Supabase SQL Editor after
-- 0012_session_notes.sql.

alter table public.approaches
  add column leave smallint[] not null default '{}'::smallint[];

alter table public.approaches
  add constraint approach_leave_valid check (leave <@ array[1, 2, 3, 4, 5, 6, 7, 8, 9, 10]::smallint[]);
