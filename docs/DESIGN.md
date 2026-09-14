# Smart Calendar — Design & Plan

This is the full plan for the project. It is written to be read top to bottom by
someone new to the codebase. If you only read one file to understand what we are
building and why, read this one.

> **Status:** Draft for review. Nothing here is code yet. Sections marked
> **⚠️ Assumption** are my best guess and need a yes/no from you before we build on
> them. (Per the project rule: surface uncertainty, never hide it.)

---

## 1. What we are building (in one paragraph)

A student opens the app and sees a single, honest calendar of everything they owe
Canvas — assignments, quizzes, and their due dates — pulled straight from their
Canvas account. On top of that raw list, the app deterministically suggests *when*
to work on things, so a big assignment due Friday doesn't ambush them Thursday
night. No magic, no AI guessing. Every suggestion can be traced back to a plain
rule the student can read and predict.

**The core promise:** the app never invents facts. If Canvas doesn't give us a due
date, we show "no due date" — we never guess one.

---

## 2. Who it's for and what problem it solves

- **User:** a single student (you, to start) at Michigan Tech, using
  `https://mtu.instructure.com`.
- **Problem:** Canvas shows assignments course-by-course. There is no single view
  of "what's due across all my classes, and when should I actually start each one?"
- **Non-goals (for now):** group scheduling, sharing calendars, syncing *back* to
  Canvas or Google Calendar, mobile app. We can revisit later.

---

## 3. The hard rules, restated as design constraints

These come from `CLAUDE.md`. Here's what each one *means* for the design:

| Rule | What it forces in the design |
|---|---|
| **Deterministic only** | The scheduler is plain if/then rules on dates and durations. Given the same Canvas data, it always produces the same plan. No model calls, no randomness. |
| **Read-only Canvas** | We only ever call Canvas `GET` endpoints. There is no code path that writes to Canvas. |
| **No secrets in code** | The Canvas token is entered by the user and stored in the database (encrypted at rest), never in a file or committed anywhere. |
| **Per-user isolation** | Every row we store is tagged with a user id. Supabase Row Level Security (RLS) enforces that a user can only ever read their own rows — at the database level, not just in app code. |
| **Surface uncertainty** | Missing due dates, ambiguous data, and stale syncs are shown as explicit states in the UI, never hidden or filled in. |
| **No friction in data collection** | Setup is: sign in, paste one Canvas token, done. After that, syncing is automatic/one-click. We never ask the student to hand-enter assignments. |

---

## 4. Architecture at a glance

```
  ┌─────────────────────────────────────────────┐
  │  Browser (Next.js + React + Tailwind +       │
  │  shadcn/ui)                                   │
  │   - Calendar / list views                     │
  │   - "Connect Canvas" settings screen          │
  └───────────────┬───────────────────────────────┘
                  │  (only talks to our own server)
  ┌───────────────▼───────────────────────────────┐
  │  Next.js server (API routes on Vercel)         │
  │   - Auth via Supabase                          │
  │   - Sync job: pulls from Canvas, writes to DB  │
  │   - Scheduler: deterministic plan from DB rows │
  └───────┬───────────────────────┬────────────────┘
          │                       │
  ┌───────▼────────┐     ┌────────▼───────────────┐
  │  Supabase       │     │  Canvas REST API        │
  │  (Postgres +    │     │  (GET only,             │
  │   Auth + RLS)   │     │   mtu.instructure.com)  │
  └─────────────────┘     └─────────────────────────┘
```

**Key point:** the browser never talks to Canvas directly. The Canvas token stays
on the server side, so it is never exposed to the user's browser or to other users.

---

## 5. Data model (Postgres tables)

Plain tables, plain names. Every user-owned table has a `user_id` column and an RLS
policy so a user can only touch their own rows.

### `profiles`
One row per signed-in user. Created automatically on sign-up.
- `id` (uuid, = Supabase auth user id, primary key)
- `created_at`

### `canvas_connections`
The link between our user and their Canvas account. **This holds the secret.**
- `id` (uuid)
- `user_id` (uuid → profiles.id)
- `canvas_base_url` (text, e.g. `https://mtu.instructure.com`)
- `access_token` (text, **encrypted at rest** — see §8)
- `last_synced_at` (timestamp, nullable — null means "never synced")
- `last_sync_status` (text: `ok` | `error` | `never`)
- `last_sync_error` (text, nullable — the plain reason if it failed)

### `courses`
A snapshot of the user's Canvas courses. Refreshed on each sync.
- `id` (uuid)
- `user_id` (uuid)
- `canvas_course_id` (bigint — the id Canvas uses)
- `name` (text)
- `updated_at`

### `assignments`
The heart of it — a snapshot of everything due.
- `id` (uuid)
- `user_id` (uuid)
- `canvas_assignment_id` (bigint)
- `course_id` (uuid → courses.id)
- `title` (text)
- `due_at` (timestamp, **nullable** — null is a real, displayed state: "no due date")
- `points_possible` (numeric, nullable)
- `html_url` (text — deep link back to Canvas so the student can open the real thing)
- `updated_at`

