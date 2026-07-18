-- Drills can now switch target leave mid-drill: drills.leave becomes the drill's
-- CURRENT/next target (changeable via "Change Target" on the drill page), and each
-- logged shot snapshots the target it was actually thrown at into its own row, so
-- switching targets later doesn't rewrite history or misattribute past shots'
-- conversion stats.
-- Run this in the Supabase SQL Editor.

alter table public.drill_shots
  add column leave smallint[] not null default '{}'
  check (leave <@ array[1, 2, 3, 4, 5, 6, 7, 8, 9, 10]::smallint[]);

update public.drill_shots ds
set leave = d.leave
from public.drills d
where d.id = ds.drill_id;
