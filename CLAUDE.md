# Smart Calendar — Project Rules

Read `docs/DESIGN.md` for the full plan. These are the non-negotiables.

## Hard rules (never violate)
- Deterministic only. No AI/LLM logic anywhere. If a case seems to need it, STOP and ask.
- Read-only Canvas. Never write back to Canvas.
- No secrets in code, ever. Tokens/keys live in env vars or the database.
- Per-user isolation. One user can never see another's Canvas token or data.
- Surface uncertainty, never hide it. The app must never silently guess and present it as fact.
- Data collection must never add friction for the user.

## Stack
- Next.js (React) + Tailwind + shadcn/ui, deployed on Vercel (free tier)
- Supabase for Postgres + auth (free tier)
- Canvas REST API, personal access token, base URL: https://mtu.instructure.com

## Code standards (this matters — a human, not just you, must understand this repo)
- Simple and readable over clever. No premature abstraction.
- Plain file/folder names. A newcomer should guess what each file does.
- Comment the WHY, not the what, especially in the scheduler logic.
- Keep a clear README explaining setup and how the pieces fit, written for a beginner.

## Workflow
- We work ONE phase at a time. Do not build ahead of the current phase.
- Write and run tests. Verify the build passes before saying a task is done.
- The user handles all dashboard clicks (Supabase project, Vercel deploy, env vars). Ask for what you need; don't guess credentials.

---

# Project status & handoff (living notes)

> Keep this section current at the end of each working session. It is the running
> record for the next Claude chat. The rules above are fixed; this part changes.

## Where things stand (last updated: after hyper-focus text-readability fix)
- **`main` is the source of truth and has EVERYTHING**: Phase 1 (Canvas sync +
  calendar) + Phase 2 (event management) + the Hyper Focus theme + its color fixes.
  Latest `main` commit: `27a725c`.
- Tests: **28 passing** (`npx vitest run`). Production build: **green** (`npm run build`).
- The app runs on Vercel + Supabase (free tiers). User tests locally, then pulls `main`.

## Environment reality (IMPORTANT — caused real confusion this project)
- Claude Code here runs in a **remote cloud container** with a fresh clone. It does
  **NOT** see the user's local working copy. If the user says "I edited X / I built Y"
  and it's not in the branch, it's because their change is **local and unpushed**.
  Ask them to `git add -A && git commit && git push`, or paste the file. Don't guess.

## Branches (none deleted — user wanted them kept for now)
- `main` — everything; deploy from here.
- `claude/smart-calendar-rules-lgoxtz` — Phase 2 only (already merged into `main`).
- `claude/dashboard-polish`, `claude/readability-pass`, `claude/week-timegrid` — old
  Phase 1 work, already merged historically. Safe to delete once user confirms.

## Features complete
### Phase 1 — Canvas sync + calendar (done, merged)
- Google sign-in (Supabase auth), encrypted Canvas token, read-only sync of
  assignments + class events into Postgres, week/month calendar (display only).

### Phase 2 — User event management (done, merged, on `main`)
- Users create/edit/move/resize/delete THEIR OWN events; Canvas data stays read-only
  and non-draggable. Weekly-repeat series with per-occurrence overrides (edit/move one
  instance silently becomes an exception; delete one instance keeps the series).
- Key files: `src/lib/recurrence.ts` (pure expansion + overrides, unit-tested),
  `src/app/events/actions.ts` (server actions, per-user RLS), `src/components/event-dialog.tsx`
  (create/edit modal, This-event vs Whole-series scope), `src/components/calendar-view.tsx`
  (interactive layer: click-to-create/edit, pointer drag/resize, optimistic local state),
  `src/lib/event-colors.ts` (color palette → Tailwind classes).
- Optimistic UI: `CalendarView` seeds `localEvents`/`localOverrides` ONCE from props and
  mutates locally + calls the server action + reverts on error (no router.refresh).
- **DB migration REQUIRED**: `supabase/migrations/0002_user_events.sql` (tables
  `user_events` + `user_event_overrides`, both per-user RLS). The user has run it in
  Supabase. Any new Supabase project must run `0001_init.sql` then `0002_user_events.sql`.
- Bug fixed during Phase 2: the Monday-first week was built by rotating a Sunday-first
  array, which collapsed the week's date range to zero width and hid all user events.
  `mondayFirst(anchor)` in `calendar-view.tsx` now builds 7 consecutive Mon..Sun days.

### Hyper Focus theme (done, merged, on `main`)
- Third theme option beside light/dark: deep navy page, light text, warm-gold accents.
- Mechanism: class `.hyper-focus` on `<html>` (set by `src/components/theme-toggle.tsx`,
  applied pre-paint by the script in `src/app/layout.tsx`; stored in `localStorage`
  `theme` = `"light" | "dark" | "hyper-focus"`). Tailwind custom variant registered in
  `globals.css`: `@custom-variant hyper-focus (&:is(.hyper-focus *))`.
- **Theming is token-based**: `@theme inline` maps `--color-*` to `var(--*)`, and
  `.hyper-focus { --foreground/--muted-foreground/... }` overrides them to light values.
  So all token text (`text-foreground`, `text-muted-foreground`, `text-card-foreground`,
  etc.) is automatically readable in hyper mode — same mechanism as dark mode.
- Color-bug fixes done: (1) the dashboard shell gradient (`page.tsx`) had only
  light+dark variants and showed white in hyper → added `hyper-focus:bg-none`; (2) all
  HARDCODED palette colors (amber assignment text, the 6 user-event block colors in
  `event-colors.ts`, blue class-event blocks/month chips, settings success message) had
  only light+dark variants and fell back to near-black on navy → added light
  `hyper-focus:text-*` variants at each spot.

## Golden rule when touching hyper mode
- Keep EVERYTHING scoped to hyper: edit only the `.hyper-focus` block in `globals.css`
  or add `hyper-focus:` utility variants. NEVER change `:root` (light) or `.dark`.
  Verify light and dark render identically to before (the diff should be purely
  additive `hyper-focus:` classes). Only `settings-form.tsx`, `calendar-view.tsx`, and
  `event-colors.ts` contain hardcoded palette text; everything else uses tokens.

## Open / next items
- **Unverified**: I reasoned (via the dark-mode-parity argument) that token-based text
  is already light/readable in hyper mode, but did NOT confirm it in a real browser.
  User is checking. If any token text (header, panel labels, dialog text, day/hour
  labels) still reads dark in hyper, investigate the token pipeline — don't just
  whack-a-mole component classes.
- Debug logging left in `createEventAction` (`src/app/events/actions.ts`) — only logs on
  a failed insert. Harmless; remove if desired.
- Not built yet / future phases: real To-Do panel logic (currently a static placeholder),
  and anything past Phase 2. Work ONE phase at a time; ask before building ahead.

## Attribution for commits (this project)
- `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>` and a `Claude-Session:` line.
  Do NOT put any model identifier in code, comments, PR titles/bodies — chat only.
