# TASKBOARD.md — Elder Link

## How to use this file

- Each task has one owner team and one status.
- Only the team supervisor updates the status of their team's tasks.
- Statuses: `todo`, `in_progress`, `review`, `done`, `stuck`, `blocked`.

## Tasks

### API team

| ID | Task | Status | Owner | Depends on |
|----|------|--------|-------|------------|
| T_API_001 | Initialise Node/Express/TypeScript backend with health endpoint. | todo | API | — |
| T_API_002 | Add PostgreSQL connection and migration runner. | todo | API | T_API_001 |
| T_API_003 | Implement auth login endpoint with role checks and rate limiting. | todo | API | T_SEC_002 |
| T_API_004 | Implement elders CRUD endpoints. | todo | API | T_SEC_003 |
| T_API_005 | Implement check-ins endpoint to start a scheduled or demo call job. | todo | API | T_SCH_001, T_TEL_001 |
| T_API_006 | Implement cases endpoints. | todo | API | T_SEC_004 |
| T_API_007 | Implement sensor-alerts endpoint. | todo | API | T_SCH_004 |
| T_API_008 | Implement telephony-events webhook handler. | todo | API | T_TEL_004 |
| T_API_009 | Implement analytics summary endpoint. | todo | API | T_API_006 |
| T_API_010 | Write API unit/integration tests. | todo | API | T_API_004–T_API_009 |

### Dashboard team

| ID | Task | Status | Owner | Depends on |
|----|------|--------|-------|------------|
| T_UI_001 | Initialise React + TypeScript app with i18n. | todo | Dashboard | — |
| T_UI_002 | Build sign-in screen. | todo | Dashboard | T_API_003 |
| T_UI_003 | Build shared case list screen. | todo | Dashboard | T_API_004, T_API_009 |
| T_UI_004 | Build elder/case detail screen. | todo | Dashboard | T_API_004, T_API_006 |
| T_UI_005 | Build case actions screen. | todo | Dashboard | T_API_006 |
| T_UI_006 | Build enrolment/sample record screen. | todo | Dashboard | T_API_004 |
| T_UI_007 | Build test controls screen. | todo | Dashboard | T_API_005, T_API_007 |
| T_UI_008 | Build analytics/health screen. | todo | Dashboard | T_API_009 |
| T_UI_009 | Apply responsive/mobile styles and accessibility. | todo | Dashboard | T_UI_002–T_UI_008 |
| T_UI_010 | Write dashboard component tests and smoke test. | todo | Dashboard | T_UI_001–T_UI_009 |

### Telephony team

| ID | Task | Status | Owner | Depends on |
|----|------|--------|-------|------------|
| T_TEL_001 | Define telephony adapter interface and build mock provider. | todo | Telephony | — |
| T_TEL_002 | Build outbound call job. | todo | Telephony | T_TEL_001 |
| T_TEL_003 | Write bilingual Cantonese/English script and AI disclosure. | todo | Telephony | — |
| T_TEL_004 | Build provider webhook handler. | todo | Telephony | T_TEL_001 |
| T_TEL_005 | Build call outcome classifier. | todo | Telephony | T_SCH_005 |
| T_TEL_006 | Write telephony integration tests. | todo | Telephony | T_TEL_002–T_TEL_005 |

### Scheduler team

| ID | Task | Status | Owner | Depends on |
|----|------|--------|-------|------------|
| T_SCH_001 | Build scheduler engine. | todo | Scheduler | T_API_002 |
| T_SCH_002 | Build overdue monitor and dashboard visibility. | todo | Scheduler | T_API_002, T_UI_003 |
| T_SCH_003 | Build no-answer retry. | todo | Scheduler | T_TEL_005 |
| T_SCH_004 | Build escalation timing. | todo | Scheduler | T_TEL_005 |
| T_SCH_005 | Build contact chain. | todo | Scheduler | T_TEL_002 |
| T_SCH_006 | Write scheduler tests. | todo | Scheduler | T_SCH_001–T_SCH_005 |

### Data & Security team

| ID | Task | Status | Owner | Depends on |
|----|------|--------|-------|------------|
| T_SEC_001 | Set up database connection, migrations, and seed data. | todo | Data/Security | T_API_001 |
| T_SEC_002 | Implement users, roles, and auth middleware. | todo | Data/Security | T_SEC_001 |
| T_SEC_003 | Implement elders data model with privacy rules. | todo | Data/Security | T_SEC_001 |
| T_SEC_004 | Implement append-only audit events. | todo | Data/Security | T_SEC_001 |
| T_SEC_005 | Implement data deletion worker. | todo | Data/Security | T_SEC_003, T_SEC_004 |
| T_SEC_006 | Write security tests. | todo | Data/Security | T_SEC_002–T_SEC_005 |

### Integration / QA team

| ID | Task | Status | Owner | Depends on |
|----|------|--------|-------|------------|
| T_QA_001 | Write end-to-end safe-journey scenario test. | todo | QA | T_API_005, T_TEL_005, T_SCH_001 |
| T_QA_002 | Write end-to-end worrying-journey scenario test. | todo | QA | T_SCH_004, T_SCH_005 |
| T_QA_003 | Write end-to-end no-answer and sensor-verification tests. | todo | QA | T_SCH_003, T_API_007 |
| T_QA_004 | Run bilingual, accessibility, and three-concurrent-user checks. | todo | QA | T_UI_009, T_UI_010 |
| T_QA_005 | Prepare demo evidence bundle. | todo | QA | T_QA_001–T_QA_004 |
| T_QA_006 | Run build, smoke test, and recorded backup demo. | todo | QA | All core tasks |

---

*Last updated: Phase 1 planning.*
