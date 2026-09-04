-- Smart Calendar — initial schema (Phase 1)
--
-- Design notes:
--  * Every user-owned table has a `user_id` column and Row Level Security (RLS)
--    so a signed-in user can ONLY ever read or write their own rows. This is the
--    per-user isolation rule enforced at the database, not just in app code.
--  * We store a *snapshot* of Canvas data (courses, assignments, class events)
--    so the app is fast and works even when Canvas is slow. Freshness is shown
--    to the user via canvas_connections.last_synced_at.
--  * The Canvas token is the one real secret; it is stored ENCRYPTED (see the
--    app's crypto helper) in canvas_connections.access_token_encrypted.

-- ---------------------------------------------------------------------------
-- profiles: one row per signed-in user, created automatically on sign-up.
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

create policy "Users can view their own profile"
  on public.profiles for select
  using (auth.uid() = id);

-- Automatically create a profile row whenever a new auth user signs up.
-- Keeps setup frictionless: the user just signs in with Google, nothing to fill.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
begin
  insert into public.profiles (id) values (new.id)
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- canvas_connections: the link to the user's Canvas account. Holds the secret.
-- One connection per user (unique user_id).
-- ---------------------------------------------------------------------------
create table if not exists public.canvas_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  canvas_base_url text not null,
  -- Encrypted at the app layer (AES-256-GCM) before it ever reaches the DB.
  access_token_encrypted text not null,
  last_synced_at timestamptz,
  last_sync_status text not null default 'never', -- 'never' | 'ok' | 'error'
  last_sync_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id)
);

alter table public.canvas_connections enable row level security;

create policy "Users manage their own canvas connection"
  on public.canvas_connections for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- courses: snapshot of the user's active Canvas courses.
-- ---------------------------------------------------------------------------
create table if not exists public.courses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  canvas_course_id bigint not null,
  name text not null,
  updated_at timestamptz not null default now(),
  unique (user_id, canvas_course_id)
);

alter table public.courses enable row level security;

create policy "Users manage their own courses"
  on public.courses for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- assignments: snapshot of assignments and their due/lock/unlock dates.
-- due_at is nullable ON PURPOSE — "no due date" is a real state we display,
-- never a value we guess.
-- ---------------------------------------------------------------------------
create table if not exists public.assignments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  canvas_assignment_id bigint not null,
  course_id uuid references public.courses (id) on delete cascade,
  canvas_course_id bigint not null,
  title text not null,
  due_at timestamptz,
  unlock_at timestamptz,
  lock_at timestamptz,
  points_possible numeric,
  submission_types text[] not null default '{}',
  assignment_group_id bigint,
  assignment_group_name text,
  html_url text,
  updated_at timestamptz not null default now(),
  unique (user_id, canvas_assignment_id)
);

alter table public.assignments enable row level security;

create policy "Users manage their own assignments"
  on public.assignments for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create index if not exists assignments_user_due_idx
  on public.assignments (user_id, due_at);

-- ---------------------------------------------------------------------------
-- class_events: calendar events for the user's courses (e.g. class meetings,
-- office hours) that instructors put on the Canvas calendar. May be empty if a
-- course has no scheduled events — we show that honestly rather than invent one.
-- ---------------------------------------------------------------------------
create table if not exists public.class_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  canvas_event_id text not null,
  course_id uuid references public.courses (id) on delete set null,
  canvas_course_id bigint,
  title text not null,
  start_at timestamptz,
  end_at timestamptz,
  location_name text,
  html_url text,
  updated_at timestamptz not null default now(),
  unique (user_id, canvas_event_id)
);

alter table public.class_events enable row level security;

create policy "Users manage their own class events"
  on public.class_events for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create index if not exists class_events_user_start_idx
  on public.class_events (user_id, start_at);