### `exams` *(scheduler phase)*
Tests the student enters — Canvas can't reliably expose exams, and they're
spacing-driven, not deadline-driven.
- `id` (uuid), `user_id` (uuid)
- `title` (text), `course_name` (text, nullable)
- `exam_at` (timestamp — when the test is)
- `est_prep_minutes` (int, nullable — the student's estimate of TOTAL prep)

### `assignment_overrides` *(scheduler phase)*
The student's persisted answers about a Canvas assignment, keyed by
`canvas_assignment_id` so they SURVIVE re-syncs (the `assignments` snapshot is
upsert-replaced every sync, so answers can't live on that row).
- `id` (uuid), `user_id` (uuid), `canvas_assignment_id` (bigint)
- `task_category` (text, nullable — the confirmed type; once set we never re-ask)
- `est_minutes` (int, nullable — a per-assignment student estimate)
- `skip` (bool — opt an assignment out of scheduling)

### `study_blocks` *(scheduler phase)*
The scheduler's output — concrete times to work. Kept separate from `assignments`
so we never confuse "what Canvas said" with "what we suggested."
- `id` (uuid), `user_id` (uuid)
- `source_kind` (text: `assignment` | `exam`) + `canvas_assignment_id` (bigint,
  nullable) / `exam_id` (uuid → exams.id, nullable)
- `title` (text), `starts_at` / `ends_at` (timestamp)
- `state` (text: `scheduled` | `reserved` | `needs_input` — the three-state
  honesty system, see §7)
- `reason` (text — the human-readable rule that produced this block)
- `session_index` / `session_count` (int — "session 2 of 3")
- `moved_by_user` (bool — set when the student drags the block; the planner then
  treats it as fixed and schedules around it, never fighting the student)

> **⚠️ Assumption:** we snapshot Canvas data into our DB (rather than fetching live
> on every page load). This makes the app fast, works when Canvas is slow, and lets
> us show "last synced 10 min ago." The tradeoff is data can be slightly stale — which
> we show explicitly. Confirm you're OK with the snapshot approach.

---

## 6. Canvas integration (read-only)

We use the Canvas REST API with a **personal access token** the student generates in
their own Canvas settings. Base URL: `https://mtu.instructure.com`.

Endpoints we need (all `GET`):
- `GET /api/v1/courses?enrollment_state=active` — the student's current courses.
- `GET /api/v1/courses/:id/assignments` — assignments per course (title, `due_at`,
  `points_possible`, `html_url`).

Handling reality:
- **Pagination:** Canvas paginates. We follow the `Link` header until there are no
  more pages. (Common beginner gotcha — worth a comment in the code.)
- **Rate limits:** we sync on demand / on a modest schedule, not in a tight loop.
- **Failures:** if Canvas returns 401 (bad/expired token) or any error, we store
  `last_sync_status = error` with a plain message and show it. We never silently
  drop assignments or show a stale list as if it were fresh.

> **⚠️ Assumption:** the student generates their own Canvas token
> (Canvas → Account → Settings → New Access Token) and pastes it in once. That's the
> lowest-friction path that needs no Canvas admin/OAuth app approval. If you'd rather
> do a full OAuth "Login with Canvas" flow later, that's a bigger phase — flag it.

---

## 7. The scheduler (deterministic rules)

This is the "smart" part, and it is deliberately *not* clever. It is a short list of
rules a student could apply by hand — **deterministic, no AI/ML anywhere**. Given the
same inputs it always produces the same plan, so it's trivially unit-testable (feed it
tasks + busy time, assert the exact blocks). The pure engine lives in
`src/lib/scheduler.ts`; all tunable numbers live in one place,
`src/lib/scheduler-config.ts`.

> This section describes the scheduler as actually built (v1: engine only). The
> **learning loop** — measuring how long tasks really took, self-correcting the
> duration buffer, time-of-day/fatigue preferences, learning from drag history,
> and writing blocks back to Google — is a **later phase** and is deliberately
> NOT built yet. v1 ships good fixed defaults.

**Two task types, scheduled differently:**
- **Assignments (Canvas) — deadline-driven.** Place enough work time *before* the due
  date, split into focus chunks. The type is inferred deterministically from Canvas
  fields (`submission_types`, `assignment_group_name`, title, points) into a category
  (reading / quiz / problem_set / lab / essay / project). If the type is genuinely
  uncertain, the scheduler asks the student **once** and stores the answer
  (`assignment_overrides`) so it never re-asks.
- **Exams — spacing-driven.** The student enters them (`exams`). Prep is distributed
  across several sessions leading up to the test (the spacing effect) rather than
  massed the night before.

**Duration estimation (defeats the planning fallacy).** A fallback ladder:
1. the student's own estimate → **×1.4 buffer** (fixed this version);
2. category history average → *(deferred; no data until the learning loop, so skipped in v1)*;
3. category default (fixed per-category minutes, used as-is — already padded);
4. unknown → the task is flagged **Needs Input**.
When uncertain we over-allocate and start earlier — missing a deadline is worse than
finishing early.

**Placement.**
- Assignments backward-schedule from the deadline into real free time (time not taken
  by class events, the student's own events, Google events, or study blocks they've
  moved), spread **earliest-first** across the days before the due date, guaranteed to
  finish before it. Long work is chunked into ≤90-min focus sessions.
- Exams use the **spacing effect**: one session roughly every `gap` days, where
  `gap ≈ 0.2 × days-until-test`, always starting earlier over later. A test in 2 days →
  ~one session per day, not a single block the night before.
  > **⚠️ Caveat (deliberate v1 approximation).** Using *days-until-test* as the spacing
  > base is a simplification, **not** a literal implementation of the science. The
  > spacing-effect literature spaces on the **retention interval** — how long the
  > material must be retained — which for a real exam is longer than the time until it.
  > `gap ≈ 0.2 × days-until-test` is a reasonable, tunable stand-in for v1
  > (`SPACING_FRACTION` in the config) and is a known thing to revisit.
- Multiple competing deadlines are handled by ordering tasks earliest-deadline-first and
  removing each placed slot from the free pool, so nothing double-books and work spreads
  across the available time.

**Three-state honesty (surface uncertainty, never guess silently).** Every block is:
- **Scheduled** — enough info to place it confidently (type known, placed in free time
  before the deadline);
- **Reserved** — a placeholder held because it couldn't fully fit before the deadline
  (an honest "not enough free time" flag) rather than silently dropping the work;
- **Needs Input** — the type is genuinely unclear, so a small placeholder is held and
  the student is asked one question (answer stored, never re-asked).

**Interaction.** The scheduler auto-places blocks (it commands). If the student drags a
study block to a new time/day, that's accepted **silently** (`moved_by_user`) and the
next plan run schedules around it — v1 just doesn't fight the move (learning *from*
moves is a later phase).

