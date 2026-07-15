-- Phase 46: backfill missing profiles rows.
-- The handle_new_user trigger (0001) auto-creates a profiles row on signup,
-- but any account created BEFORE that trigger existed has no row. Updates to
-- a missing row match zero rows and report success, so settings appeared to
-- save ("Settings saved.") while writing nothing. Idempotent: inserts only
-- the rows that are missing.
-- Run this in the Supabase SQL Editor after 0016_onboarding_dismissed.sql.

insert into public.profiles (id)
select u.id
from auth.users u
left join public.profiles p on p.id = u.id
where p.id is null;
