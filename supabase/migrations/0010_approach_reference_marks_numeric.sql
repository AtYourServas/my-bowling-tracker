-- PR 15: visual reference-mark picker on the approach setup screen.
-- The approach lane strips (Stance / Target / Slide) record marks to the half
-- board (e.g. 23.5), so widen this integer column to numeric. reference_lineup
-- and reference_slide are already text and store the half-board value as-is.
-- Breakpoint is a per-throw (reaction) mark only, so no approach column is added.
-- Run this in the Supabase SQL Editor.

alter table public.approaches
  alter column reference_target_value type numeric using reference_target_value::numeric;
