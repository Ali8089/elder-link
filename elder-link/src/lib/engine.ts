// Elder Link business rules — pure functions, no I/O, so they can be tested with fixed clocks.

export type Outcome = "safe" | "worrying" | "danger" | "unclear" | "no_answer";
export type NextStep = "log_and_suggest" | "escalate" | "retry" | "escalate_after_retry";

export const RETRY_DELAY_MIN = 7; // within the 5–10 minute window
export const ESCALATION_LIMIT_MS = 60_000;

export const ACTIVITIES = [
  { zh: "今日天氣好，可以去附近公園散步十五分鐘。", en: "Nice weather today — try a 15-minute walk in a nearby park." },
  { zh: "社區中心今個星期有長者茶聚，歡迎參加。", en: "The community centre has an elders' tea gathering this week." },
  { zh: "可以打個電話同老朋友傾吓偈。", en: "Why not call an old friend for a chat?" },
  { zh: "試吓做五分鐘伸展運動。", en: "Try five minutes of gentle stretching." },
];

/** Map a call outcome (and attempt number) to the next step. */
export function nextStepFor(outcome: Outcome, attempt: number): NextStep {
  if (outcome === "safe") return "log_and_suggest";
  if (outcome === "no_answer") return attempt <= 1 ? "retry" : "escalate_after_retry";
  return "escalate"; // worrying, danger, unclear
}

/** Classify a spoken/keyed answer into an outcome (mock keyword classifier). */
export function classifyAnswer(answer: string | null | undefined): Outcome {
  if (answer == null || answer.trim() === "") return "no_answer";
  const a = answer.toLowerCase();
  const danger = ["跌倒", "跌親", "救命", "胸口痛", "fell", "fall", "help", "chest pain", "can't breathe"];
  const worry = ["唔舒服", "頭暈", "唔開心", "痛", "unwell", "dizzy", "sad", "pain", "lonely", "寂寞"];
  const safe = ["好", "幾好", "冇事", "ok", "fine", "good", "well"];
  if (danger.some((w) => a.includes(w))) return "danger";
  if (worry.some((w) => a.includes(w))) return "worrying";
  if (safe.some((w) => a.includes(w))) return "safe";
  return "unclear";
}

export function retryDueAt(from: Date): Date {
  return new Date(from.getTime() + RETRY_DELAY_MIN * 60_000);
}

export function nextCheckAt(from: Date, intervalDays: number): Date {
  const d = intervalDays === 3 ? 3 : 2;
  return new Date(from.getTime() + d * 86_400_000);
}

export function isOverdue(nextCheck: string | Date | null | undefined, now: Date): boolean {
  if (!nextCheck) return false;
  return new Date(nextCheck).getTime() < now.getTime();
}

export function escalationWithinLimit(triggerAt: string | Date, startedAt: string | Date | null): boolean {
  if (!startedAt) return false;
  return new Date(startedAt).getTime() - new Date(triggerAt).getTime() <= ESCALATION_LIMIT_MS;
}

export type ActivationInput = {
  display_name: string;
  reference_number?: string;
  phone: string;
  preferred_call_time?: string;
  centre?: string;
  consent_elder: boolean;
  consent_contact: boolean;
  consent_service: boolean;
  contacts: { name: string; phone: string }[];
};

/** Returns missing-field keys; empty array means activation is allowed. */
export function activationBlockers(e: ActivationInput): string[] {
  const missing: string[] = [];
  if (!e.display_name.trim()) missing.push("name");
  if (!(e.reference_number ?? "").trim()) missing.push("reference");
  if (!/^\+?[\d\s-]{8,}$/.test(e.phone.trim())) missing.push("phone");
  if (!(e.preferred_call_time ?? "").trim()) missing.push("preferredCallTime");
  if (!(e.centre ?? "").trim()) missing.push("centre");
  if (!e.consent_elder) missing.push("consent_elder");
  if (!e.consent_contact) missing.push("consent_contact");
  if (!e.consent_service) missing.push("consent_service");
  const valid = e.contacts.filter((c) => c.name.trim() && c.phone.trim());
  if (valid.length < 2) missing.push("contacts");
  return missing;
}

const HKID = /\b[A-Z]{1,2}\d{6}\(?[0-9A]\)?/i;
export function containsHkid(text: string): boolean {
  return HKID.test(text);
}

export function maskPhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 4) return "****";
  return `••••${digits.slice(-4)}`;
}

