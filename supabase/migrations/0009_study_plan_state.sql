-- ############################################################################
-- PHASE 7.1 — AUTOMATIC SCHEDULING STATE
-- Run this ONCE in the Supabase SQL Editor, after 0008.
--
-- The planner now runs automatically on dashboard load, but ONLY when its inputs
-- changed since the last run. We store a cheap fingerprint (hash) of those inputs
-- per user and compare it on load; if it matches, we skip the run entirely — no
-- wasted work and, importantly, existing study blocks are left undisturbed.
-- Per-user RLS, like every other table.
-- ############################################################################

create table if not exists public.study_plan_state (
  user_id uuid primary key references auth.users (id) on delete cascade,
  -- Fingerprint of the scheduler inputs at the last successful plan run.
  inputs_hash text,
  planned_at timestamptz,
  updated_at timestamptz not null default now()
);

alter table public.study_plan_state enable row level security;

create policy "Users manage their own study plan state"
  on public.study_plan_state for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
