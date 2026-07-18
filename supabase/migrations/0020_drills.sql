-- Drill mode: standalone target-leave practice, decoupled from sessions/games/frames/shots.
-- Run this in the Supabase SQL Editor.

create table public.drills (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  leave smallint[] not null default '{}' check (leave <@ array[1, 2, 3, 4, 5, 6, 7, 8, 9, 10]::smallint[]),
  ended_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.drill_shots (
  id uuid primary key default gen_random_uuid(),
  drill_id uuid not null references public.drills (id) on delete cascade,
  ball_id uuid references public.balls (id) on delete set null,
  approach_id uuid references public.approaches (id) on delete set null,
  lineup_position text,
  slide_position text,
  target_type text check (target_type in ('board', 'arrow', 'pin')),
  target_value numeric,
  pins_standing smallint[] not null default '{}',
  strike boolean not null default false,
  spare boolean not null default false,
  foul boolean not null default false,
  hook_timing text,
  miss_direction text,
  breakpoint_board numeric,
  note text,
  created_at timestamptz not null default now(),
  constraint drill_pins_standing_valid check (pins_standing <@ array[1, 2, 3, 4, 5, 6, 7, 8, 9, 10]::smallint[])
);

alter table public.drills enable row level security;
alter table public.drill_shots enable row level security;

create policy "drills are own" on public.drills
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "drill_shots are own" on public.drill_shots
  for all using (
    exists (select 1 from public.drills d where d.id = drill_shots.drill_id and d.user_id = auth.uid())
  )
  with check (
    exists (select 1 from public.drills d where d.id = drill_shots.drill_id and d.user_id = auth.uid())
  );
