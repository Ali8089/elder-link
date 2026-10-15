# Elder Link — Upgraded PRD (PRD_v2.md)

**Owner:** Ali  
**Product:** Elder Link / HK Elderly AI Check-In Call  
**Scope:** Six-day demonstration prototype, fake data and consenting team numbers only.  
**Goal:** Build a working, demonstrable system that passes the three core journeys twice consecutively and meets the original PRD acceptance criteria.

---

## 1. Ten plain lines — what is being built

1. Elder Link is a phone-and-dashboard service for Hong Kong elders aged 65+ who live alone.
2. It makes short automated Cantonese check-in calls every two to three days on ordinary phones.
3. A safe answer is logged; the elder hears one suitable activity suggestion.
4. A worrying, unclear, or immediate-danger answer starts a human escalation within one minute.
5. No answer triggers one retry after 5–10 minutes, then escalates to the contact chain.
6. Sensor alerts can also start a verification call within one minute.
7. Staff use a shared, bilingual, responsive dashboard to enrol elders, view cases, and record actions.
8. No audio, no HKID, no payment data, no medical advice, and no 999 replacement are kept or claimed.
9. The six-day prototype uses fake records and consenting team phone numbers only.
10. Unknowns remain: exact Cantonese wording, live telephony vendor, real-hosting region, and legal sign-off.

---

## 2. Questions that block the plan

No blocking questions. Assumptions made:

- Telephony will be a mock/simulated adapter first; a real-provider adapter can replace it later without changing the rest of the code.
- Cantonese scripts will be provided as bilingual text (Traditional Chinese + English) and marked as drafts pending final approval.
- The stack is React + TypeScript frontend, Node.js + TypeScript API, PostgreSQL-compatible database, and a lightweight scheduler/queue.
- Agent instruction files, task board, scoreboard, and trace template are created in Phase 1; they are not product code.

---

## 3. Goals — each with a “done means” check

| ID | Goal | Done means |
|----|------|-----------|
| G1 | Enrolment and consent can be created, edited, and activated safely. | A sample elder record can be created; activation is blocked until all required fields and consents are present. |
| G2 | Scheduled check-ins happen every 2–3 days and are visible when overdue. | A due check creates a call job; the dashboard shows overdue with an icon and text. |
| G3 | The three core journeys (safe, worrying, no-answer) pass twice consecutively in a real call to team numbers. | Each journey runs end-to-end twice with the same result and timestamps under one minute for escalation start. |
| G4 | Sensor-triggered verification calls start within one minute and close safely. | A simulated sensor event creates a call job within 60 seconds; a safe response closes the alert and notifies the contact. |
| G5 | The contact chain calls first contact, then second, then operator, and logs every step. | A worrying/no-answer case escalates through the chain in order; acknowledgements are saved. |
| G6 | Staff can sign in separately and share one consistent dashboard view. | Three simultaneous test users can log in and see/update the same case list without losing data. |
| G7 | Data is kept private and deleted after exit. | No audio or sensitive fields are stored; 30 days after opt-out the elder record and notes are removed. |
| G8 | The demo has evidence and a fallback. | There is a test evidence bundle, a smoke test, and a recorded backup demonstration path. |

---

## 4. Teams and agents

Each team has **3 sub-agents** and **1 team supervisor**.  
All agents read `PRD_v2.md`, `TASKBOARD.md`, `SCOREBOARD.md`, and `TRACE.md` before acting.  
Instruction files live in `/agents/`.

| Team | Focus | Supervisor | Thinker | Coder | Reviewer |
|------|-------|------------|---------|-------|----------|
| **API** | Backend service, routes, business logic | `api-supervisor` | `api-thinker` | `api-coder` | `api-reviewer` |
| **Dashboard** | React/TypeScript staff UI | `ui-supervisor` | `ui-thinker` | `ui-coder` | `ui-reviewer` |
| **Telephony** | Mock provider, call jobs, webhooks, scripts | `tel-supervisor` | `tel-thinker` | `tel-coder` | `tel-reviewer` |
| **Scheduler** | Due jobs, retries, escalation timing, contact chain | `sch-supervisor` | `sch-thinker` | `sch-coder` | `sch-reviewer` |
| **Data & Security** | Schema, auth, privacy, audit, deletion | `sec-supervisor` | `sec-thinker` | `sec-coder` | `sec-reviewer` |
| **Integration / QA** | E2E scenarios, evidence bundle, demo fallback | `qa-supervisor` | `qa-thinker` | `qa-coder` | `qa-reviewer` |

### Agent roles (shared)

