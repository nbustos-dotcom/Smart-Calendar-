-- ############################################################################
-- PHASE 6 — GOOGLE CALENDAR CONNECTION (read-only)
-- Run this ONCE in the Supabase SQL Editor, after 0001_init.sql … 0006_assignment_status.sql.
--
-- Stores the per-user OAuth tokens for read-only Google Calendar access. Mirrors
-- canvas_connections: one row per user, holds the secrets, protected by per-user
-- Row Level Security. The tokens are the real secrets, so — exactly like the
-- Canvas token — they are ENCRYPTED at the app layer (AES-256-GCM, see
-- src/lib/crypto.ts) BEFORE they ever reach the database. Nothing here is ever
-- returned to the browser.
--
-- This migration only scaffolds token storage; fetching/showing calendar events
-- is a separate later step and adds no columns here.
-- ############################################################################

create table if not exists public.google_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  -- Both encrypted at the app layer before insert. The refresh token is what
  -- lets us keep reading without asking the user to re-consent, so we keep it.
  access_token_encrypted text not null,
  refresh_token_encrypted text,
  -- When the current access token expires (used later to know when to refresh).
  token_expiry timestamptz,
  -- The scope Google actually granted (expected: calendar.readonly).
  scope text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id)
);

alter table public.google_connections enable row level security;

create policy "Users manage their own google connection"
  on public.google_connections for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
