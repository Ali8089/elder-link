---
name: verify-before-you-trust
description: >
  Use this skill before reporting that a build, page, test suite, API, deployment
  or hardware integration "works". It forces discriminating verification: prove a
  test can fail before trusting it, trace output over time instead of snapshotting,
  use realistic fixtures, audit your own test harness for destructive side effects,
  and triage environment faults separately from code defects. Also covers prompting
  for verifiability — turning a vague request into one with an acceptance test and
  a negative scope. Written for agents that can execute — it trades reassurance for
  evidence.
version: 1.1.0
license: MIT
---

# Verify before you trust

An agent that can execute should never report a claim it has not tested by
executing. But the deeper failure is subtler: **passing a test is not evidence.**
A test that cannot fail is decoration, and a fixture that does not resemble real
input will certify a broken product.

This skill is the checklist that prevented four green-test/broken-product failures
in a six-day safety-critical build. Apply it before any sentence that begins
"it works", "the build is green", "the endpoint returns 200", or "deployed
successfully".

---

## Rule 1 — Make the test fail before you trust it

Before accepting any test as proof, **break the feature it claims to cover** and
confirm the test fails.

Procedure:

1. Note the current result (`N/N passing`).
2. Revert the fix, or reintroduce the original bug in the smallest possible way.
3. Run **only** the tests that are supposed to cover it.
4. Confirm they fail.
5. Restore the fix and confirm they pass again.

If step 4 passes, the test is decorative. Fix the test, not the bug report.

Real example — a claim that was disproved exactly this way:

> Claim: "the closing music is silent because `hangUp()` calls `stopMusic()`."
> Reintroduced that call: **E2E still passed 13/13.** The diagnosis was wrong.
> The real cause was a one-shot ref shared with `onComplete`, which re-ran the
> effect with a fresh callback identity and returned early.

And once the cause was corrected, proving the *test* was real mattered too:
reintroducing the gating failed exactly the 3 music checks and nothing else.

---

## Rule 2 — Trace over time, never trust one snapshot

Client-side rendering, hydration, background effects and async commits all produce
pages that are correct at t=0 and wrong at t=1s.

Ask for **a time series, not an observation**:

```
t=500ms  /app/ -> forms=1  pw=1   (login form renders)
t=1500ms /app/ -> forms=0  pw=0   "404 / Page not found"
```

That page had passed a "styles verified" check, because the 404 screen inherited
the same fonts and background. Check the *content and behaviour* at multiple
timestamps, not the presence of chrome.

Practical form: poll the target 3–5 times with 500ms spacing and assert a property
that must hold at every sample (an element exists, a value is stable, a counter
does not reset).

---

## Rule 3 — Test with the shape of real input, not a clean sample

Real inputs are mostly nothing. A microphone recording is ~12 s of room tone with
~2 s of speech. A real request is retried, partial, or aborted. A real user pauses
mid-sentence.

If every fixture is clean, loud, fast and complete, the suite certifies a product
that only works under lab conditions.

Reverse-engineer the production shape, then synthesise a fixture with it:

| Claimed capability | Unrealistic fixture | Realistic fixture |
| --- | --- | --- |
| Speech recognition | studio clip, no silence | 12 s noise floor + 2 s faint speech |
| File upload | 1 small well-formed file | empty file, truncated file, 50 MB file |
| API client | 200 with full body | 200 with partial body, 429, timeout, HTML error page |
| Email/phone validation | `a@b.co` | `+852 5x` landline, leading zero, spaces, `+852` with no gap |

Measured failure that this rule caught: the transcriber looked perfect against
`public/audio/*.mp3` and returned the prompt eleven times against a quiet room.

---

## Rule 4 — Audit your own harness for destructive side effects

Before running a probe or a test suite that touches a live system, **read your own
test code** and ask: what does this do to things that are real?

Look for:

- Real email addresses used to test failed logins (this locks the account)
- Real phone numbers used to test dialling (this rings a person)
- Real identifiers used in delete/update probes
- Test rows inserted into a production table with no cleanup
- Migrations or schema changes run as a side effect of verifying

Real example, caught by re-reading the harness:

> The login probe was locking itself — and it used the user's REAL email address,
> which would have locked a real account out.

Fix: generate a unique throwaway identity per run. Prefer a disposable database
or a demo account; never the account the human actually uses.

---

## Rule 5 — Retract the diagnosis, do not delete it

When a root cause is disproved, the correction must land in **three** places:

1. The code comment that states the wrong mechanism.
2. The memory/log entry that asserted it.
3. The report or handoff that repeated it.

Nobody benefits from a clean narrative. The retraction is the evidence that
verification happened.

Write it as: *claim → how it was tested → result → real cause*, e.g.

```
// CORRECTED 2026-10-15: this was previously documented as the cause of the
// silence bug. It is not. hangUp() runs before React commits stage="ended",
// so stopMusic() here is a no-op. Real cause: the music effect shared a
// one-shot ref with onComplete. Verified by reintroducing this call — E2E
// still passed 13/13.
```

