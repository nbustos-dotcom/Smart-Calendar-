-- ############################################################################
-- PHASE 3 — HIDDEN (removed) COURSES
-- Run this ONCE in the Supabase SQL Editor, after 0001_init.sql and
-- 0002_user_events.sql.
--
-- Lets a user REMOVE a Canvas course from Smart Calendar. When a course is
-- removed we delete its synced assignments/events AND record its id here, so the
-- next Canvas sync skips it and its assignments never come back. Re-adding a
-- course just deletes its row here; the next sync repulls it.
--
-- Per-user Row Level Security, matching the existing tables.
-- ############################################################################

create table if not exists public.hidden_courses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  canvas_course_id bigint not null,
  hidden_at timestamptz not null default now(),
  unique (user_id, canvas_course_id)
);

alter table public.hidden_courses enable row level security;

create policy "Users manage their own hidden courses"
  on public.hidden_courses for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create index if not exists hidden_courses_user_idx
  on public.hidden_courses (user_id);
