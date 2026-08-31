-- Per-profile show/hide for the Sessions table's optional columns (Lane, Game
-- Scores, Series, Average, Handicap). Stores the HIDDEN column keys, so any
-- column not listed stays visible and a future column defaults to shown --
-- same convention as profiles.hidden_shot_fields / hidden_approach_fields.
-- Run this in the Supabase SQL Editor after 0026_theme_preference.sql.

alter table public.profiles
  add column hidden_session_columns text[] not null default '{}';
