-- Phase D3: fouls (USBC scoring).
-- A fouled delivery counts zero regardless of pins knocked down, and any pins
-- it knocks over are respotted for the next ball in the frame (so a first-ball
-- foul leaves a full rack of 10 for ball 2). Scoring for this lives in
-- computeFrameRolls / computeScoresheet (src/lib/scoring.ts); this column just
-- records that a shot was fouled. Existing shots default to not-fouled.
-- Run this in the Supabase SQL Editor after 0005_session_lane_pair.sql.

alter table public.shots
  add column foul boolean not null default false;
