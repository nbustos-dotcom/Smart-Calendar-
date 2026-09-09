-- ############################################################################
-- PHASE 2 — USER EVENTS (create/edit/move/delete + weekly repeats)
-- Run this ONCE in the Supabase SQL Editor, after 0001_init.sql.
-- Adds two tables (both per-user RLS): the user's own events, and per-occurrence
-- exceptions for repeating events. Canvas/synced data is untouched.
-- ############################################################################

-- ---------------------------------------------------------------------------
-- user_events: one row is EITHER a single event OR a weekly-recurring series.
--
--  * Single event (is_recurring = false): use starts_at / ends_at (concrete).
--  * Recurring series (is_recurring = true): use weekdays + start_minute /
--    end_minute (time of day) + series_start_date. It repeats indefinitely on
--    those weekdays at that time. Individual occurrences can be overridden in
--    the user_event_overrides table below.
-- ---------------------------------------------------------------------------
create table if not exists public.user_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  title text not null,
  color text not null default 'blue',
  is_recurring boolean not null default false,

  -- Single event only (null for recurring):
  starts_at timestamptz,
  ends_at timestamptz,

  -- Recurring series only (null/empty for single):
  weekdays smallint[] not null default '{}', -- 0=Sun .. 6=Sat
  start_minute smallint,                      -- minutes from midnight
  end_minute smallint,
  series_start_date date,                     -- series doesn't render before this

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.user_events enable row level security;

create policy "Users manage their own events"
  on public.user_events for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create index if not exists user_events_user_idx
  on public.user_events (user_id);

-- ---------------------------------------------------------------------------
-- user_event_overrides: a per-occurrence exception for a recurring series.
--
--  * occurrence_date is the ORIGINAL pattern date the override replaces — this
--    is how we know which occurrence it belongs to, even after the user drags
--    that occurrence to a different day/time.
--  * status 'cancelled' hides just that one occurrence (series continues).
--  * status 'modified' replaces that occurrence's time (and optionally its
--    title/color) with the values here; other occurrences are unaffected.
-- ---------------------------------------------------------------------------
create table if not exists public.user_event_overrides (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  event_id uuid not null references public.user_events (id) on delete cascade,
  occurrence_date date not null,            -- the pattern date being overridden
  status text not null default 'modified',  -- 'modified' | 'cancelled'

  -- For 'modified' (fall back to the series when null):
  starts_at timestamptz,
  ends_at timestamptz,
  title text,
  color text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (event_id, occurrence_date)
);

alter table public.user_event_overrides enable row level security;

create policy "Users manage their own event overrides"
  on public.user_event_overrides for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create index if not exists user_event_overrides_event_idx
  on public.user_event_overrides (event_id);
