# Deploying Elder Link to Vercel

> **Status: deployed.** Production URL: <https://elder-link-kappa.vercel.app>
> Vercel project `elder-link` (team `aaattiyab2-c-7889s-projects`, Hobby plan).
> All 8 production environment variables are set. `/api/health` reports every
> config flag green and `/api/cron/tick` is authenticated and working.
> Re-deploy with `npx vercel --prod`.

Everything in the codebase is ready. The steps below need **your accounts** (Supabase, Vercel, and a telephony vendor for real calls).

---

## 1. Supabase (database + auth)

> **Order matters:** run `0000` first, then `0001`, then `0002`. `0001` is
> additive and assumes the core tables from `0000` already exist. `0002` adds
> the family-monitoring role and table. All three files are in
> `supabase/migrations/`.

1. Create (or open) a Supabase project.
2. Open **SQL Editor** and run, in order:
   1. `supabase/migrations/0000_migration.sql` — core schema, RLS, helper
      functions, `purge_opted_out_elders()`, realtime publication, demo seed.
   2. `supabase/migrations/0001_prd_completion.sql` — PRD completion fields,
      extra tables, login RPCs.
   3. `supabase/migrations/0002_family_monitoring.sql` — the `family` role,
      `family_members` table, and the read-only family RLS policies.
   > If `0000` and `0001` were already applied earlier, run only `0002`.
   > `0002` redefines `is_staff()` so it means admin/operator only — without
   > that, adding the family role would have made every relative look like
   > staff to the existing policies.
3. **After `0002` is applied**, regenerate the database types so the app sees
   the new table (the hand-written `FamilyMemberRow` seam in
   `src/integrations/supabase/types.ts` becomes redundant and can be deleted):
   ```bash
   npx supabase gen types typescript --project-id <ref> --schema public \
     > src/integrations/supabase/types.ts
   ```
   This needs a Supabase personal access token (`supabase login`) or a linked
   project. There is no way to run DDL with the anon or service_role key alone.
4. Copy these values from **Project Settings → API**:
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
| Sign in as a family user | Sees `/family`, read-only, no care actions offered |
| Family user changes their notify level | Saves; no other field is writable |

## 4a. The spoken call (audio pipeline)

The check-in call speaks **real Cantonese audio**, not text. The clips are
pre-rendered into `public/audio/` and served as static files, so a call never
depends on a live TTS request succeeding.

| File | Line | Played |
|---|---|---|
| `disclosure.mp3` | AI disclosure | At answer, before anything else |
| `ask.mp3` | "How are you today?" | Prompt for the elder's answer |
| `safe.mp3` | Closing on the safe path | Outcome `safe` |
| `worry.mp3` | Closing on the worry path | Outcome `worrying` |
| `danger.mp3` | Tells the elder to call 999 | Outcome `danger` |
| `unclear.mp3` | Asks again, gently | Outcome `unclear` |
| `no_answer.mp3` | Voicemail message | Nobody picked up |
| `close.mp3` | Goodbye | End of every call |
| `closing-music.wav` | Original pentatonic instrumental | **Safe path only**, after goodbye |

**Regenerate the clips** (free, no API key — uses the Google Translate TTS
speech endpoint with `tl=yue`):

```bash
node scripts/generate-audio.mjs          # skips files that already exist
node scripts/generate-audio.mjs --force  # re-render everything
node scripts/generate-music.mjs          # re-render the closing music
```

> Edge-TTS (`zh-HK-WanLungNeural`) was the first choice and is the better voice,
> but its synthesis WebSocket returned **403 Forbidden** from this network. If
> your network allows it, swapping the engine in `scripts/generate-audio.mjs` is
> a one-function change; the file names and the component that plays them do not
> change.

**Speech recognition** is plumbed but needs one environment variable to go
live. Without it the app falls back to the existing keyword classifier.

```bash
SPEECH_TO_TEXT_URL=https://api.openai.com/v1/audio/transcriptions
SPEECH_TO_TEXT_API_KEY=sk-...        # optional for a self-hosted server
SPEECH_TO_TEXT_MODEL=whisper-1       # optional
SPEECH_TO_TEXT_LANGUAGE=yue          # optional; defaults to yue
```

Two safety rules are enforced in code, not by convention, both in
`src/lib/voice.ts`:

1. **Closing music plays on the safe path only** (`MUSIC_OUTCOMES`). The
   danger script ends by telling the elder to call 999 — music over that
   instruction would be actively harmful.
2. **A mishearing can never be recorded as safe.** `classifyCantonese()` in
   `src/lib/conversation.ts` returns `unclear` for anything it is not
   confident about, so an unrecognised utterance escalates for a human rather
   than closing the case.

A caption for the current line is always rendered on screen, so a relative or
staff member reviewing the call can read what was said.

## 4b. Speaking to the assistant (speech + a free model)

The call accepts **spoken Cantonese** as well as keypad input, and the
assistant answers in Cantonese.

### One key covers both directions: Groq

Groq is the recommended provider because a single free key does both jobs:

| Job | Model | Why |
|---|---|---|
| Speech recognition | `whisper-large-v3` | Noticeably better on Cantonese than `-turbo` |
| The assistant's reply | `llama-3.3-70b-versatile` | Fast, and free-tier |

Get a key at <https://console.groq.com/keys> — free, no credit card. Then:

