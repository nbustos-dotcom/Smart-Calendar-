-- ############################################################################
-- STAGE A — SCHEDULER FOUNDATION (domain model schema + data substrate +
-- concurrency fix). Run this ONCE in the Supabase SQL Editor, after 0001 … 0010.
--
-- Everything here is additive/nullable with behavior-preserving defaults, EXCEPT
-- the concurrency fix (a new function), which changes no plan output — it just
-- stops two concurrent planner runs from both inserting (the duplicate-blocks
-- bug). Nothing here writes to Canvas or Google. RLS is unchanged; existing
-- per-user policies already cover the new columns.
-- ############################################################################

-- 1) student_preferences — per-student reasonable-hours / capacity model.
--    Created now so Stage B/D can read it; NOT read by the engine yet, so it has
--    no effect on the current schedule. Sensible defaults mirror today's fixed
--    08:00–22:00 window closely enough that turning it on later is a deliberate
--    step, not an accident.
create table if not exists public.student_preferences (
  user_id uuid primary key references auth.users (id) on delete cascade,
  weekday_start_minute integer not null default 540,   -- 09:00
  weekday_end_minute   integer not null default 1320,  -- 22:00
  weekend_start_minute integer not null default 600,   -- 10:00
  weekend_end_minute   integer not null default 1200,  -- 20:00
  max_weekday_minutes  integer not null default 180,   -- daily study cap (weekday)
  max_weekend_minutes  integer not null default 240,   -- daily study cap (weekend)
  quality_bands   jsonb not null default '[]'::jsonb,  -- time-of-day quality (Stage B/D)
  blackout_windows jsonb not null default '[]'::jsonb, -- hard no-study times (Stage B/D)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.student_preferences enable row level security;

create policy "Users manage their own scheduler preferences"
  on public.student_preferences for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- 2) exams — represent an exam as a real EVENT (a sitting), not just a deadline.
--    Defaults preserve today's behavior: time is known, entered manually, no end
--    time. Stage C uses these to model the sitting as a fixed commitment.
alter table public.exams add column if not exists ends_at timestamptz;
alter table public.exams add column if not exists time_known boolean not null default true;
alter table public.exams add column if not exists source text not null default 'manual';

-- 3) study_blocks — data-collection substrate. We record the effort estimate and
--    how it was derived for every placed block (recorded now, learned from later).
alter table public.study_blocks add column if not exists estimate_minutes integer;
alter table public.study_blocks add column if not exists estimate_basis text;

-- 4) CONCURRENCY / DUPLICATION FIX — single-flight claim on study_plan_state.
--    Atomically records the inputs hash and returns TRUE only to the caller that
--    actually advanced it (an upsert guarded by is-distinct-from). The planner
--    claims BEFORE running, so only one concurrent invocation regenerates for a
--    given input set — closing the check-then-act race that inserted the plan
--    twice. Returns NULL (→ falsey) to callers that did not win the claim.
create or replace function public.claim_study_plan_run(p_hash text)
returns boolean
language sql
security invoker
as $$
  insert into public.study_plan_state (user_id, inputs_hash, planned_at, updated_at)
  values (auth.uid(), p_hash, now(), now())
  on conflict (user_id) do update
    set inputs_hash = excluded.inputs_hash,
        planned_at  = now(),
        updated_at  = now()
    where public.study_plan_state.inputs_hash is distinct from p_hash
  returning true;
$$;

grant execute on function public.claim_study_plan_run(text) to authenticated;
