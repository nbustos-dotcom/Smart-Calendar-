# Smart Calendar

A deterministic study calendar for students. It reads assignments, due dates, and
class events from Canvas (**read-only**) and shows them in one honest calendar —
without guessing or inventing anything Canvas didn't say.

- **Full plan:** [docs/DESIGN.md](docs/DESIGN.md)
- **Project rules:** [CLAUDE.md](CLAUDE.md)

> **Phase 1 (current):** sign in with Google, connect your Canvas token, and see
> your classes and deadlines on a week/month calendar. Display only — no
> auto-scheduling yet (that's a later phase).

---

## How the pieces fit

```
Browser (Next.js + Tailwind + shadcn/ui)
   │   never talks to Canvas directly
   ▼
Next.js server (App Router, on Vercel)
   ├── Supabase Auth  ──►  Google sign-in
   ├── Sync (GET-only) ──►  Canvas REST API (mtu.instructure.com)
   └── Supabase Postgres (Row Level Security: each user sees only their rows)
```

Where things live in the code:

| Path | What it does |
|---|---|
| `src/app/login/` | Google sign-in screen |
| `src/app/auth/` | OAuth callback + sign-out |
| `src/app/settings/` | Paste/save your Canvas token, run a sync |
| `src/app/page.tsx` | The calendar dashboard |
| `src/components/calendar-view.tsx` | Week/month calendar (display only) |
| `src/lib/canvas.ts` | Read-only Canvas client (GET + pagination) |
| `src/lib/canvas-parse.ts` | Pure parsers for Canvas JSON (unit-tested) |
| `src/lib/sync.ts` | Pulls Canvas data into Postgres |
| `src/lib/crypto.ts` | Encrypts the Canvas token before storing it |
| `src/lib/supabase/` | Supabase clients (browser/server) + session refresh |
| `supabase/migrations/` | Database tables + per-user security policies |
| `tests/` | Unit tests (`npm test`) |

---

## Setup (beginner-friendly)

You'll do a few dashboard clicks (Supabase, Google, Vercel); the app never guesses
credentials. Follow in order.

### 1. Install and run locally
```bash
npm install
cp .env.example .env.local   # then fill in the values from the steps below
npm run dev                  # http://localhost:3000
```

### 2. Create a Supabase project
1. Go to <https://supabase.com> → **New project**.
2. When it's ready, open **Settings → API** and copy:
   - **Project URL** → `NEXT_PUBLIC_SUPABASE_URL`
   - **anon public** key → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
3. Open **SQL Editor → New query**, paste the contents of
   `supabase/migrations/0001_init.sql`, and run it. This creates the tables and
   the per-user security rules.

### 3. Turn on Google sign-in
1. In Supabase: **Authentication → Providers → Google → Enable**. It shows you a
   **redirect URL** — copy it.
2. In the [Google Cloud Console](https://console.cloud.google.com/apis/credentials):
   create an **OAuth client ID** (type: *Web application*), and under
   *Authorized redirect URIs* paste the Supabase redirect URL from step 1.
3. Copy the Google **Client ID** and **Client secret** back into the Supabase
   Google provider settings and save.
4. In Supabase **Authentication → URL Configuration**, set **Site URL** to
   `http://localhost:3000` for now (and your Vercel URL later).

### 4. Generate the app encryption key
This key encrypts your Canvas token before it's stored. Generate one:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```
Put the output in `.env.local` as `APP_ENCRYPTION_KEY`.

### 5. Get your Canvas access token
In Canvas: **Account → Settings → New Access Token**. Copy it. You'll paste it into
the app's **Settings** page after signing in (not into any file).

### 6. Try it
`npm run dev`, open the app, sign in with Google, go to **Settings**, paste your
Canvas token, then **Sync now**. Your classes and deadlines appear on the calendar.

### 7. Deploy to Vercel (optional, when ready)
1. Push this repo to GitHub and import it at <https://vercel.com>.
2. Add the same four env vars in Vercel **Project → Settings → Environment
   Variables** (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
   `APP_ENCRYPTION_KEY`, and `NEXT_PUBLIC_SITE_URL` = your Vercel URL).
3. In Supabase **URL Configuration** and Google's redirect URIs, add the Vercel URL.

---

## Environment variables

See `.env.example` for the full list. Names only — never commit real values
(`.env.local` is git-ignored).

| Variable | Where it's used |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Connect to Supabase (public) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Public key; RLS protects the data |
| `APP_ENCRYPTION_KEY` | Server-only; encrypts the Canvas token |
| `NEXT_PUBLIC_SITE_URL` | Builds the Google OAuth redirect |

---

## Commands
```bash
npm run dev     # local dev server
npm run build   # production build
npm test        # unit tests
npm run lint    # lint
```
