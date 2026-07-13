-- Phase 19: per-field shot-logger visibility.
-- Rather than tracking every optional detail, you can hide the shot-logger
-- fields you don't use (e.g. slide, breakpoint, note). This stores the field
-- KEYS you've hidden; anything not listed stays visible, so fields added later
-- default to shown. Empty array = show everything. Run this in the Supabase SQL
-- Editor after 0010_approach_reference_marks_numeric.sql.
--
-- (Supersedes the held PR-18 migration 0011_shot_details_expanded.sql, which was
-- never merged to main; if you already ran it, its unused shot_details_expanded
-- column is harmless and can be dropped later.)

alter table public.profiles
  add column hidden_shot_fields text[] not null default '{}'::text[];
