/**
 * Elder Link — local demo database.
 *
 * An in-memory stand-in for Supabase, used when no Supabase project is
 * configured (see `isDemoMode()` in ./demo-client). It lets the full dashboard
 * run locally against the mock telephony provider: every journey, the
 * escalation chain, the sensor flow and the analytics all work, and nothing
 * leaves the browser.
 *
 * Data lives for the lifetime of the page — a reload restores the seed below.
 */
export type Row = Record<string, any>;
export type DemoDb = Record<string, Row[]>;

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

const offsetIso = (ms: number) => new Date(Date.now() + ms).toISOString();

/** RFC-4122 v4-shaped id, so anything that expects a uuid keeps working. */
export function uuid(): string {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

/** The signed-in staff account used in demo mode. */
export const DEMO_USER = { id: "00000000-0000-4000-8000-000000000001", email: "demo@oic.hk" };

export const DEMO_SESSION = {
  access_token: "demo-access-token",
  refresh_token: "demo-refresh-token",
  token_type: "bearer",
  expires_in: 3600,
  expires_at: Math.floor(Date.now() / 1000) + 3600,
  user: DEMO_USER,
};

const E1 = "11111111-1111-4111-8111-111111111111";
const E2 = "22222222-2222-4222-8222-222222222222";
const E3 = "33333333-3333-4333-8333-333333333333";
const E4 = "44444444-4444-4444-8444-444444444444";
const E5 = "55555555-5555-4555-8555-555555555555";
const CASE1 = "c0000000-0000-4000-8000-000000000001";

/**
 * Builds a fresh copy of the demo dataset.
 * Sample elders/contacts mirror the PRD personas; no HKID or real phone numbers.
 */
export function createDemoDb(): DemoDb {
  const elders: Row[] = [
    {
      id: E1,
      display_name: "陳婆婆",
      reference_number: "EL-0001",
      district: "深水埗 Sham Shui Po",
      centre: "Sham Shui Po",
      phone: "+852 5000 0001",
      preferred_language: "yue",
      preferred_call_time: "10:00",
      consent_elder: true,
      consent_contact: true,
      consent_service: true,
      consent_checked_at: offsetIso(-2 * DAY),
      status: "active",
      check_interval_days: 2,
      // Deliberately overdue, so the "overdue" badge and the due-check flow are visible.
      next_check_at: offsetIso(-6 * HOUR),
      last_check_at: offsetIso(-2 * DAY),
      opted_out_at: null,
      created_at: offsetIso(-30 * DAY),
      updated_at: offsetIso(-2 * DAY),
    },
    {
      id: E2,
      display_name: "李伯",
      reference_number: "EL-0002",
      district: "觀塘 Kwun Tong",
      centre: "Kwun Tong",
      phone: "+852 5000 0002",
      preferred_language: "yue",
      preferred_call_time: "14:30",
      consent_elder: true,
      consent_contact: true,
      consent_service: true,
      consent_checked_at: offsetIso(-1 * DAY),
      status: "active",
      check_interval_days: 3,
      next_check_at: offsetIso(2 * DAY),
      last_check_at: offsetIso(-1 * DAY),
      opted_out_at: null,
      created_at: offsetIso(-21 * DAY),
      updated_at: offsetIso(-1 * DAY),
    },
    {
      id: E3,
      display_name: "黃婆婆",
      reference_number: "EL-0003",
      district: "黃大仙 Wong Tai Sin",
      centre: "Wong Tai Sin",
      phone: "+852 5000 0003",
      preferred_language: "yue",
      preferred_call_time: "09:30",
      consent_elder: true,
      consent_contact: true,
      consent_service: true,
      consent_checked_at: offsetIso(-1 * DAY),
      status: "active",
      check_interval_days: 2,
      next_check_at: offsetIso(1 * DAY),
      last_check_at: offsetIso(-1 * DAY),
      opted_out_at: null,
      created_at: offsetIso(-14 * DAY),
      updated_at: offsetIso(-1 * DAY),
    },
    {
      // Draft: consents incomplete, so the activation blocker list is demonstrable.
      id: E4,
      display_name: "張伯",
      reference_number: "EL-0004",
      district: "深水埗 Sham Shui Po",
      centre: "Sham Shui Po",
      phone: "+852 5000 0004",
      preferred_language: "yue",
      preferred_call_time: "11:00",
      consent_elder: false,
      consent_contact: false,
      consent_service: false,
      consent_checked_at: null,
      status: "draft",
      check_interval_days: 2,
      next_check_at: null,
      last_check_at: null,
      opted_out_at: null,
      created_at: offsetIso(-3 * DAY),
      updated_at: offsetIso(-3 * DAY),
    },
    {
      // Carries the pre-seeded open case below, so the escalation chain is
      // visible the moment the dashboard loads.
      id: E5,
      display_name: "周伯",
      reference_number: "EL-0005",
      district: "觀塘 Kwun Tong",
      centre: "Kwun Tong",
      phone: "+852 5000 0005",
      preferred_language: "yue",
      preferred_call_time: "15:00",
      consent_elder: true,
      consent_contact: true,
      consent_service: true,
      consent_checked_at: offsetIso(-6 * 60_000),
      status: "active",
      check_interval_days: 2,
      next_check_at: offsetIso(1 * DAY),
      last_check_at: offsetIso(-1 * DAY),
      opted_out_at: null,
      created_at: offsetIso(-45 * DAY),
      updated_at: offsetIso(-6 * 60_000),
    },
  ];

  const contacts: Row[] = [
    { id: uuid(), elder_id: E1, name: "陳小明", relation: "兒子", phone: "+852 6000 0001", priority: 1 },
    { id: uuid(), elder_id: E1, name: "陳小麗", relation: "女兒", phone: "+852 6000 0002", priority: 2 },
    { id: uuid(), elder_id: E2, name: "李美儀", relation: "女兒", phone: "+852 6000 0003", priority: 1 },
    { id: uuid(), elder_id: E2, name: "李志強", relation: "兒子", phone: "+852 6000 0004", priority: 2 },
    { id: uuid(), elder_id: E3, name: "黃家俊", relation: "兒子", phone: "+852 6000 0005", priority: 1 },
    { id: uuid(), elder_id: E3, name: "黃家欣", relation: "女兒", phone: "+852 6000 0006", priority: 2 },
    { id: uuid(), elder_id: E5, name: "周美玲", relation: "女兒", phone: "+852 6000 0007", priority: 1 },
    { id: uuid(), elder_id: E5, name: "周志明", relation: "兒子", phone: "+852 6000 0008", priority: 2 },
  ];

  // A little history so the elder detail page and the analytics are not empty.
  const history: Array<[string, number]> = [
    [E1, -2 * DAY],
    [E1, -4 * DAY],
    [E1, -6 * DAY],
    [E2, -1 * DAY],
    [E2, -4 * DAY],
    [E3, -1 * DAY],
  ];
  const callJobs: Row[] = history.map(([elderId, offset]) => ({
    id: uuid(),
    elder_id: elderId,
    kind: "scheduled",
    attempt: 1,
    status: "completed",
    outcome: "safe",
    activity_suggestion: "散步 / walk",
    due_at: offsetIso(offset),
    started_at: offsetIso(offset),
    completed_at: offsetIso(offset + 60_000),
    created_at: offsetIso(offset - 60_000),
  }));

  // One open case, mid-chain: contact 1 did not answer, contact 2 is ringing.
  // This makes the escalation chain visible on first load instead of only after
  // a journey is triggered from the test controls.
  const cases: Row[] = [
    {
      id: CASE1,
      elder_id: E5,
      call_job_id: null,
      reason: "worrying",
      severity: 2,
      status: "open",
      note: null,
      version: 2,
      trigger_at: offsetIso(-6 * 60_000),
      // 18 seconds after the trigger — inside the 60-second rule (FR-09).
      escalation_started_at: offsetIso(-6 * 60_000 + 18_000),
      acknowledged_at: null,
      acknowledged_by: null,
      closed_at: null,
      created_at: offsetIso(-6 * 60_000),
    },
  ];

  const escalationSteps: Row[] = [
    {
      id: uuid(), case_id: CASE1, step_order: 1, target: "contact1",
      target_label: "周美玲 (女兒)", status: "no_answer",
      started_at: offsetIso(-6 * 60_000), ended_at: offsetIso(-3.5 * 60_000),
    },
    {
      id: uuid(), case_id: CASE1, step_order: 2, target: "contact2",
      target_label: "周志明 (兒子)", status: "calling",
      started_at: offsetIso(-45_000), ended_at: null,
    },
    {
      id: uuid(), case_id: CASE1, step_order: 3, target: "operator",
      target_label: "Duty operator", status: "pending",
      started_at: null, ended_at: null,
    },
  ];

  return {
    elders,
    contacts,
    call_jobs: callJobs,
    cases,
    escalation_steps: escalationSteps,
    sensor_alerts: [],
    telephony_events: [],
    audit_events: [],
    activities: [
      { id: uuid(), code: "walk", zh: "今日天氣好，可以去附近公園散步十五分鐘。", en: "Nice weather today — try a 15-minute walk in a nearby park.", active: true },
      { id: uuid(), code: "tea", zh: "社區中心今個星期有長者茶聚，歡迎參加。", en: "The community centre has an elders' tea gathering this week.", active: true },
      { id: uuid(), code: "call", zh: "可以打個電話同老朋友傾吓偈。", en: "Why not call an old friend for a chat?", active: true },
      { id: uuid(), code: "stretch", zh: "試吓做五分鐘伸展運動。", en: "Try five minutes of gentle stretching.", active: true },
    ],
    activity_interests: [],
    notifications: [],
    login_attempts: [],
    scheduler_runs: [],
    analytics_events: [],
  };
}
