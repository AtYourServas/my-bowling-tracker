-- PR 13: visual reference-mark picker.
-- The lane-strip picker records target and breakpoint marks to the half board
-- (e.g. 23.5), so widen these integer columns to numeric. lineup_position is
-- already text, so it stores the half-board stance value as-is.
-- Run this in the Supabase SQL Editor.

alter table public.shots
  alter column target_value type numeric using target_value::numeric,
  alter column breakpoint_board type numeric using breakpoint_board::numeric;
