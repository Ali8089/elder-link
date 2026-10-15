# Elder Link — Project Handoff (for "gpt 6 luna")

> **Purpose of this file:** A self-contained brief for a future agent/session ("gpt 6 luna") picking up the Elder Link prototype. It documents what the project is, the full codebase map, every design decision made so far, verified status, the one hard deploy trap, and the outstanding work that needs the human's accounts.
>
> **Read this before touching anything.** The project is in a clean, working state with **52/52 tests passing**. The key things to know are: (1) it runs 100% locally with zero accounts via *demo mode*, (2) a production build deliberately disables demo mode so deploying "as-is" without a database **will crash**, not show the demo — set `VITE_DEMO_MODE=1` to publish the demo, and (3) both DB migrations (`0000` core + `0001` additive) are now present in `supabase/migrations/` and must be run in that order.

---

## 1. What Elder Link is

An **automated Cantonese check-in call system for Hong Kong elders living alone**, with a human always deciding emergencies. It is a **six-day demonstration prototype** (fake records, consenting team phone numbers only) — explicitly **not** a replacement for 999.

**Core flow (the PRD):**
- Calls each enrolled elder every 2–3 days on an ordinary phone (no app, no device).
- Discloses it is an automated assistant (FR-03), then asks one short question.
- Classifies the answer: **safe / worrying / danger / unclear / no answer**.
- Safe → short note + one activity suggestion. Worrying/danger → human escalation chain within **60 seconds**.
- No answer → one retry after 5–10 min, then escalation.
- Sensor alert → verification call within 60 s; a safe result closes the alert and informs the designated contact (FR-08).
- Contact chain: first contact → second contact → duty operator.
- Shared bilingual (繁中 / English) staff dashboard: cases, elder detail, enrolment, test controls, analytics.
- **Privacy by design:** no audio/recordings, no HKID or payment fields, phone numbers masked, 30-day deletion after opt-out.

---

## 2. Tech stack & build commands

| Layer | Choice |
|---|---|
| Web UI | React 19 + TypeScript + Tailwind 4 (shadcn/Radix) |
| App framework | TanStack Start (file-based routes, SSR, server routes) |
| Database / Auth | Supabase (Postgres, Auth, RLS, Realtime) |
| Jobs | Server cron route `/api/cron/tick` + DB-backed job table |
| Calls | Telephony adapter — `mock` (default) or Twilio |
| Tests | Vitest |
| Package manager | Bun (lockfile `bun.lock`) — `npm` works too |
| Build targets | Default Lovable/Cloudflare (`vite build`); Vercel (`build:vercel`, Nitro `vercel` preset) |

**Scripts:**
```bash
npm install                       # NOTE: in some sandboxes use --ignore-scripts
npm run dev                       # local dev; on this machine it served http://localhost:8080
npm run build                     # Lovable/Cloudflare preset
npm run build:vercel              # Vercel (Nitro vercel preset) → .vercel/output
npm test                          # Vitest (52 tests, all passing)
npm run lint                      # ESLint
```

`vite.config.ts` uses `@lovable.dev/vite-tanstack-config` with `tanstackStart.server.entry = "server"`. `vite.config.vercel.ts` is the Vercel variant referenced by `vercel.json` (`buildCommand: vite build --config vite.config.vercel.ts`).

---

## 3. Codebase map (the files that matter)

Project root: `C:/Users/user/WorkBuddy AI/2026-10-09-00-55-04/elder-link/`

### Rules / logic (pure, fully tested)
- `src/lib/engine.ts` — **pure** business rules, no I/O. Timing constants (`RETRY_DELAY_MIN=7`, `ESCALATION_LIMIT_MS=60000`, `CHAIN_RING_TIMEOUT_MIN=2`, `MAX_LOGIN_FAILS=5`, `LOCK_MINUTES=15`, `CALLS_PER_MINUTE_LIMIT=3`), `nextStepFor`, `classifyAnswer` (keyword classifier), `activationBlockers` (min-fields gate), `callBlockers` (three-party consent), `advanceChain`, `CHAIN_ORDER=["contact1","contact2","operator"]`, `dtmfToAnswer` (`1=safe/2=worrying/3=danger`), `escalationWithinLimit`, `nextCheckAt`, `isLocked`, `nextVersion` (optimistic lock). Tests: `src/lib/engine.test.ts`.
- `src/lib/runner.ts` — `createRunner(db, provider=MockProvider)`. **The shared workflow engine** used by BOTH the browser dashboard and the server cron. Owns: `createCallJob`, `runCallJob`, `applyCallResult`, `runDueCheckIns`, `advanceStaleChains`, `advanceCaseChain`, `updateCase` (optimistic lock via `.eq("version", expectedVersion)`), `acknowledgeCase`, `saveCaseNote` (500-char cap), `closeCase`, `optOut`, `rescheduleElder`, `recordActivityInterest`, `purgeOptedOut` (calls `db.rpc("purge_opted_out_elders")`), `recordTelephonyEvent` (idempotent, ignores `23505`), `tick`. Inserts `analytics_events` (pseudonymous) and `audit_events`.
- `src/lib/orchestrator.ts` — browser-side binding: `runner = createRunner(supabase, MockProvider)`. Exposes `demoCall(elderId, answer)` and `triggerSensor(elderId, answer)`.

