-- Phase 1: core schema + Row Level Security
-- Run this in the Supabase SQL Editor (Project -> SQL Editor -> New query).

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  team_name text,
  created_at timestamptz not null default now()
);

create table public.balls (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  brand_model text,
  weight numeric,
  layout_notes text,
  created_at timestamptz not null default now()
);

create table public.approaches (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  reference_ball_id uuid references public.balls (id) on delete set null,
  reference_lineup text,
  reference_slide text,
  reference_target_type text check (reference_target_type in ('board', 'arrow', 'pin')),
  reference_target_value integer,
  notes text,
  created_at timestamptz not null default now()
);

create table public.sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  alley_name text,
  lane_number integer,
  session_date date not null default current_date,
  session_type text not null check (session_type in ('league', 'practice')),
  lane_condition_notes text,
  league_team_name text,
  created_at timestamptz not null default now()
);

create table public.games (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions (id) on delete cascade,
  game_number integer check (game_number between 1 and 3),
  is_practice boolean not null default false,
  final_score integer check (final_score between 0 and 300),
  created_at timestamptz not null default now()
);

create table public.frames (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references public.games (id) on delete cascade,
  frame_number integer check (frame_number between 1 and 10),
  created_at timestamptz not null default now()
);

create table public.shots (
  id uuid primary key default gen_random_uuid(),
  frame_id uuid not null references public.frames (id) on delete cascade,
  ball_id uuid references public.balls (id) on delete set null,
  approach_id uuid references public.approaches (id) on delete set null,
  lineup_position text,
  slide_position text,
  target_type text check (target_type in ('board', 'arrow', 'pin')),
  target_value integer,
  pins_standing smallint[] not null default '{}',
  strike boolean not null default false,
  spare boolean not null default false,
  hook_timing text,
  miss_direction text,
  breakpoint_board integer,
  note text,
  created_at timestamptz not null default now(),
  constraint pins_standing_valid check (pins_standing <@ array[1, 2, 3, 4, 5, 6, 7, 8, 9, 10]::smallint[])
);

create index balls_user_id_idx on public.balls (user_id);
create index approaches_user_id_idx on public.approaches (user_id);
create index sessions_user_id_idx on public.sessions (user_id);
create index games_session_id_idx on public.games (session_id);
create index frames_game_id_idx on public.frames (game_id);
create index shots_frame_id_idx on public.shots (frame_id);

alter table public.profiles enable row level security;
alter table public.balls enable row level security;
alter table public.approaches enable row level security;
alter table public.sessions enable row level security;
alter table public.games enable row level security;
alter table public.frames enable row level security;
alter table public.shots enable row level security;

create policy "profiles are self" on public.profiles
  for all using (auth.uid() = id) with check (auth.uid() = id);

create policy "balls are own" on public.balls
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "approaches are own" on public.approaches
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "sessions are own" on public.sessions
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "games are own" on public.games
  for all using (
    exists (
      select 1 from public.sessions s
      where s.id = games.session_id and s.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.sessions s
      where s.id = games.session_id and s.user_id = auth.uid()
    )
  );

create policy "frames are own" on public.frames
  for all using (
    exists (
      select 1 from public.games g
      join public.sessions s on s.id = g.session_id
      where g.id = frames.game_id and s.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.games g
      join public.sessions s on s.id = g.session_id
      where g.id = frames.game_id and s.user_id = auth.uid()
    )
  );

create policy "shots are own" on public.shots
  for all using (
    exists (
      select 1 from public.frames f
      join public.games g on g.id = f.game_id
      join public.sessions s on s.id = g.session_id
      where f.id = shots.frame_id and s.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.frames f
      join public.games g on g.id = f.game_id
      join public.sessions s on s.id = g.session_id
      where f.id = shots.frame_id and s.user_id = auth.uid()
    )
  );

-- Auto-create a profile row whenever a new auth user signs up.
create function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id) values (new.id);
  return new;
end;
$$ language plpgsql security definer set search_path = public;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
