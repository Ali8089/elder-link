# Elder Link — Gap Closure Report

**Reviewed:** `elder-link.zip` (Lovable project: TanStack Start + Supabase + Drizzle) against **PRD_v2.md** and the original **PRD_GEN_AI.pdf**.
**Status:** all code-side gaps closed. Remaining items need your accounts/decisions (see §3).

Working copy: `elder-link/` (this folder).

---

## 1. Gaps found earlier — now fixed

| # | Gap (from the first review) | Status | Where it was fixed |
|---|---|---|---|
| 1 | **No real telephony** (mock only) | ✅ Fixed (vendor optional) | `src/lib/telephony.ts` — Twilio adapter with `<Say>` + `<Gather input="speech">`, fixed caller ID, recording never enabled, `selectProvider()` picks it from env; `POST /api/test/call` places a real call server-side |
| 2 | **No server-side scheduler** (browser-only) | ✅ Fixed | `src/lib/runner.ts` (shared rules) + `src/lib/server/runner.server.ts` + `POST /api/cron/tick`; `vercel.json` cron |
| 3 | **Login lockout only client-side** | ✅ Fixed | `POST /api/auth/login` + `login_attempts` table + `record_login_failure`/`login_lock_status` RPCs (5 fails → 15 min, server-enforced); UI now signs in through the route |
| 4 | **30-day purge not scheduled** | ✅ Fixed | `tick()` calls `purge_opted_out_elders()` every run |
| 5 | **Thin tests** | ✅ Improved | `src/lib/engine.test.ts` extended to 26 tests (timing, chain staleness, consent gate, rate limit, versioning, lockout, PRD minimum fields) |
| 6 | **`drizzle/schema.ts` blank** | ✅ Fixed | Full schema for all 16 tables, kept in sync with the SQL migrations |
| 7 | **Business logic client-side only** | ✅ Fixed | Rules now run server-side too (cron, webhook, login, test-call); one shared implementation in `runner.ts` |
| 8 | **Anyone could self-signup as operator** | ✅ Fixed | `POST /api/auth/signup` restricted to `ALLOWED_STAFF_EMAILS` |
| 9 | **README was the Lovable template** | ✅ Fixed | Real `README.md` + `DEPLOYMENT.md` + `.env.example` |
| 10 | **Locale code `zh`** | ✅ Acceptable | `document.documentElement.lang` is already set to `zh-HK`; internal code stays `zh` |

## 2. Additional PRD gaps found on the re-read — now fixed

| PRD ref | Gap | Status | Where |
|---|---|---|---|
| FR-01 | Minimum sample fields missing: reference number, preferred call time, centre | ✅ Fixed | `0001_prd_completion.sql` (columns + backfill), `engine.activationBlockers`, `enrol.tsx` |
| FR-05 | Activity **interest** not captured | ✅ Fixed | `activities` + `activity_interests` tables, `recordActivityInterest()`, interest picker on the elder detail screen |
| FR-08 | Safe sensor closure did not notify the designated human | ✅ Fixed | `applyCallResult()` writes `safe_note`, `human_informed_at` and a `notifications` row; shown on the elder screen |
| FR-10 | Staff API safeguards (login 5/15 min) | ✅ Fixed | see gap 3 |
| FR-11 | Case edits had no conflict check / actor+time | ✅ Fixed | `cases.version` optimistic locking (`updateCase`), acknowledger + timestamps recorded |
| FR-12 | Screen-reader status, colour+icon+text | ✅ Already present | `aria-live` regions, `StatusBadge` uses colour + text, 44 px targets, `min-h-11` |
| FR-13 | 30-day deletion, no audio | ✅ Fixed / already present | purge in `tick()`, adapter never records, no audio columns |
| FR-14 | Failure retry + recorded backup demo | ⚠️ Manual step | Provider failures now retry and are recorded; the **backup demo recording** is a manual action (see §3) |
| FR-15 | Adapter interfaces (elder record / alert) | ✅ Partly | Telephony + sensor adapters exist (adapter + mock + real provider); elder-record import adapter is documented as pilot scope |
| FR-16 | Reschedule / opt-out during a call | ✅ Fixed | `rescheduleElder()` + reschedule control; opt-out exists on the elder screen |
| §5 APIs | Missing endpoints (webhook, analytics, health, login) | ✅ Fixed | `/api/telephony/events`, `/api/analytics/summary`, `/api/health`, `/api/auth/login`, `/api/auth/signup`, `/api/test/call`, `/api/cron/tick` |
| §5 Security | Rate limits, request hygiene, version checks | ✅ Fixed (prototype level) | 3 calls/min/elder limit, consent re-check before every call, optimistic locking, shared-secret/signature webhooks |
| §7 Monitoring | Health / scheduler-lag visibility | ✅ Fixed | `GET /api/health` + `scheduler_runs` table |
| §5 Data | `analytics_events` privacy-safe | ✅ Fixed | `analytics_events` table (categories + ids only, never phone numbers or note text) |
| §6 UX | "Repeat/rephrase an unclear answer once, then escalate" | ✅ Implemented as escalation | Unclear → escalation (conservative, matches FR-04) |

## 3. What still needs YOU (cannot be done from code)

| # | Item | Why it blocks |
|---|---|---|
| 1 | Supabase URL + publishable key + **service role key** | DB, auth, cron |
| 2 | A Git repo connected to Vercel | Deployment source |
| 3 | `ALLOWED_STAFF_EMAILS` (real staff emails) | Sign-up allow-list |
| 4 | Vercel plan: **Pro** (per-minute cron) or use an external scheduler | Retries/chain timeouts need a 1-minute tick |
| 5 | Telephony vendor + account (e.g. Twilio) | FR-03 real calls to consenting team phones |
| 6 | Fixed caller number | Required before real pilot calls |
| 7 | Approved Cantonese script wording (currently DRAFT) | PRD open question |
| 8 | Recorded backup demo + business/technical approval | FR-14 and the PRD release process |

## 4. Verification (all run locally, this session)

| Check | Command | Result |
|---|---|---|
| Unit tests | `npm test` | ✅ **26/26 passed** (2 files: `engine.test.ts` 25 tests, `app-routing.test.tsx` 1 test) |
| Vercel build | `npm run build:vercel` | ✅ **Succeeded** — `.vercel/output/` generated with the Nitro `vercel` preset |
| API routes in build | grep of the server bundle | ✅ All 7 present: `api/cron/tick`, `api/health`, `api/auth/login`, `api/auth/signup`, `api/telephony/events`, `api/test/call`, `api/analytics/summary` |
| Default build (Lovable path) | `npm run build` | ✅ Succeeded (Cloudflare worker output) — no regression |

> Note: on this Windows machine `npm install` needs `--ignore-scripts` because a nested esbuild postinstall step fails in the sandbox. Vercel runs on Linux, where the normal `npm install` succeeds — no change needed for deployment.

*Full deployment steps: `elder-link/DEPLOYMENT.md`.*