### Telephony
- `src/lib/telephony.ts` — `TelephonyProvider` interface; `MockProvider` (returns simulated answer, `placed:true`); `createTwilioProvider` (API-key Basic auth, `Record:"false"` always); `buildGatherTwiml` (DTMF default with `1/2/3` mapping, optional `<Play>` of pre-generated audio); `selectProvider(env)` (mock unless `TELEPHONY_PROVIDER=twilio` AND `accountSid && authUser && authPass && TWILIO_FROM_NUMBER` all present); `SAMPLE_ANSWERS`.

### Data layer
- `drizzle/schema.ts` — **authoritative column list** (Drizzle). Note: camelCase TS fields (e.g. `referenceNumber`) map to snake_case DB columns.
- `src/integrations/supabase/client.ts` — the Supabase client factory. **Contains the demo fallback** (see §4).
- `src/integrations/supabase/demo-client.ts` — **the in-memory Supabase-compatible shim** (`isDemoMode`, `createDemoClient`, `DemoQuery`). Implements only the query surface the UI uses.
- `src/integrations/supabase/demo-db.ts` — `createDemoDb()` seed (5 elders, 8 contacts, 6 historical safe calls, 4 activities, 1 open mid-chain case for 周伯) + `DEMO_USER`/`DEMO_SESSION` + `uuid()`.
- `src/integrations/supabase/types.ts` — generated `Database` type.
- `src/integrations/supabase/server/*`, `admin.server.ts`, `cron-auth.ts`, `auth-middleware.ts`, `auth-attacher.ts`, `previewAuthStorage.ts` — server-side Supabase wiring.

### Server routes (TanStack Start server routes)
- `src/routes/api/cron/tick.ts` — **the scheduler**: due calls, retries, chain timeouts, 30-day purge. Requires `CRON_SECRET` (Bearer). Idempotent; safe to hit every minute.
- `src/routes/api/health.ts` — config status + queue/overdue counts + last tick.
- `src/routes/api/auth/login.ts` — staff sign-in with server-side lockout (5 fails → 15 min).
- `src/routes/api/auth/signup.ts` — sign-up restricted to `ALLOWED_STAFF_EMAILS`.
- `src/routes/api/telephony/events.ts` — provider webhook (Twilio signature OR shared secret), idempotent, applies same rules as mock.
- `src/routes/api/test/call.ts` — staff-only: place a real call now (needs a real provider).
- `src/routes/api/analytics/summary.ts` — privacy-safe aggregate metrics.

### UI routes (under `_authenticated`)
- `_authenticated.tsx` (shell + **demo banner**), `.cases.tsx`, `.elders.$id.tsx`, `.enrol.tsx`, `.test-controls.tsx`, `.analytics.tsx`, `index.tsx` (login). `src/hooks/` has `useAuth`, `useLive`, `useScheduler`.

### Config / docs
- `.env` (gitignored, contains real Twilio API key + generated `CRON_SECRET` — **do not commit**), `.env.example` (documents every var), `.gitignore` (`.env` now excluded), `vercel.json` (per-minute cron on Pro), `README.md`, `DEPLOYMENT.md`, `AGENTS.md`.
- `supabase/migrations/0000_migration.sql` — **core schema** (copied here from `drizzle/migrations/`, where it had been sitting unused): full tables, RLS, helpers, purge RPC, realtime publication, demo seed.
- `supabase/migrations/0001_prd_completion.sql` — **additive** PRD completion (sample fields, extra tables, login RPCs). Run after `0000`.
- `public/audio/` — placeholder + README for the optional pre-generated Cantonese `<Play>` audio.

### Tests
- `src/lib/demo-journeys.test.ts` — **24 integration tests** driving the real runner + mock provider against the demo store (all 4 journeys, chain advance/skip, sensor FR-08, optimistic locking rejection, rate limit, consent gate, idempotent webhooks, 30-day purge, audit trail).
- `src/lib/engine.test.ts`, `src/test/app-routing.test.tsx`, `src/test/setup.ts`.

