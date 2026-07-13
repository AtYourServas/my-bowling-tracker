-- Phase 18: collapsible shot-logger sections.
-- The shot logger groups its extra fields (reference approach + marks, and
-- hook/miss/note) into collapsible sections so logging a throw is quicker. This
-- profile preference decides whether those sections start expanded or collapsed
-- for a fresh shot; editing an existing shot always opens them. Run this in the
-- Supabase SQL Editor after 0010_approach_reference_marks_numeric.sql.

alter table public.profiles
  add column shot_details_expanded boolean not null default false;
