-- ############################################################################
-- PHASE 4.1 — OPTIONAL TIME ON MANUAL TO-DO ITEMS
-- Run this ONCE in the Supabase SQL Editor, after 0004_todo.sql.
--
-- Adds a nullable time to todo_items. Stored as text "HH:MM" (24-hour, zero
-- padded), which the app reads/writes directly and sorts lexicographically
-- (that ordering is chronological for zero-padded HH:MM). NULL = "no time".
-- Only manual to-do items have this; Canvas assignments keep their own due time.
-- ############################################################################

alter table public.todo_items
  add column if not exists "time" text;