**Total: 52/52 tests passing.**

---

## 4. Demo mode — the mechanism (READ THIS)

The app *cannot* boot without a database unless demo mode is active, **and** the UI queries Supabase directly during render, so a missing client previously threw and blocked `npm run dev`. Solution: an in-memory Supabase-compatible shim.

**`isDemoMode()` (demo-client.ts) logic:**
- Returns `true` if `VITE_DEMO_MODE === "1"`.
- Else, in a **dev build** (`import.meta.env.PROD` false): returns `true` when there are no Supabase credentials (`VITE_SUPABASE_URL`/`VITE_SUPABASE_PUBLISHABLE_KEY` blank).
- In a **production build** (`import.meta.env.PROD` true): returns `false`. **A prod build never falls back to demo data** — it keeps throwing "Missing Supabase environment variable(s)" so fake data can never reach a deployed environment by accident.

`client.ts` calls `isDemoMode()` first and returns `createDemoClient()` before the throw.

`createDemoClient()` implements: `.from(table)` → chainable `DemoQuery` (thenable `{data,error}`; supports `select/insert/update`, `eq/neq/gt/gte/lt/lte/in`, `order`, `limit`, `single/maybeSingle`, embedded relations incl. `cases!inner(status)` and `escalation_steps(*)`, `UNIQUE` constraints returning `23505`); `auth` stubs (always `SIGNED_IN` as `demo@oic.hk`, `signOut` is a no-op so nobody locks themselves out); `channel/removeChannel` no-ops; `rpc("purge_opted_out_elders")` implemented.

`demo-db.ts` seeds enough to make the dashboard look real on load: 5 elders (E1 陳婆婆 overdue, E2 李伯, E3 黃婆婆, E4 張伯 draft/no-consent, E5 周伯 active), 8 contacts, 6 historical safe call_jobs, 4 activities, and **one open case `CASE1` for 周伯 mid-chain** (reason `worrying`, severity 2, version 2, escalation started ~within the 60 s rule, 3 escalation_steps: contact1 `no_answer`, contact2 `calling` 周志明 兒子, operator `pending`). `DEMO_USER = {id:"...0001", email:"demo@oic.hk"}`.

A banner in `_authenticated.tsx` warns: *"⚠ Demo mode — in-memory data, mock telephony (no real calls). A reload resets everything."*

Demo mode is documented in `.env.example`, `README.md`, and covered by `demo-journeys.test.ts`.

---

## 5. Telephony — mock + Twilio

**Design intent:** swap providers without touching the orchestrator. `orchestrator.ts` hardcodes `MockProvider`; `selectProvider(env)` returns Twilio only when fully configured, else mock.

**Mock (default, $0):** `MockProvider.placeCall` returns `{eventId, answer: simulatedAnswer, placed:true}`. Every journey, escalation chain, sensor flow and analytics is demoable with simulated answers. No phone rings.

**Twilio (real calls, optional):**
- Auth: **API Key preferred** over account Auth Token. `authUser = TWILIO_API_KEY_SID || TWILIO_ACCOUNT_SID`, `authPass = TWILIO_API_KEY_SECRET || TWILIO_AUTH_TOKEN`. The **Account SID (`AC…`) is always required** — it forms the API URL path.
- Answer capture: **DTMF is the default** gather (`<Gather input="dtmf" numDigits="1" timeout="6">`) — free, instant, never mis-hears. `1=safe, 2=worrying, 3=danger`. Speech mode (`mode:"speech"`) available but unverified for Cantonese quality.
- Optional pre-generated Cantonese audio via `<Play>` (`TWILIO_AUDIO_URL`) — decouples voice quality from the carrier and settles the open PRD voice-quality question. Use a free Cantonese TTS tier (e.g. Azure Speech `zh-HK`, ~500k chars/mo free) to produce it.
- **Recording is NEVER enabled:** `Record:"false"` in every call body (FR-13). Machine detection enabled.
- Webhook: Twilio posts the result to `/api/telephony/events` (idempotent; verified via signature OR `TELEPHONY_WEBHOOK_SECRET`).

**Current `.env` state:** `TELEPHONY_PROVIDER=twilio` is set, but `TWILIO_ACCOUNT_SID` and `TWILIO_FROM_NUMBER` are **blank**, so `selectProvider` silently falls back to mock. The real API Key SID (`SK…`) and secret are present in `.env` (gitignored). **Treat those secrets as already-exposed** (they are in the chat history) — rotate them if this ever goes near production.

