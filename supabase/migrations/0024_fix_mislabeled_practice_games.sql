-- Data fix, not a schema change: dashboard.astro's "Start Practice" quick-start
-- tile (findOrCreateOpenGame) inserted is_practice = true for every game it
-- created in a standalone practice-type session, but is_practice specifically
-- means "the League session's unbounded warmup Practice slot" -- it's unrelated
-- to the parent session's own session_type. A game created this way was
-- silently treated as an uncapped warmup (no 10-frame limit, no Final Score
-- field) instead of a normal practice game.
--
-- This is safe to backfill unambiguously: the real League Practice slot can
-- ONLY ever be created inside a session_type = 'league' session (see the
-- "Start Warmup" form in sessions/[id].astro, gated on session.session_type
-- === 'league'), so any is_practice = true row whose parent session is
-- session_type = 'practice' is guaranteed to be one of these mislabeled rows,
-- never a legitimate warmup.
update public.games
set is_practice = false
where is_practice = true
  and session_id in (
    select id from public.sessions where session_type = 'practice'
  );
