# Smart Calendar

A study calendar for students. It reads your assignments, due dates, and class
events from **Canvas** (read-only) and shows them in one honest calendar — without
guessing or inventing anything Canvas didn't say.

New to this project? This README is written for you. Read it top to bottom and
you'll understand what the app is, where every file lives, how to run it, and how
the pieces connect.

- **The rules** the project follows: [CLAUDE.md](CLAUDE.md)
- **The full plan** and roadmap: [docs/DESIGN.md](docs/DESIGN.md)

> **Status:** Phase 1 is built and deployed. Right now the app is *display only* —
> it shows your Canvas classes and deadlines. Automatic study-scheduling is a
> later phase (see the roadmap). We build one phase at a time.

---

## 1. What the app does (in plain words)

1. You **sign in with Google**.
2. You paste a **Canvas access token** once (from your Canvas account settings).
3. The app **syncs**: it reads your courses, assignments (with due dates), and any
   class events from Canvas and stores a copy.
4. You see everything on a **week/month calendar**.

Two promises baked into the design:
- It **never writes to Canvas** — only reads.
- It **never invents data** — if Canvas has no due date for something, the app
  says "no due date" instead of guessing one.

## 2. The tools it's built with

| Tool | What it's for |
|---|---|
| **Next.js** (React) | The website + its server code (one framework does both). |
| **Tailwind + shadcn/ui** | Styling and ready-made UI pieces (buttons, cards, inputs). |
| **Supabase** | The database (Postgres) **and** Google sign-in. |
| **Vercel** | Hosts the live site. |
| **Canvas REST API** | Where the assignments/deadlines come from (read-only). |

## 3. How the pieces connect

```
Your browser  ──►  Next.js server (on Vercel)  ──►  Supabase (database + login)
   (the pages)         (pages + server logic)          (stores your data)
                              │
                              └──►  Canvas API  (read-only; token stays on server)
```

**The browser never talks to Canvas directly.** Your Canvas token is encrypted and
only used on the server, so it's never exposed to your browser or to other users.
Each user can only ever see their own data — that's enforced by the database
itself ("Row Level Security"), not just by app code.

### Two flows worth understanding

**Signing in:**
`/login` → click *Sign in with Google* → Google → `/auth/callback` (trades the
login code for a session) → you land on the calendar. A small file, `src/proxy.ts`,
runs on every request to keep you logged in and bounce signed-out visitors to
`/login`.

**Syncing Canvas:**
Settings page → *Sync now* → `src/app/settings/actions.ts` → `src/lib/sync.ts`
reads Canvas via `src/lib/canvas.ts` → saves the rows to Supabase → the calendar
page reads those rows and draws them.

## 4. The file map (one line each)

```
Smart-Calendar-/
├─ CLAUDE.md                 The project's hard rules.
├─ docs/DESIGN.md            The full plan and phase roadmap.
├─ README.md                 This guide.
├─ .env.example              The list of environment-variable NAMES (no secrets).
│
├─ src/app/                  The pages. Each folder name = a URL (Next.js rule).
│  ├─ layout.tsx             The shell wrapped around every page.
│  ├─ globals.css            App-wide styles + the color theme.
│  ├─ page.tsx               The DASHBOARD / calendar (URL "/").
│  ├─ login/page.tsx         The sign-in screen (URL "/login").
│  ├─ settings/page.tsx      The "Connect Canvas" screen (URL "/settings").
│  ├─ settings/actions.ts    Server functions: save token, sync now, remove token.
│  ├─ auth/callback/route.ts Where Google returns the user; finishes sign-in.
│  └─ auth/signout/route.ts  Signs the user out.
│
├─ src/components/           Reusable UI.
│  ├─ calendar-view.tsx      The week/month calendar grid (display only).
│  ├─ settings-form.tsx      The token box + Sync/Remove buttons.
│  └─ ui/                    Standard shadcn/ui pieces (button, card, input, …).
│
├─ src/lib/                  The "engine room" — logic, no UI.
│  ├─ canvas.ts              Read-only Canvas API client (GET only + pagination).
│  ├─ canvas-parse.ts        Pure functions: Canvas JSON → tidy rows (tested).
│  ├─ canvas-connection.ts   Save/read/clear the encrypted Canvas token.
│  ├─ sync.ts                Pulls Canvas data into the database.
│  ├─ crypto.ts              Encrypts/decrypts the Canvas token (server-only).
│  ├─ calendar.ts            Week/month date math (tested).
│  ├─ types.ts               Shared data shapes for the calendar UI.
│  ├─ utils.ts               The shadcn cn() class-name helper.
│  └─ supabase/
│     ├─ client.ts           Supabase client for the browser.
│     ├─ server.ts           Supabase client for the server (reads your session).
│     └─ session.ts          Session-refresh helper used by src/proxy.ts.
│
├─ src/proxy.ts              Runs on every request (keeps you logged in).
│
├─ supabase/migrations/
│  └─ 0001_init.sql          The database setup: tables + per-user security rules.
│
└─ tests/                    Unit tests (run with `npm test`).
   ├─ canvas-parse.test.ts   Tests the Canvas parsing/pagination.
   ├─ crypto.test.ts         Tests token encryption.
   ├─ calendar.test.ts       Tests the date math.
   └─ stubs/server-only.ts   Small shim so server files can be tested.
```

Config files you normally won't touch: `package.json` (dependencies + scripts),
`.npmrc` (an install setting Vercel needs), `next.config.ts`, `tsconfig.json`,
`postcss.config.mjs`, `eslint.config.mjs`, `components.json`, `vitest.config.mts`.

## 5. Run it on your own computer

You need **Node.js** (LTS version) installed. Then, in a terminal in the project
folder:

```bash
npm install            # install dependencies (one time)
cp .env.example .env.local   # then fill in the values (see below)
npm run dev            # start the app at http://localhost:3000
```

### The environment values you must fill into `.env.local`

`.env.local` is git-ignored, so your secrets never get committed. See
`.env.example` for the up-to-date list. You need four values:

| Variable | Where it comes from |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase → Settings → API → **Project URL** (just `https://…supabase.co`). |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase → Settings → API → the **anon public** key. |
| `APP_ENCRYPTION_KEY` | Generate: `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"` |
| `NEXT_PUBLIC_SITE_URL` | `http://localhost:3000` for local dev. |

You also do these **dashboard** steps once (they can't be done from code):
1. **Create a Supabase project** and run `supabase/migrations/0001_init.sql` in its
   SQL Editor (creates the tables + security rules).
2. **Enable Google sign-in** in Supabase (Authentication → Providers → Google),
   with a Google Cloud OAuth client.
3. Get a **Canvas access token** (Canvas → Account → Settings → New Access Token)
   — you paste this into the app's Settings page, not into a file.

## 6. Everyday commands

```bash
npm run dev     # run locally at http://localhost:3000
npm run build   # make a production build (what Vercel runs)
npm test        # run the unit tests
npm run lint    # check code style
```

## 7. Where to make changes (a cheat sheet)

- **Change how the calendar looks** → `src/components/calendar-view.tsx`
- **Change what data we pull from Canvas** → `src/lib/canvas.ts` + `src/lib/sync.ts`
- **Change the database tables** → add a new file in `supabase/migrations/`
- **Change the settings screen** → `src/app/settings/`
- **Change the sign-in screen** → `src/app/login/page.tsx`

Every important file also has a plain-English summary comment at the very top
saying what it is — open any file and the first few lines tell you its job.