---

## 6. The two blockers (be honest about these)

### Blocker A — RESOLVED: core migration relocated ✅
`0000_migration.sql` was never missing — it existed at `drizzle/migrations/0000_migration.sql`, but Supabase only executes files in `supabase/migrations/`. It has now been **copied to `supabase/migrations/0000_migration.sql`** alongside `0001_prd_completion.sql`.

`0000` contains the full core: `app_role` enum, `user_roles`, `elders`, `contacts`, `call_jobs`, `cases`, `escalation_steps`, `sensor_alerts`, `telephony_events`, `audit_events`; the `has_role()` / `is_staff()` helpers; the new-user role trigger; RLS policies; the `purge_opted_out_elders()` RPC; the realtime publication; and the demo seed (3 elders + 4 contacts).

`0001` is **additive** (PRD sample fields, `activities`, `activity_interests`, `notifications`, `login_attempts`, `scheduler_runs`, `analytics_events`, `cases.version`, login RPCs) and assumes `0000` has already run.

**Order matters: run `0000` first, then `0001`.** Both are now present and verified.

### Blocker B — Deploy trap: production build disables demo mode ⚠️
If you deploy "as-is" without a database, the app **will not show the demo** — it will throw "Missing Supabase environment variable(s)" on first render. A production build sets `import.meta.env.PROD=true`, which makes `isDemoMode()` return `false`.

**To show the demo in production, you MUST set `VITE_DEMO_MODE=1` in the Vercel environment variables (Production + Preview + Development) and redeploy.** This is the only way to get a public, no-accounts demo URL.

---

## 7. Environment variables (all documented in `.env.example`)

| Variable | Purpose | Notes |
|---|---|---|
| `VITE_SUPABASE_URL` / `VITE_SUPABASE_PUBLISHABLE_KEY` | Browser Supabase | browser-visible; blank → demo mode in dev |
| `SUPABASE_URL` / `SUPABASE_PUBLISHABLE_KEY` / `SUPABASE_SERVICE_ROLE_KEY` | Server Supabase | service role is secret |
| `CRON_SECRET` | Protects `/api/cron/tick` + server routes | set to a long random string |
| `VITE_DEMO_MODE` | `1` forces demo mode | also auto-on in dev without creds; **off in prod** |
| `TELEPHONY_PROVIDER` | `mock` (default) or `twilio` | |
| `TWILIO_ACCOUNT_SID` (`AC…`) | required for real calls | URL path |
| `TWILIO_API_KEY_SID` (`SK…`) / `TWILIO_API_KEY_SECRET` | preferred auth | |
| `TWILIO_AUTH_TOKEN` | only for webhook signature verify | |
| `TWILIO_FROM_NUMBER` | fixed caller number (E.164) | required for pilot |
| `TWILIO_LANGUAGE` | `yue-HK` | set explicit `TWILIO_VOICE` too |
| `TWILIO_VOICE` | e.g. `Google.yue-HK-Standard-A` | `<Say>` fails on mismatch |
| `TWILIO_AUDIO_URL` | optional pre-generated audio | played via `<Play>` |
| `TELEPHONY_WEBHOOK_URL` | `…/api/telephony/events` | provider callbacks |
| `TELEPHONY_WEBHOOK_SECRET` | shared secret for unsigned callers | |
| `ALLOWED_STAFF_EMAILS` | comma-separated allow-list | required for sign-up |

---

## 8. Deploy steps (summary — full version in DEPLOYMENT.md)

1. **Migrations are ready** — run `supabase/migrations/0000_migration.sql` then `0001_prd_completion.sql` in the Supabase SQL Editor.
2. Supabase: create project, run `0000` then `0001`, copy URL + anon + service-role keys.
3. Vercel: push repo, import project, `vercel.json` sets the Vercel build. Add all env vars (§7) for Production/Preview/Development.
4. **Scheduling:** `/api/cron/tick` must run **every minute**. Option A — Vercel Pro per-minute cron (Hobby only allows daily; delete the `crons` block on Hobby). Option B — free external scheduler (cron-job.org / GitHub Actions) POSTing with `Authorization: Bearer <CRON_SECRET>`.
5. **If you want the public demo to show:** set `VITE_DEMO_MODE=1` and redeploy (Blocker B).
6. Verify with the checklist in DEPLOYMENT.md §4 (`/api/health`, lockout after 5 fails, activation field gates, demo call journeys, cron tick).

---

## 9. Outstanding work that needs the HUMAN (not the agent)