- **Thinker:** reads the context, writes a tiny plan for one task, lists risks, and passes it to the Coder. Does not write final code.
- **Coder:** writes exactly one small task at a time. Tests the file locally. Reports back with proof.
- **Reviewer:** checks the finished piece immediately, runs the build/tests, reads error messages, and for anything visual takes a screenshot and compares it with the design goal.
- **Team Supervisor:** accepts the task only with proof, updates the scoreboard, and writes one trace entry.

---

## 5. Tasks — very small pieces

One task = one file or one small feature.  
All tasks depend on the project setup task unless noted otherwise.

### API team

| ID | Task | Team | Done-check | Depends on |
|----|------|------|------------|------------|
| T_API_001 | Initialise Node/Express/TypeScript backend with health endpoint. | API | `npm test` passes a health-check test. | — |
| T_API_002 | Add PostgreSQL connection and migration runner. | API | Migrations run and rollback cleanly. | T_API_001 |
| T_API_003 | Implement auth login endpoint with role checks and rate limiting. | API | Login returns token; 5 failed attempts lock for 15 minutes. | T_SEC_002 |
| T_API_004 | Implement elders CRUD endpoints (GET list, POST, PATCH, GET/activate). | API | Postman/curl tests create, update, and activate an elder. | T_SEC_003 |
| T_API_005 | Implement check-ins endpoint to start a scheduled or demo call job. | API | POST `/v1/check-ins` creates a call job with correct due time. | T_SCH_001, T_TEL_001 |
| T_API_006 | Implement cases endpoints (acknowledge, follow-up, opt-out, retrieve). | API | Case actions update status, note, and timestamp. | T_SEC_004 |
| T_API_007 | Implement sensor-alerts endpoint (accept unique simulated alert). | API | Sensor event creates a verification call job within 60 seconds. | T_SCH_004 |
| T_API_008 | Implement telephony-events webhook handler (idempotent). | API | Duplicate events do not create duplicate calls/escalations. | T_TEL_004 |
| T_API_009 | Implement analytics summary endpoint (aggregate prototype metrics). | API | Dashboard shows correct counts for safe/worrying/no-answer/overdue. | T_API_006 |
| T_API_010 | Write API unit/integration tests for all protected endpoints. | API | `npm test` covers auth, elders, cases, sensor, analytics. | T_API_004–T_API_009 |

### Dashboard team

| ID | Task | Team | Done-check | Depends on |
|----|------|------|------------|------------|
| T_UI_001 | Initialise React + TypeScript app with i18n (English + Traditional Chinese). | Dashboard | App builds; language switch works. | — |
| T_UI_002 | Build sign-in screen with language selection, credentials, accessible errors. | Dashboard | Login form submits and shows clear errors. | T_API_003 |
| T_UI_003 | Build shared case list screen (filters, overdue, urgent/newest first). | Dashboard | List matches API data; filters work on phone and desktop widths. | T_API_004, T_API_009 |
| T_UI_004 | Build elder/case detail screen (minimal profile, consent, history, chain). | Dashboard | Detail view loads from API; escalation chain is visible. | T_API_004, T_API_006 |
| T_UI_005 | Build case actions screen (acknowledge, short note, follow-up complete). | Dashboard | Actions save and update detail view in real time. | T_API_006 |
| T_UI_006 | Build enrolment/sample record screen with activation validation. | Dashboard | Missing fields block activation; complete record activates. | T_API_004 |
| T_UI_007 | Build test controls screen (demo call, sensor trigger) visibly labelled test-only. | Dashboard | Buttons create jobs via API; labels warn testers. | T_API_005, T_API_007 |
| T_UI_008 | Build analytics/health screen. | Dashboard | Screen shows scenario results, timings, unresolved cases. | T_API_009 |
| T_UI_009 | Apply responsive/mobile styles, large touch targets, colour + icon + text states. | Dashboard | WCAG contrast passes; no horizontal scroll on representative widths. | T_UI_002–T_UI_008 |
| T_UI_010 | Write dashboard component tests and a smoke test. | Dashboard | `npm test` passes; build has no errors. | T_UI_001–T_UI_009 |

### Telephony team

| ID | Task | Team | Done-check | Depends on |
|----|------|------|------------|------------|
| T_TEL_001 | Define telephony adapter interface and build a mock provider. | Telephony | Mock provider can be swapped without changing call orchestrator. | — |
| T_TEL_002 | Build outbound call job that rings a consenting team number. | Telephony | A real phone rings during the demo; status is tracked. | T_TEL_001 |
| T_TEL_003 | Write bilingual Cantonese/English script and AI disclosure text. | Telephony | Script is in repo, marked draft, and never asks for money/HKID. | — |
| T_TEL_004 | Build provider webhook handler that receives events idempotently. | Telephony | Duplicate webhook events are ignored. | T_TEL_001 |
| T_TEL_005 | Build call outcome classifier (safe, worrying, immediate danger, no answer). | Telephony | Each outcome maps to the correct next step. | T_SCH_005 |
| T_TEL_006 | Write telephony integration tests. | Telephony | Mock-provider tests pass; real-call test is documented. | T_TEL_002–T_TEL_005 |

