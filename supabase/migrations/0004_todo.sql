-- ############################################################################
-- PHASE 4 — DAY-SCOPED TO-DO LIST
-- Run this ONCE in the Supabase SQL Editor, after 0001_init.sql,
-- 0002_user_events.sql, and 0003_hidden_courses.sql.
--
-- Two per-user tables (RLS matching the existing tables):
--   * todo_items       — the user's own manual to-dos, each pinned to a day.
--   * assignment_done  — marks a Canvas assignment as done WITHOUT mutating the
--     read-only assignments snapshot (we never write back to Canvas data).
-- ############################################################################

-- ---------------------------------------------------------------------------
-- todo_items: manual to-do entries, one per row, scoped to a calendar day.
-- ---------------------------------------------------------------------------
create table if not exists public.todo_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  day date not null,               -- the day this item belongs to (local date)
  text text not null,
  done boolean not null default false,
  created_at timestamptz not null default now()
);

alter table public.todo_items enable row level security;

create policy "Users manage their own todo items"
  on public.todo_items for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create index if not exists todo_items_user_day_idx
  on public.todo_items (user_id, day);

-- ---------------------------------------------------------------------------
-- assignment_done: a Canvas assignment the user has ticked off. Keyed by the
-- Canvas assignment id so it survives re-syncs, and kept separate so the
-- assignments snapshot stays read-only. Presence of a row = done.
-- ---------------------------------------------------------------------------
create table if not exists public.assignment_done (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  canvas_assignment_id bigint not null,
  done_at timestamptz not null default now(),
  unique (user_id, canvas_assignment_id)
);

alter table public.assignment_done enable row level security;

create policy "Users manage their own assignment completion"
  on public.assignment_done for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create index if not exists assignment_done_user_idx
  on public.assignment_done (user_id);
