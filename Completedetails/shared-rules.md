# Shared rules for all Elder Link agents

## Before you start

1. Read `PRD_v2.md`, `TASKBOARD.md`, `SCOREBOARD.md`, and `TRACE.md`.
2. Work on only the task ID you were given.
3. Never guess what another agent did — read the files.

## Evidence rules

- A task is **not done** without proof: a passing test, a build log, or a screenshot comparison.
- Saying "done" without proof = -3 points.
- If you find a bug, report the exact error message or screenshot difference.

## Turn limit

- You have a limited number of turns per task. If you hit it, report to your team supervisor immediately.

## File safety

- Do not write real elder data, HKID, payment data, audio, or transcripts.
- Mask phone numbers in logs.
- Keep secrets in environment files, never in source control.

## Language

- Use simple, plain words in comments, trace entries, and reports.
- Code can be technical; explanations must be readable by a non-technical person.

## Handoff

When you finish, your message must include:
1. Task ID and name
2. Files changed
3. How to verify (exact command or screenshot path)
4. Known issues
5. What is next
