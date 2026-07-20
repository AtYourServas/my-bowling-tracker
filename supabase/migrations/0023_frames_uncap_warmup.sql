-- PR 67 made the League session's Practice slot (games.is_practice = true) an
-- unbounded warmup -- frame numbers can go past 10. The original 0001 check
-- constraint (frame_number between 1 and 10) was never relaxed for that case,
-- so any warmup frame past 10 silently fails to insert: the shot never saves
-- and the bowler sees a generic "frame may already be complete" rejection.
-- A real (non-warmup) game is still capped at 10 by application logic
-- (sessions/[id]/games/[gameId].astro clamps frameNumber via Math.min(10, ...)),
-- so it's safe to drop the upper bound at the database level entirely.
alter table public.frames drop constraint frames_frame_number_check;
alter table public.frames add constraint frames_frame_number_check check (frame_number >= 1);