export type ChainTarget = "contact1" | "contact2" | "operator";
export const CHAIN_ORDER: ChainTarget[] = ["contact1", "contact2", "operator"];

export type ChainStep = { target: ChainTarget; status: "pending" | "calling" | "answered" | "no_answer" | "skipped" };

/** Advance the contact chain after the current calling step returns a result. */
export function advanceChain(steps: ChainStep[], result: "answered" | "no_answer"): ChainStep[] {
  const next = steps.map((s) => ({ ...s }));
  const i = next.findIndex((s) => s.status === "calling");
  if (i === -1) return next;
  next[i]!.status = result;
  if (result === "answered") {
    for (let j = i + 1; j < next.length; j++) next[j]!.status = "skipped";
  } else if (i + 1 < next.length) {
    next[i + 1]!.status = "calling";
  }
  return next;
}

export function pickActivity(seed: number) {
  return ACTIVITIES[Math.abs(seed) % ACTIVITIES.length]!;
}

// ---------------------------------------------------------------------------
// PRD completion helpers (pure functions — easy to test with fixed clocks)
// ---------------------------------------------------------------------------

/** Login lockout: 5 failed attempts per email+IP, then 15 minutes locked. */
export const MAX_LOGIN_FAILS = 5;
export const LOCK_MINUTES = 15;

export function lockUntil(now: Date): Date {
  return new Date(now.getTime() + LOCK_MINUTES * 60_000);
}

export function isLocked(lockedUntil: string | Date | null | undefined, now: Date): boolean {
  if (!lockedUntil) return false;
  return new Date(lockedUntil).getTime() > now.getTime();
}

export function shouldLockAfterFails(fails: number): boolean {
  return fails >= MAX_LOGIN_FAILS;
}

/** Three-party consent must hold at activation AND again before every call. */
export type ConsentInput = {
  status?: string;
  consent_elder: boolean;
  consent_contact: boolean;
  consent_service: boolean;
};

export function callBlockers(e: ConsentInput): string[] {
  const blocked: string[] = [];
  if (e.status && e.status !== "active") blocked.push("status");
  if (!e.consent_elder) blocked.push("consent_elder");
  if (!e.consent_contact) blocked.push("consent_contact");
  if (!e.consent_service) blocked.push("consent_service");
  return blocked;
}

/** Prototype safeguard: at most 3 call jobs created per elder per minute. */
export const CALLS_PER_MINUTE_LIMIT = 3;

export function callRateLimited(recentJobCount: number, limit = CALLS_PER_MINUTE_LIMIT): boolean {
  return recentJobCount >= limit;
}

/** Optimistic locking: bump the case version on every write. */
export function nextVersion(v: number | null | undefined): number {
  return (v ?? 1) + 1;
}

/** A contact still "calling" longer than this is treated as no answer and the chain advances. */
export const CHAIN_RING_TIMEOUT_MIN = 2;

export function chainStepStale(startedAt: string | Date | null | undefined, now: Date): boolean {
  if (!startedAt) return false;
  return now.getTime() - new Date(startedAt).getTime() >= CHAIN_RING_TIMEOUT_MIN * 60_000;
}

/** Analytics categories are pseudonymous — never phone numbers, audio or note text. */
export type AnalyticsCategory =
  | "profile_activation"
  | "check_due"
  | "call_initiated"
  | "call_completed"
  | "retry_scheduled"
  | "sensor_alert"
  | "sensor_safe_closure"
  | "escalation_started"
  | "activity_offered"
  | "activity_interest"
  | "staff_acknowledge"
  | "case_closed"
  | "opt_out"
  | "deletion"
  | "overdue_check"
  | "system_error";

/**
 * Keypad answers (free, instant, no speech recognition needed).
 * 1 = safe, 2 = worrying, 3 = immediate danger.
 * The phrases are then run through the same classifier as spoken answers,
 * so the outcome mapping stays in one place.
 */
export const DTMF_ANSWERS: Record<string, string> = {
  "1": "我幾好，冇事",
  "2": "有啲唔舒服，頭暈",
  "3": "我跌倒咗，救命",
};

/** Maps a keypad digit to a phrase the classifier understands. */
export function dtmfToAnswer(digits: string | null | undefined): string | null {
  if (!digits) return null;
  return DTMF_ANSWERS[digits.trim()] ?? null;
}