Every block stores its `reason` in plain words (e.g. *"Work session 2 of 3, placed early
so it's done before the due date (Wed, Jan 7)."*), so the student can always see *why*.

---

## 8. Security & per-user isolation

- **Auth:** Supabase Auth (email or provider login — your call in Phase 1).
- **RLS everywhere:** every table above has a policy `user_id = auth.uid()`. Even if
  app code had a bug, the database refuses to hand one user another user's rows.
- **The Canvas token** is the one real secret we store. It lives only in
  `canvas_connections.access_token`, encrypted at rest, readable only through the
  server using the service role — never sent to the browser, never logged, never
  committed. **⚠️ Assumption:** we encrypt the token at the app layer before insert
  (using a key from a Vercel env var). Confirm and we'll pin the exact method in Phase 2.
- **No secrets in the repo:** `.env.local` is git-ignored; `.env.example` documents
  the *names* of the variables only.

---

## 9. Proposed folder structure (kept boring on purpose)

```
Smart-Calendar-/
  CLAUDE.md              # the rules (already committed)
  README.md              # beginner setup guide
  docs/
    DESIGN.md            # this file
  app/                   # Next.js app router pages
    page.tsx             # the calendar / list
    settings/            # "Connect Canvas" screen
    api/                 # server routes (sync, etc.)
  lib/
    canvas.ts            # read-only Canvas client (GET + pagination)
    scheduler.ts         # the deterministic rules, heavily commented
    supabase.ts          # db client helpers
  supabase/
    migrations/          # SQL for tables + RLS policies
  tests/                 # scheduler + canvas-parsing unit tests
```

---

## 10. Phases (we do ONE at a time)

Per the workflow rule, we build strictly in order and stop at each phase for a build +
test pass before moving on.

- **Phase 0 — Foundation (this PR):** rules (`CLAUDE.md`) + this design doc. No code.
- **Phase 1 — App skeleton + auth:** Next.js + Tailwind + shadcn/ui running locally
  and on Vercel; Supabase project connected; a user can sign in and land on an empty
  dashboard. *You handle the Supabase/Vercel dashboard clicks; I'll tell you exactly
  which env vars to set.*
- **Phase 2 — Connect Canvas + sync:** the settings screen to paste a token, the
  read-only Canvas client, and the sync that fills `courses` + `assignments`. Show
  last-synced state and errors honestly.
- **Phase 3 — Calendar view:** show assignments on a real calendar/list, including the
  explicit "no due date" section.
- **Phase 4 — The scheduler:** implement the deterministic rules, write the
  `study_blocks`, and show the *why* on each suggestion. This is where we tune the
  rules in §7 together.
- **Phase 5 — Polish:** empty states, loading states, refresh scheduling, tests
  filled out.

---

## 11. Open questions for you (before Phase 1)

1. **Snapshot vs. live fetch** (§5) — OK to store a snapshot in our DB? *(Recommended: yes.)*
2. **Canvas token vs. OAuth** (§6) — start with paste-a-token? *(Recommended: yes, far less friction.)*
3. **Login method** (§8) — email magic link, or a provider (Google)? 
4. **Scheduler knobs** (§7) — your real numbers for effort-per-points, working window,
   and how many days before a due date to schedule.

None of these block writing this doc — they block Phase 1. Answer when ready and we'll
start Phase 1.