### Scheduler team

| ID | Task | Team | Done-check | Depends on |
|----|------|------|------------|------------|
| T_SCH_001 | Build scheduler engine that creates call jobs every 2–3 days. | Scheduler | A sample elder gets a due call job at the right time. | T_API_002 |
| T_SCH_002 | Build overdue monitor and dashboard visibility. | Scheduler | Overdue check-ins appear in dashboard with icon/text. | T_API_002, T_UI_003 |
| T_SCH_003 | Build no-answer retry (one retry after 5–10 minutes). | Scheduler | First no-answer schedules retry; second no-answer escalates. | T_TEL_005 |
| T_SCH_004 | Build escalation timing (human call starts within 60 seconds). | Scheduler | Timestamps show escalation starts within 60 seconds of worrying result. | T_TEL_005 |
| T_SCH_005 | Build contact chain (first contact → second contact → operator). | Scheduler | Chain calls in order; if first answers, later contacts are skipped. | T_TEL_002 |
| T_SCH_006 | Write scheduler tests. | Scheduler | Due, retry, and escalation timings pass with mocked clocks. | T_SCH_001–T_SCH_005 |

### Data & Security team

| ID | Task | Team | Done-check | Depends on |
|----|------|------|------------|------------|
| T_SEC_001 | Set up database connection, migrations, and seed sample data. | Data/Security | `npm run migrate` and `npm run seed` work. | T_API_001 |
| T_SEC_002 | Implement users, roles, and auth middleware. | Data/Security | Protected endpoints reject invalid/expired tokens; roles enforced. | T_SEC_001 |
| T_SEC_003 | Implement elders data model with privacy rules (no HKID, no audio, masked phone numbers in logs). | Data/Security | Schema blocks HKID/audio fields; logs mask phone numbers. | T_SEC_001 |
| T_SEC_004 | Implement append-only audit events (never copy deleted note contents). | Data/Security | Audit log records actor/action/time/request without note text. | T_SEC_001 |
| T_SEC_005 | Implement data deletion worker (remove elder and notes 30 days after exit). | Data/Security | Worker deletes records after 30 days; audit metadata remains. | T_SEC_003, T_SEC_004 |
| T_SEC_006 | Write security tests (auth, rate limits, input sanitisation, masked logs). | Data/Security | `npm test` passes security tests. | T_SEC_002–T_SEC_005 |

### Integration / QA team

| ID | Task | Team | Done-check | Depends on |
|----|------|------|------------|------------|
| T_QA_001 | Write end-to-end safe-journey scenario test. | QA | Safe response creates note, offers activity, and schedules next check. | T_API_005, T_TEL_005, T_SCH_001 |
| T_QA_002 | Write end-to-end worrying-journey scenario test. | QA | Worrying answer triggers escalation within 60 seconds and contact chain. | T_SCH_004, T_SCH_005 |
| T_QA_003 | Write end-to-end no-answer and sensor-verification scenario tests. | QA | No-answer retries once then escalates; sensor starts call within 60 seconds. | T_SCH_003, T_API_007 |
| T_QA_004 | Run bilingual, accessibility, and three-concurrent-user checks. | QA | Screenshots show Traditional Chinese + English; three users can work concurrently. | T_UI_009, T_UI_010 |
| T_QA_005 | Prepare demo evidence bundle (checklist, timestamps, screenshots, build commit). | QA | Evidence file exists and matches acceptance criteria. | T_QA_001–T_QA_004 |
| T_QA_006 | Run build, smoke test, and recorded backup demonstration. | QA | Build succeeds; backup demo recording or script is ready. | All core tasks |

---

## 6. Workflow — how the agents work together

1. The Mega Supervisor picks the next task from `TASKBOARD.md` and assigns it to a team.
2. The Team Supervisor gives the task to the **Thinker**. The Thinker writes a tiny plan and passes it to the **Coder**.
3. The **Coder** writes one small file or feature, runs the local check, and passes the result to the **Reviewer**.
4. The **Reviewer** checks immediately: runs tests/build, reads real error messages, and compares screenshots for UI work.
5. If it passes, the Team Supervisor accepts it, updates `SCOREBOARD.md`, and writes one line in `TRACE.md`.
6. If it fails, the Coder fixes it (one retry). If it still fails, the Thinker makes a new plan. If it fails a third time, the Mega Supervisor changes approach or asks the user.
7. While the Reviewer checks task N, the Coder may start task N+1 if it touches different files.
8. At most **2 teams** run at the same time, and only if they touch different files.
9. The Mega Supervisor checks that nothing clashes and that every accepted task matches the PRD.

