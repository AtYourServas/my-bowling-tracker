-- Phase D2: two lanes per night (strict alternation).
-- A league night is bowled on a pair of adjacent lanes, alternating each frame.
-- `lane_number` (existing) doubles as the STARTING lane (frame 1); the new
-- `second_lane_number` is the other lane of the pair. Odd frames are bowled on
-- the starting lane, even frames on the second lane. A null second lane keeps
-- the legacy single-lane behavior (every frame on lane_number).
-- Run this in the Supabase SQL Editor after 0004_league_team_name.sql.

alter table public.sessions
  add column second_lane_number integer;
