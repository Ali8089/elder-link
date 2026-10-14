# Deploying Elder Link to Vercel

Everything in the codebase is ready. The steps below need **your accounts** (Supabase, Vercel, and a telephony vendor for real calls).

---

## 1. Supabase (database + auth)

> **Order matters:** run `0000` first, then `0001`. `0001` is additive and
> assumes the core tables from `0000` already exist. Both files are in
> `supabase/migrations/`.

1. Create (or open) a Supabase project.
2. Open **SQL Editor** and run, in order:
   1. `supabase/migrations/0000_migration.sql` — core schema, RLS, helper
      functions, `purge_opted_out_elders()`, realtime publication, demo seed.
   2. `supabase/migrations/0001_prd_completion.sql` — PRD completion fields,
      extra tables, login RPCs.
   > If `0000` was already applied earlier, run only `0001`.
3. Copy these values from **Project Settings → API**:
   - Project URL
   - Publishable / anon key
   - Service role key (server-only, never expose)
4. **Remove the demo seed rows before anyone sees the dashboard.** `0000` inserts
   three fake elders (陳婆婆, 李伯伯, 黃太) with consent flags set `true`, which
   look like real enrolments. Run `supabase/cleanup_demo_seed.sql` once.

## 2. Vercel (hosting)

1. Push this project to a Git repository (GitHub/GitLab/Bitbucket).
2. In Vercel: **Add New → Project → import the repo**.
3. Vercel reads `vercel.json`, which sets:
   - `buildCommand: vite build --config vite.config.vercel.ts` (Nitro `vercel` preset)
4. Add the environment variables (below) for **Production, Preview and Development**.
5. Deploy.

### Environment variables to add in Vercel

| Key | Value | Notes |
|---|---|---|
| `VITE_SUPABASE_URL` | `https://xxx.supabase.co` | browser-visible |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | publishable/anon key | browser-visible |
| `SUPABASE_URL` | same project URL | server |
| `SUPABASE_PUBLISHABLE_KEY` | publishable/anon key | server |
| `SUPABASE_SERVICE_ROLE_KEY` | service role key | **secret** |
| `CRON_SECRET` | long random string | protects cron + server routes |
| `ALLOWED_STAFF_EMAILS` | `you@example.org,teammate@example.org` | staff sign-up allow-list |
| `TELEPHONY_PROVIDER` | `mock` or `twilio` | mock until a vendor is ready |
| `TWILIO_ACCOUNT_SID` | `AC...` | only for real calls |
| `TWILIO_AUTH_TOKEN` | secret | only for real calls |
| `TWILIO_FROM_NUMBER` | fixed caller number | required by the PRD for pilot |
| `TWILIO_LANGUAGE` | `yue-HK` | Cantonese voice (validate with the vendor) |
| `TELEPHONY_WEBHOOK_URL` | `https://your-app.vercel.app/api/telephony/events` | provider callbacks |

## 3. Scheduling (the part that matters most)

The scheduler endpoint is `POST /api/cron/tick` (also accepts `GET`). It needs to run **every minute** so that retries (5–10 min) and chain timeouts (2 min) work.

**Option A — Vercel Cron (Pro plans).** Add this to `vercel.json`, then deploy:

```json
"crons": [
  { "path": "/api/cron/tick", "schedule": "* * * * *" }
]
```

Vercel **Hobby** only allows *daily* crons and **rejects a per-minute schedule at deploy time**, so on Hobby use Option B instead. (The `crons` block was removed from `vercel.json` so the default deploy works on Hobby.)

