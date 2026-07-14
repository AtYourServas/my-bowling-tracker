-- Phase 38: general free-text notes per ball.
-- The balls table already has layout_notes (drilling/surface specs from 0001).
-- This adds a separate general Notes field for performance observations
-- ("hooks hard on fresh oil", "good for dry lanes", etc.), kept distinct from
-- the layout notes. Nullable; surfaced on the balls list cards + the ball form.
-- Run this in the Supabase SQL Editor after 0014_hidden_approach_fields.sql.

alter table public.balls
  add column notes text;
