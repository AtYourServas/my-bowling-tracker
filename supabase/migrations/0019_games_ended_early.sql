-- Partial-score practice games: lets a bowler end a practice game (standalone
-- practice session, or the Practice slot of a league night) before frame 10
-- and save whatever they'd bowled through as the final score. `ended_early`
-- distinguishes that from a genuinely completed game so score-based stats
-- (averages, bests, handicap trend) can exclude it -- shot-level rate stats
-- are unaffected either way, since they already aggregate every logged shot
-- regardless of game completeness.
-- Run this in the Supabase SQL Editor after 0018_default_approach.sql.

alter table public.games
  add column ended_early boolean not null default false;
