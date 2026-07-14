-- Phase 43: first-run "Get Set Up" checklist on the dashboard.
-- Adds a per-profile flag set when the user explicitly dismisses the
-- checklist; without a dismissal it hides itself once every step
-- (add a ball, set up a league, start a session) is complete.
-- Run this in the Supabase SQL Editor after 0015_ball_notes.sql.

alter table public.profiles
  add column onboarding_dismissed boolean not null default false;
