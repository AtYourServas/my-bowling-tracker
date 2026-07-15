-- Default strike approach (PR 49).
-- Your profile can hold a default saved approach, chosen in Settings from your
-- strike approaches (those with an empty leave). The shot logger pre-selects it
-- on every fresh-rack first throw, and the PR-48 auto-apply seeds its marks
-- into the lane picker; each shot can still pick a different reference.
-- Nullable, clears to null if the approach is deleted. Run this in the
-- Supabase SQL Editor after 0017_profiles_backfill.sql.

alter table public.profiles
  add column default_approach_id uuid references public.approaches (id) on delete set null;
