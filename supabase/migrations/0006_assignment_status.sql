-- ############################################################################
-- PHASE 5 — CANVAS SUBMISSION / GRADING STATE ON ASSIGNMENTS
-- Run this ONCE in the Supabase SQL Editor, after 0001_init.sql … 0005_todo_time.sql.
--
-- Records, per synced assignment, whether the student has SUBMITTED it and
-- whether it's been GRADED on Canvas. These are Canvas-sourced snapshot fields
-- (read-only, like the rest of the assignments row), refreshed each sync and
-- keyed by the stable (user_id, canvas_assignment_id), so they survive re-syncs.
-- We never store the score/grade — only the two booleans.
-- ############################################################################

alter table public.assignments
  add column if not exists submitted boolean not null default false,
  add column if not exists graded boolean not null default false;