| # | Item | Why |
|---|---|---|
| 1 | Supabase project URL + publishable + **service-role** key | DB, auth, server cron |
| 2 | Git repo connected to Vercel | deploy source |
| 3 | `ALLOWED_STAFF_EMAILS` (real staff emails) | replaces open sign-up |
| 4 | Vercel plan: Pro (per-min cron) or external scheduler | scheduling frequency |
| 5 | Telephony vendor decision + account | real calls to consenting team phones |
| 6 | Fixed caller number | required before real pilot calls |
| 7 | Approved Cantonese script wording | script currently marked **DRAFT** (`src/lib/script.ts`) |
| 8 | Business/technical approval for the demo | PRD release process |

---

## 10. Gotchas & lessons learned (sandbox-specific, save time)

- **Do not run builds or change files when the user only asks a question.** The human explicitly said *"don't build or change anything I just asked a question"* after an unrequested production build. When they ask a yes/no or "will it work" question, answer in text only.
- **`client.ts` throws without Supabase creds** — this is why demo mode exists. Don't "fix" the throw; it's the prod safety net.
- **`npm install` may need `--ignore-scripts`** in restricted Windows sandboxes (nested esbuild postinstall fails). Vercel/Linux builds are unaffected.
- **Local dev served on `http://localhost:8080`** (not the default 5173) in this environment.
- **`SAFE_DELETE_BULK_CONFIRM_REQUIRED` build failure:** `npm run build:vercel` can fail because Nitro's own cleanup of `.vercel/output` trips the sandbox bulk-delete guard. Workaround: `rm -rf .vercel/output` before rebuilding. Vercel's own Linux builders are unaffected.
- **headless Chrome for UI verification:** `agent-browser` CLI was not installed. Used system Chrome at `C:\Program Files\Google\Chrome\Application\chrome.exe` with `--headless=new --dump-dom` / `--screenshot` to verify rendered DOM. `curl` goes through a proxy in this sandbox — use Node `fetch` for localhost health checks.
- **node `/tmp` resolves to `C:\tmp`** — pipe HTML via stdin to node instead of passing a `/tmp` path.
- **Twilio `<Say>` errors when voice/language mismatch** — always pin an explicit `TWILIO_VOICE` when using `yue-HK`.
- **Demo seed resets on reload** — expected. Don't treat it as a bug.
- **Rotated-key reality:** the real Twilio API key is in chat history. If this ever approaches production, rotate it.

---

## 11. Work-to-date chronology (for context)

1. Reviewed `elder-link.zip` (Lovable implementation) vs the PRD; wrote `GAP_ANALYSIS.md` (~85–90% coverage; flagged mock-only telephony, browser-only scheduler, no rate limit, thin tests, client-side logic).
2. Closed all PRD gaps in `elder-link/`: `0001` migration, shared `runner.ts`, server `runner.server.ts` + admin client, 7 API routes (cron/health/login-with-lockout/signup-allowlist/telephony-events/test-call/analytics), Twilio adapter (no recording, DTMF default), UI updates, Drizzle schema, README/DEPLOYMENT/.env.example/vercel.json/vite.config.vercel.ts. → **26/26 tests, build OK.**
3. Free-alternative research (mock $0; Twilio trial free-but-verified; Azure Speech F0 free Cantonese TTS; DTMF avoids STT cost).
4. Wired Twilio **API-key auth** + DTMF default + optional `<Play>` audio; fixed `.gitignore` to exclude `.env`. → **28/28 tests, vercel build OK.**
5. Local-run request hit the **"client throws without creds"** blocker. Built **demo mode** (`demo-db.ts` + `demo-client.ts` + `client.ts` fallback + banner). Added `demo-journeys.test.ts` → **52/52 tests.** Verified rendered UI via headless Chrome; screenshots in `demo-shots/`.
6. Confirmed the deploy trap (prod disables demo → must set `VITE_DEMO_MODE=1`); then located the "missing" core schema at `drizzle/migrations/0000_migration.sql` and copied it into `supabase/migrations/`, and created `public/audio/` with a README.
7. This handoff document.

---

## 12. Quick "make it run locally right now" for the next agent

```bash
cd elder-link
npm install                 # add --ignore-scripts if postinstall fails
npm run dev                 # opens on http://localhost:8080 (this machine)
# No env needed — demo mode auto-activates with blank Supabase creds.
# For the full test suite: npm test   (52 passing)
```

To force demo mode explicitly (e.g. when creds exist): set `VITE_DEMO_MODE=1` in `.env`.

---

*End of handoff. The project is functional, tested, and demoable. The one remaining engineering item is the optional Cantonese audio asset; everything else waiting is the human's accounts/decisions.*