---

## Rule 6 — Triage the layer before changing the code

A large share of "bugs" are environment faults. Decide which layer owns the fault
first, because fixing the wrong layer produces churn and false confidence.

Order of triage:

1. **Is the served artefact what I think it is?** Fetch it and diff against disk.
2. **Is the client seeing a stale copy?** Cache headers, service worker, `localStorage`.
3. **Is the network path intact?** Same host, same port, same scheme as the thing that works.
4. **Is it the sandbox/tool, not the code?** Reproduce with a different tool (`curl` vs `node fetch`, `gh api` vs `git push`).
5. **Is it a platform rule?** e.g. browsers cannot auto-dial; Android Chrome refuses Fullscreen to normal tabs.
6. Only then: **is it a code defect?**

Real examples of misattribution avoided:

- "The page is broken" — the phone was serving a cached copy; `curl` on the live
  server showed the correct Cantonese labels existing on disk all along.
- "Build is broken" — a sandbox bulk-delete guard aborted nitro's cleanup. The
  code was fine; the workaround was a different output directory.
- "Hardware is offline" — the ESP32 does not answer ICMP ping. Use its HTTP
  endpoint, not `ping`.

---

## Rule 7 — Prefer the assertion that would have caught it

When a bug is found, add the test that reproduces the **user-visible symptom**,
and name the file after that symptom, not after the module.

Bad name: `runner.test.ts` (already exists)
Good name: `check-alarm-fires-once.mjs`

Good tests are also honest about what they cover. If a path cannot be tested
(e.g. real device microphone), say so in the report instead of implying coverage:

> Fake-device audio does not reproduce the clip faithfully. The user's next live
> attempt is the real confirmation.

---

## Prompting for verifiability (what to ask the human for, if they didn't say it)

A verification-first agent is only as good as the task definition it receives. If
an instruction lacks an acceptance test, **ask for one before writing code** — do
not infer "done" from the sentence.

Five elements make a task verifiable. If any are missing, ask one short question
rather than guessing:

| Element | Question to ask | Why its absence hurts |
| --- | --- | --- |
| **Target** | Which file/runtime/device exactly? | Wrong artefact gets fixed; the real one stays broken |
| **Observation** | What do you see, and where do you see it? | A summary ("it doesn't work") hides which layer is wrong (§Rule 6) |
| **Acceptance test** | What command/assertion proves it fixed? | "Done" becomes a judgement call, usually resolved by confidence |
| **Negative scope** | What must not change? | Debugging one symptom refactors three unrelated files |
| **Stop condition** | When should I stop and ask instead of working around it? | Platform limits get papered over with misleading claims |

Write the acceptance test into the repo as a named script before fixing anything.
If you cannot express success as an assertion, you do not yet know what success is.

Anti-pattern to refuse: a prompt that specifies the *solution* but not the
*evidence* ("use requestFullscreen with navigationUI: hide"). It instructs the
agent to implement a hypothesis. Ask instead what observable state should be true
afterwards, then test that state.

---

## Before you write "it works" — checklist

- [ ] I reproduced the claimed behaviour by executing, not by reading.
- [ ] The covering test fails when the feature is broken (Rule 1).
- [ ] I sampled more than one point in time, or justified why not (Rule 2).
- [ ] At least one fixture resembles real input, including its empty/slow/noisy case (Rule 3).
- [ ] I read my own probe code for side effects on real accounts/data (Rule 4).
- [ ] Any retracted diagnosis is corrected in the code comment and the log (Rule 5).
- [ ] Environment faults were ruled out before code changes (Rule 6).
- [ ] Anything I could not verify is stated as a limit, not implied as verified.

---

## Memory log template

Keep one file per day. Record root cause, evidence, and the wrong turns — the
wrong turns are the reusable part.

```markdown
# YYYY-MM-DD

## What was attempted
- …

## What actually happened
- …

## Root cause (with evidence)
- claim:
- how it was tested:
- result:
- real cause:
- disproved claim (if any):

## Environment gotchas
- (behaviour that would waste the next session's time)

## Verified state
- tests: N/N (files) | tsc: clean/errors | browser checks: N/N
- what is still UNVERIFIED:
```

---

## Anti-patterns this skill exists to prevent

| Anti-pattern | Why it costs you |
| --- | --- |
| "Tests pass, so it works" | Passing tests only prove the fixtures are consistent with the code |
| "The endpoint returns 200" | 200 with an error body is a common failure mode |
| "I read the code and it looks right" | Reading is a hypothesis; execution is a test |
| "The deploy succeeded" | A green build can ship an unauthenticated 404 |
| Silently dropping a wrong diagnosis | Guarantees the next session repeats it |
| Hard-coding a limit as "impossible" | Distinguish *platform rule* from *not yet tried* |
