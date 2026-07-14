-- Phase 37: per-field visibility for the approach setup form.
-- Mirrors 0011_shot_logger_fields: a bowler who doesn't track certain approach
-- details (e.g. slide) can hide them from the add/edit approach form. Stores the
-- field KEYS you've hidden (ball, stance, target, slide, notes); anything not
-- listed stays visible, so fields added later default to shown. Empty array =
-- show everything. Name and Leave are core and always shown. Run this in the
-- Supabase SQL Editor after 0013_approach_leave.sql.

alter table public.profiles
  add column hidden_approach_fields text[] not null default '{}'::text[];
