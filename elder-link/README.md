# Elder Link

Automated Cantonese check-in calls for Hong Kong elders living alone — with a human always deciding emergencies.

A six-day demonstration prototype: fake records and consenting team phone numbers only. **Not a replacement for 999.**

## What it does

- Calls each enrolled elder every 2–3 days on an ordinary phone (no app, no device).
- Discloses that it is an automated assistant, then asks one short question.
- Classifies the answer: **safe / worrying / danger / unclear / no answer**.
- Safe → short note + one activity suggestion. Worrying or danger → human escalation within 60 seconds.
- No answer → one retry after 5–10 minutes, then escalation.
- Sensor alert → verification call within 60 seconds; a safe result closes the alert and informs the designated contact.
- Contact chain: first contact → second contact → duty operator.
- Shared bilingual (繁中 / English) staff dashboard: cases, elder detail, enrolment, test controls, analytics.
- Privacy: no audio or recordings, no HKID or payment fields, phone numbers masked in the UI, 30-day deletion after opt-out.

## Stack

| Layer | Choice |
|---|---|
| Web UI | React 19 + TypeScript + Tailwind 4 (shadcn/Radix) |
| App framework | TanStack Start (file-based routes, SSR, server routes) |
| Database / Auth | Supabase (Postgres, Auth, RLS, Realtime) |
| Jobs | Server cron route (`/api/cron/tick`) + DB-backed job table |
| Calls | Telephony adapter — `mock` (default) or Twilio |
| Tests | Vitest |

## Local development

### Option A — demo mode (no accounts needed)

```bash
npm install
npm run dev               # Vite prints the local URL
```

With no Supabase credentials present, the app runs on an **in-memory demo
database** and the **mock telephony provider**: every journey, the escalation
chain, the sensor flow and the analytics work end to end, entirely in the
browser. Nothing is persisted — a reload restores the seed (five sample elders
and one case mid-escalation). A banner marks the mode on every screen.

Set `VITE_DEMO_MODE=1` to force demo mode even when credentials exist. A
production build never falls back to demo data.

Demo mode is covered by `src/lib/demo-journeys.test.ts`, which drives the real
runner against the in-memory store.

### Option B — against a real Supabase project

```bash
npm install
cp .env.example .env      # fill in your Supabase keys + CRON_SECRET
npm run dev
```

Migrations (run in order in the Supabase SQL Editor):

- `supabase/migrations/0000_migration.sql` — core schema: `user_roles`, `elders`,
  `contacts`, `call_jobs`, `cases`, `escalation_steps`, `sensor_alerts`,
  `telephony_events`, `audit_events`; `is_staff()` / `has_role()` helpers; RLS
  policies; the `purge_opted_out_elders()` RPC; realtime publication; demo seed.
- `supabase/migrations/0001_prd_completion.sql` — additive: PRD sample fields,
  `activities`, `activity_interests`, `notifications`, `login_attempts`,
  `scheduler_runs`, `analytics_events`, `cases.version`, plus `login` RPCs.

`0001` assumes `0000` has already been applied.

## Scripts

| Command | Purpose |
|---|---|
| `npm run dev` | Local dev server |
| `npm run build` | Build with the Lovable/Cloudflare preset |
| `npm run build:vercel` | Build for Vercel (Nitro `vercel` preset) |
| `npm test` | Run the unit tests |
| `npm run lint` | ESLint |

## Key server routes

| Route | Purpose |
|---|---|
| `POST /api/auth/login` | Staff sign-in with server-side lockout (5 fails → 15 min) |
| `POST /api/auth/signup` | Staff sign-up restricted to `ALLOWED_STAFF_EMAILS` |
| `POST /api/cron/tick` | The scheduler: due calls, retries, chain timeouts, 30-day deletion (needs `CRON_SECRET`) |
| `GET /api/health` | Config status, queue/overdue counts, last tick |
| `POST /api/telephony/events` | Provider webhook (signed or shared secret), idempotent |
| `POST /api/test/call` | Staff-only: place a real call now (needs a real provider) |
| `GET /api/analytics/summary` | Privacy-safe aggregate metrics |

## Architecture notes

- **One source of truth for the rules.** `src/lib/engine.ts` holds the pure rules (timing, classification, chain, consent, lockout) with tests in `engine.test.ts`. `src/lib/runner.ts` applies them against a database client, so the browser dashboard and the server cron behave identically.
- **Provider swap.** `src/lib/telephony.ts` defines the adapter. `mock` runs with no vendor; `twilio` places real calls and posts the spoken answer back to the webhook. Recording is never enabled.
- **Privacy by default.** Analytics events are pseudonymous (categories + ids, never phone numbers or note text). The audit log never copies note contents.

## Deployment

See [DEPLOYMENT.md](DEPLOYMENT.md) for the Vercel walkthrough, environment variables, cron options and the go-live checklist.
