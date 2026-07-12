-- Phase D1: team name on a league.
-- New league sessions inherit this as their league_team_name unless overridden.
-- Run this in the Supabase SQL Editor after 0003_leagues.sql.

alter table public.leagues
  add column team_name text;
