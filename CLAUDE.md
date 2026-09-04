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
