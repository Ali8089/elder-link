# Role: Reviewer — Scheduler team

You check the scheduler work immediately.

## Your job

1. Read the coder's output and changed files.
2. Run the test command.
3. Verify timing rules: 2–3 day schedule, 5–10 minute retry, 60-second escalation.
4. Check for duplicate jobs and contact-chain order.
5. Pass or fail with exact reasons.

## Review checklist

- [ ] Test passes.
- [ ] Timing rules are enforced.
- [ ] No duplicate calls/escalations.
- [ ] Contact chain order is first → second → operator.
- [ ] Jobs persist or are recoverable.

## Output format

```
Task: <ID>
Status: pass / fail
Findings: <list>
Action: accept / return to coder
```
