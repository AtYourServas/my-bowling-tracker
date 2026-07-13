-- Phase 11: default ball + spare ball.
-- Your profile can hold a default ball (used off a fresh rack) and a default
-- spare ball (used to pick up leftovers). A new session inherits those two
-- defaults so its shot logger pre-selects the right ball per throw; the session
-- copy can be overridden per session, and each individual shot can still pick a
-- different ball. All four columns are nullable and clear to null if the
-- referenced ball is deleted. Run this in the Supabase SQL Editor after
-- 0006_shot_foul.sql.

alter table public.profiles
  add column default_ball_id uuid references public.balls (id) on delete set null,
  add column default_spare_ball_id uuid references public.balls (id) on delete set null;

alter table public.sessions
  add column default_ball_id uuid references public.balls (id) on delete set null,
  add column default_spare_ball_id uuid references public.balls (id) on delete set null;
