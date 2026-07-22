-- The dark/light toggle used to live only in localStorage. Safari (especially
-- an installed home-screen PWA, which this app's manifest opts into via
-- display: standalone) doesn't reliably persist localStorage writes across
-- app relaunches -- iOS terminates PWA processes more aggressively than
-- regular Safari tabs, and a write isn't guaranteed to flush to disk first.
-- Moving the preference onto the profile makes it round-trip through the
-- database instead, same as show_pinfall/default_entry_mode. Null means "no
-- explicit choice -- follow the OS preference" (existing default behavior).
-- Run this in the Supabase SQL Editor after 0025_rename_is_practice_to_is_warmup.sql.

alter table public.profiles
  add column theme text
    check (theme in ('light', 'dark'));
