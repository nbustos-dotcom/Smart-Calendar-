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

### `study_blocks` *(added in Phase 3, not before)*
The scheduler's output — suggested times to work. Kept separate from `assignments`
so we never confuse "what Canvas said" with "what we suggested."
- `id` (uuid)
- `user_id` (uuid)
- `assignment_id` (uuid → assignments.id)
- `suggested_start` (timestamp)
- `suggested_end` (timestamp)
- `reason` (text — the human-readable rule that produced this block)

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
rules a student could apply by hand. Given the same assignments, it always produces
the same plan.

**Draft v1 rules (for review — these are the knobs we'll tune together):**
1. Only assignments with a real `due_at` in the future get a study block. No due
   date → no block, shown in a separate "no due date" section (not hidden).
2. Estimate effort from `points_possible`: a simple, transparent mapping, e.g.
   `≤ 20 pts → 1 hour`, `21–60 → 2 hours`, `> 60 → 3 hours`. **⚠️ Assumption** — this
   mapping is a placeholder; you'll want to set the real thresholds.
3. Place the study block on the day before the due date, in a default working window
   (e.g. 4–9 PM). **⚠️ Assumption** — window and "days before" are placeholders.
4. If two blocks collide, push the lower-points one earlier (earlier due date wins
   ties). No overlaps.
5. Every block stores its `reason` in plain words, e.g. *"2h suggested the day before
   because it's worth 45 pts."* The student can always see *why*.

Because it's just rules, the scheduler is the easiest part to unit-test: feed it a
list of assignments, assert the exact blocks that come out.

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
