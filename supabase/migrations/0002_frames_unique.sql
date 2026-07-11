-- Phase 2: prevent duplicate frame rows for the same game + frame number.
-- Run this in the Supabase SQL Editor after 0001_init.sql.

create unique index frames_game_frame_number_idx
  on public.frames (game_id, frame_number)
  where frame_number is not null;
