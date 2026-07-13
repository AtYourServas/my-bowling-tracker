-- Phase 12: default score-entry mode.
-- Your profile remembers how you like to enter scores -- 'pick' (tap the pin
-- diagram) or 'type' (type shorthand straight into the scoresheet frame). A game
-- opens in this mode by default; a ?mode= in the URL (from the on-page toggle)
-- overrides it for the rest of that session. Run this in the Supabase SQL Editor
-- after 0007_default_ball.sql.

alter table public.profiles
  add column default_entry_mode text not null default 'pick'
    check (default_entry_mode in ('pick', 'type'));