**Option B — external scheduler (free, works on any plan).** Create a job at [cron-job.org](https://cron-job.org) or a GitHub Actions schedule that calls:

```
POST https://your-app.vercel.app/api/cron/tick
Authorization: Bearer <CRON_SECRET>
```

every minute. Both options are safe: the endpoint is idempotent and refuses calls without the secret.

> Without a scheduler the app still works when a staff dashboard is open
> (the browser advances due retries), but nothing runs while it is closed.

## 4. Verify after deploy

| Check | Expected |
|---|---|
| `GET /api/health` | `ok: true`, config flags true, counts present |
| Sign in with an allow-listed email | Reaches `/cases` |
| 5 wrong passwords | Locked out for 15 minutes |
| Enrol an elder, leave a field blank | Activation blocked, missing items listed |
| Test Controls → demo call (safe) | Job completes, activity suggested, next check scheduled |
| Test Controls → demo call (worrying) | Case opens, chain step 1 = calling, escalation ≤ 60 s |
| Test Controls → no answer | Retry scheduled, then escalation on the second no-answer |
| `/api/cron/tick` with the secret | `{ ok: true, jobs_created, jobs_run, chains_advanced, purged }` |

## 5. Real calls with Twilio (optional, for the live demo)

### 5a. Collect three things from the Twilio Console

| Value | Where | Format |
|---|---|---|
| **Account SID** | Console home → Account Info | starts with `AC…` |
| **API Key SID + Secret** | Console → Account → API keys & tokens → Create API key | `SK…` + secret |
| **From number** | Phone Numbers → Buy a number (or a verified caller ID) | E.164, e.g. `+85212345678` |
| *(optional)* **Auth Token** | Console home → Account Info | needed only to verify webhook signatures |

> The Account SID is always required — it forms the API URL. The API Key (SK…) replaces the Auth Token as the *password* for placing calls.

### 5b. Trial-account notes (free path)

- Trial accounts can only call **verified numbers**. Add each team phone under **Phone Numbers → Verified Caller IDs**. This matches the PRD constraint ("consenting team numbers only").
- Trial calls play a short **trial message** before your script starts.
- Check **Voice → Geographic Permissions** and make sure Hong Kong (`+852`) outbound is allowed.

### 5c. Set the environment variables

```
TELEPHONY_PROVIDER=twilio
TWILIO_ACCOUNT_SID=AC…
TWILIO_API_KEY_SID=SK…
TWILIO_API_KEY_SECRET=…
TWILIO_FROM_NUMBER=+852…
TWILIO_LANGUAGE=yue-HK
TWILIO_VOICE=Google.yue-HK-Standard-A     # set explicitly — <Say> fails on a voice/language mismatch
TELEPHONY_WEBHOOK_URL=https://your-app.vercel.app/api/telephony/events
TWILIO_AUTH_TOKEN=…                        # only for webhook signature verification
```

### 5d. How the call works

1. The runner places the call and speaks the AI disclosure (FR-03).
2. The caller is asked one question and answers **on the keypad**: `1` = safe, `2` = worrying, `3` = danger.
   - Keypad is the default because it is free, instant and never mis-hears. Speech gathering is available (`mode: "speech"`) if you later confirm Cantonese recognition quality.
3. Twilio posts the result to `/api/telephony/events`, which is verified (signature or shared secret), idempotent, and applies the same rules as the mock.
4. Recording is never enabled (`Record=false`), so FR-13 holds.

### 5e. If Cantonese voice quality is not good enough

Pre-generate the script as audio with a free Cantonese TTS tier (e.g. Azure Speech `zh-HK` voices, ~500k chars/month free), host the MP3, and set `TWILIO_AUDIO_URL`. The call then plays your audio instead of the carrier's TTS — which decouples voice quality from the phone provider and settles the open PRD question.

Until a vendor is configured, `TELEPHONY_PROVIDER=mock` keeps every journey demoable with simulated answers.

---

## What is still needed from you

| # | Item | Why |
|---|---|---|
| 1 | Supabase project URL + publishable key + **service role key** | Database, auth and the server cron |
| 2 | A Git repository (GitHub etc.) connected to Vercel | Deployment source |
| 3 | `ALLOWED_STAFF_EMAILS` list (real staff emails) | Replaces open sign-up |
| 4 | Vercel plan choice: Pro (per-minute cron) **or** use an external scheduler | Scheduling frequency |
| 5 | Telephony vendor decision + account (Twilio or other) | Real calls to consenting team phones (FR-03) |
| 6 | Fixed caller number | Required before real pilot calls |
| 7 | Approved Cantonese script wording | The script is currently marked DRAFT |
| 8 | Business/technical approval for the demo | PRD release process |

## Known limitations (by design, prototype scope)

- Real speech recognition depends on the telephony vendor; the outcome classifier is a keyword classifier.
- `TELEPHONY_PROVIDER=mock` means no real phone rings.
- Legal/privacy/telecommunications review is out of scope for the prototype and required before real use.
