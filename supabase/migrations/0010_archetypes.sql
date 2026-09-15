-- ############################################################################
-- STAGE 1 — SCHEDULER ARCHETYPES
-- Run this ONCE in the Supabase SQL Editor, after 0001 … 0009.
--
-- Adds archetype metadata to two existing tables. Additive + nullable only, so
-- there is nothing to backfill: the next automatic plan run repopulates
-- study_blocks, and existing assignment_overrides simply have a null archetype
-- until the student answers the (now archetype-based) needs-input question.
--
-- The three archetypes are: 'memorization' | 'production' | 'completion'.
-- Nothing here writes to Canvas or Google. RLS is unchanged — the existing
-- per-user policies already cover the new columns.
-- ############################################################################

-- The student's confirmed ARCHETYPE answer for an ambiguous assignment, asked
-- once and remembered (survives re-syncs, keyed by canvas_assignment_id). Kept
-- alongside the old task_category column, which is now vestigial (left in place
-- for back-compat; a later migration may drop it).
alter table public.assignment_overrides
  add column if not exists archetype text;

-- What the planner actually placed, so the UI can cue the archetype and Stage 2
-- can place memorization tasks on their recorded spaced-review pattern.
alter table public.study_blocks
  add column if not exists archetype text;         -- archetype of the source task
alter table public.study_blocks
  add column if not exists spacing_schedule text;  -- e.g. '2-3-5-7' (memorization only; null otherwise)
