-- ############################################################################
-- PHASE 7 — DETERMINISTIC STUDY SCHEDULER (v1: engine only)
-- Run this ONCE in the Supabase SQL Editor, after 0001 … 0007.
--
-- Three tables, all per-user RLS (auth.uid() = user_id), matching the existing
-- pattern. They are kept SEPARATE from the Canvas snapshot on purpose:
--   * exams              — tests the student enters (Canvas can't expose these)
--   * assignment_overrides — the student's persisted answers (task type / est /
--     skip) keyed by canvas_assignment_id so they SURVIVE re-syncs (the
--     assignments snapshot is upsert-replaced every sync)
--   * study_blocks       — the scheduler's OUTPUT, never mixed with Canvas facts
--
-- Nothing here writes to Canvas or Google. The learning loop (measuring actual
-- durations, self-correcting buffers, learning from moves) is a LATER phase and
-- adds no columns here.
-- ############################################################################

-- ---------------------------------------------------------------------------
-- exams: student-entered tests (spacing-driven prep).
-- ---------------------------------------------------------------------------
create table if not exists public.exams (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  title text not null,
  course_name text,
  exam_at timestamptz not null,
  -- Optional: the student's own estimate of TOTAL prep minutes. When null the
  -- scheduler falls back to a fixed default (see src/lib/scheduler-config.ts).
  est_prep_minutes integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.exams enable row level security;

create policy "Users manage their own exams"
  on public.exams for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create index if not exists exams_user_at_idx on public.exams (user_id, exam_at);

-- ---------------------------------------------------------------------------
-- assignment_overrides: the student's persisted answers about a Canvas
-- assignment. Keyed by canvas_assignment_id (stable across syncs), so a
-- re-sync of the assignments snapshot never wipes these answers.
-- ---------------------------------------------------------------------------
create table if not exists public.assignment_overrides (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  canvas_assignment_id bigint not null,
  -- The confirmed task category (e.g. 'reading','problem_set','essay',...).
  -- Once set, the scheduler uses it and never re-asks.
  task_category text,
  -- Optional per-assignment student estimate (minutes). Gets the 1.4x buffer.
  est_minutes integer,
  -- Student can opt an assignment out of scheduling entirely.
  skip boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, canvas_assignment_id)
);

alter table public.assignment_overrides enable row level security;

create policy "Users manage their own assignment overrides"
  on public.assignment_overrides for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- study_blocks: the scheduler's output — concrete times to work.
-- Regenerated on each plan run: rows with moved_by_user = false are replaced;
-- rows the student has dragged (moved_by_user = true) are KEPT and treated as
-- fixed busy time on the next run, so the scheduler works around them.
-- ---------------------------------------------------------------------------
create table if not exists public.study_blocks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  -- What this block is prep for. Exactly one of the two id columns is set.
  source_kind text not null, -- 'assignment' | 'exam'
  canvas_assignment_id bigint,
  exam_id uuid references public.exams (id) on delete cascade,
  title text not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  -- Three-state honesty (see DESIGN.md §7).
  state text not null default 'scheduled', -- 'scheduled' | 'reserved' | 'needs_input'
  reason text,
  session_index integer,
  session_count integer,
  -- Set true once the student drags the block; keeps the planner from moving it.
  moved_by_user boolean not null default false,
  generated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.study_blocks enable row level security;

create policy "Users manage their own study blocks"
  on public.study_blocks for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create index if not exists study_blocks_user_start_idx
  on public.study_blocks (user_id, starts_at);