```bash
VITE_GROQ_API_KEY=gsk_...   # reaches the browser; needed for mic + reply
GROQ_API_KEY=gsk_...        # server-side copy
```

Restart the dev server after adding them. The **"Answer by voice"** button
appears once a recogniser is configured; without a key the app runs the
deterministic Cantonese script and the keypad, exactly as before.

> The `VITE_` prefix is required because both the microphone capture and the
> reply generation happen in the browser. That means the key is visible to
> anyone using the app. Use your own free-tier key (revocable in seconds)
> rather than sharing one.

### Any other Whisper endpoint

`SPEECH_TO_TEXT_URL` still works — a self-hosted `faster-whisper`, OpenAI
itself, or any OpenAI-compatible gateway. It is used when `GROQ_API_KEY` is
unset, or always when `SPEECH_TO_TEXT_PROVIDER=custom`.

### What the model is and is not allowed to do

The LLM has exactly two jobs: classify what the elder said, and write the one
line the assistant says next. It is **not** allowed to decide whether to
escalate, contact family, or call an emergency real — those stay in
`src/lib/engine.ts`, where they are unit-tested.

Three rules are enforced in code (`src/lib/conversation.ts`) and covered by
`src/lib/conversation.test.ts`:

1. **An emergency phrase is never sent to the model.** A recognised danger
   phrase short-circuits to `danger` without a round trip, so it cannot be
   reclassified downward.
2. **The model cannot invent a "safe".** `safe` is only accepted when the
   deterministic classifier also found a wellbeing phrase. A model that
   answers "safe" to "我跌親，好痛" still routes to `danger` — this is asserted
   against a deliberately hostile mock.
3. **An outage degrades, never breaks.** Timeout, 429, 401, malformed JSON and
   no network all fall back to the deterministic classifier, which never
   returns `safe` for anything unrecognised.

The assistant's generated line is spoken with the platform's own Cantonese
voice (Web Speech synthesis), since the wording cannot be pre-recorded. If no
`yue`/`zh-HK` voice exists the line still appears as a caption and the
pre-recorded clip has already played, so the call never goes silent.

### Why not WhatsApp

WhatsApp is **not** usable as the call transport here, for a concrete reason
rather than a preference: the WhatsApp Business Cloud API sends *messages*, not
voice calls. Automated answering of an inbound call requires either a BSP with
its own telephony layer or the user to be using the app at that moment — which
is exactly what a check-in call for a frail elder cannot assume. It also
requires a Meta-verified business and a dedicated number that cannot be
registered to a personal WhatsApp account. The plain-phone-call path (Twilio,
already wired in `src/lib/telephony.ts`) is the transport that actually reaches
someone who may not be holding a phone with data.

## 4b. Family monitoring

`0002_family_monitoring.sql` adds a third role, `family`. A relative signs in
with their own account and reaches `/family`.

What a relative can see (all enforced by RLS, not by the UI):

- their own elder's profile, but **not** the consent flags
- check-in calls and their outcomes
- open cases and which escalation step is currently being worked
- sensor alerts and notifications
- community activities the elder showed interest in — **only if they opted in**

What they cannot see, deliberately: `contacts` (other relatives' phone
numbers), `audit_events`, `user_roles`, and any elder they are not linked to.
The only field a relative may write is their own `notify_level` and
`wants_activity_news`; a SECURITY DEFINER helper
(`family_members_prefs_only`) compares the proposed row against the stored one
so a crafted update cannot set its own `status = 'active'` and grant itself
access.

To invite a relative: as staff, insert a row into `family_members` with
`status = 'pending'`. Once they sign up and you set `status = 'active'` and
`user_id`, the screen populates.

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

---

## Verification status

Everything below was measured, not assumed.

### Automated (run these before believing any change)

```bash
npx vitest run          # 83 tests / 6 files
npx tsc --noEmit        # 0 errors
node scripts/e2e-call.mjs   # 13 checks against real Chromium — dev server must be up
```

`scripts/e2e-call.mjs` exists because mocked component tests gave **false confidence**.
The closing music once passed its unit test while being completely silent in the
browser. The E2E script drives real Chromium against the real dev server and
reports what the browser actually did — whether the audio element played, whether
its `currentTime` advanced, and whether every clip fetched with a 200.

It is deliberately checked against a **reintroduced bug**: gating the music effect
on the shared one-shot latch (the original defect) makes exactly the three music
checks fail and nothing else. A test that passes on broken code is worthless.

Current results: **83/83 unit, 13/13 E2E, 0 type errors**, 0 console errors,
0 failed requests.

### Speech recognition: built, tested, but off until a key is added

The `/api/speech/transcribe` route was verified end to end against a local
Whisper stand-in (`scripts/stub-whisper.mjs`). The stand-in confirmed the route
forwards the audio as `answer.webm` with `model=whisper-large-v3` and
`language=yue`, plus the Cantonese anti-hallucination prompt. With
`SPEECH_TO_TEXT_URL` set, `GET` returns `{"available":true,...}` and the
"Answer by voice" button appears at the answer stage.

With **no** provider configured — the state in a fresh clone — `GET` returns
`{"available":false,"reason":"..."}` and the call shows *"Voice answers are off"*
with the exact fix. It does not silently omit the control.

To turn it on: set `GROQ_API_KEY` (free tier covers Whisper). No other change.