---

## 7. KPIs per team

| Team | KPI | How measured |
|------|-----|--------------|
| API | First-time pass rate, build-break count, endpoint coverage | `SCOREBOARD.md` points and test coverage report |
| Dashboard | First-time pass rate, visual regressions, accessibility pass/fail | Screenshots + `SCOREBOARD.md` + a11y checklist |
| Telephony | Adapter swap success, call-initiation timing, duplicate-event safety | Mock tests + real-call timing logs |
| Scheduler | Timing accuracy (due, retry, escalation within limits) | Timestamp logs from scenario tests |
| Data/Security | Privacy rule violations, auth bypass attempts, deletion correctness | Security tests + audit-log review |
| QA | Scenario pass rate, evidence completeness, demo fallback ready | E2E test results + evidence bundle checklist |

From `SCOREBOARD.md` we derive:

- **First-time pass rate** = tasks passing on first review ÷ tasks accepted.
- **Bugs per task** = reviewer-found bugs ÷ tasks completed.
- **Rework count** = tasks that needed a Thinker replan.
- **Tasks done vs planned** = accepted tasks ÷ total tasks.

---

## 8. Scoring rules

Points are kept in `SCOREBOARD.md`.

| Event | Points |
|-------|--------|
| Task passes on first review | +2 |
| Task passes after one Coder fix | +1 |
| Reviewer finds a bug | -1 |
| Build breaks (test or compile fails on accepted code) | -2 |
| Someone says “done” without proof | -3 |
| Two failures on one task → Thinker replans | note in trace |
| Three failures on one task → Mega Supervisor escalates to user | note in trace |

---

## 9. Trace file rules (`TRACE.md`)

`TRACE.md` is written in short, plain words. A person with no tech background must understand it. Another AI must be able to take over from it alone.

After **every task** add one entry with this format:

```
### Task <ID> — <name> | <status>
- What was done: one line.
- Problem faced: one line, or “None.”
- How it was fixed: one line, or “Not needed.”
- What is left: one line, or “Nothing.”
```

Allowed statuses: **done**, **stuck**, **waiting**.

At the top of `TRACE.md`, always keep this box:

```
## STATUS NOW
- Finished: <list>
- In progress: <list>
- Next: <list>
- Blocked: <list>
```

Keep each entry to 3–5 short lines.

---

## 10. Preserved original requirements (summary)

The full original PRD (`PRD_GEN AI.pdf`) remains the source of truth. Key preserved ideas:

- Target users: Cantonese-speaking Hong Kong residents aged 65+ living alone; hidden elders are the priority.
- No app or special device needed; calls go to ordinary mobile phones and landlines.
- Human decides every emergency action; Elder Link does not replace 999 or emergency alarms.
- Core differentiators: automated Cantonese conversations, sensor verification, human escalation, community-service connection.
- Prototype constraints: sample data and consenting team test numbers only; no real elder records; no retained audio.
- Functional requirements FR-01 to FR-14 are Must-haves; FR-15 to FR-19 are Should/Could; FR-20 is out of scope.
- Acceptance criteria for FR-01 to FR-14 are included in the tasks above.
- Technical stack: React + TypeScript web app, Node.js + TypeScript API, PostgreSQL-compatible store, managed scheduler/queue, managed telephony provider, unit/API tests + scripted real-call scenarios, managed test hosting.
- Security: TLS in transit, encryption at rest, secrets outside source control, least privilege, masked phone numbers in logs, three-party consent checks, no audio retention, 30-day deletion after exit.
- Accessibility: Traditional Chinese with natural Cantonese wording and English; large readable text; sufficient contrast; visible focus; semantic headings; screen-reader status announcements; colour is never the only indicator.
- Release process: freeze → confirm review/tests/evidence → verify sample data and test numbers → smoke test and backup video → business/technical joint approval → tag build and known issues → live attempt, one retry, then disclosed recording.
- Defect severity: P0 blocker must be fixed; P1 major fixed before demo where possible; P2 minor recorded and deferred.

---

## 11. Agent instruction file index

All files are in `/agents/`:

- `api-thinker.md`, `api-coder.md`, `api-reviewer.md`
- `ui-thinker.md`, `ui-coder.md`, `ui-reviewer.md`
- `tel-thinker.md`, `tel-coder.md`, `tel-reviewer.md`
- `sch-thinker.md`, `sch-coder.md`, `sch-reviewer.md`
- `sec-thinker.md`, `sec-coder.md`, `sec-reviewer.md`
- `qa-thinker.md`, `qa-coder.md`, `qa-reviewer.md`

Each file contains the shared role rules plus team-specific context.

---

*End of PRD_v2.md. Phase 1 planning only. Product code is not written yet.*
