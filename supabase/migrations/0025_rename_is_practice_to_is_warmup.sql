-- games.is_practice never meant "belongs to a practice-type session" -- it
-- means "is the League session's unbounded warmup slot" (see 0024's fix for
-- the confusion this caused). Renaming to is_warmup to make that unambiguous.
-- Column rename is metadata-only (no table rewrite); no RLS policy or index
-- references the column by name in raw SQL.
alter table public.games rename column is_practice to is_warmup;
