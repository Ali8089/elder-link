import { describe, expect, it } from "vitest";
import {
  activationBlockers,
  advanceChain,
  callBlockers,
  callRateLimited,
  chainStepStale,
  classifyAnswer,
  containsHkid,
  dtmfToAnswer,
  escalationWithinLimit,
  isLocked,
  isOverdue,
  lockUntil,
  maskPhone,
  nextCheckAt,
  nextStepFor,
  nextVersion,
  retryDueAt,
  shouldLockAfterFails,
  CALLS_PER_MINUTE_LIMIT,
  MAX_LOGIN_FAILS,
  type ChainStep,
} from "./engine";

const t0 = new Date("2026-10-01T10:00:00Z");

describe("call outcomes", () => {
  it("safe answer is logged with an activity", () => expect(nextStepFor("safe", 1)).toBe("log_and_suggest"));
  it("worrying, danger and unclear escalate", () => {
    expect(nextStepFor("worrying", 1)).toBe("escalate");
    expect(nextStepFor("danger", 1)).toBe("escalate");
    expect(nextStepFor("unclear", 1)).toBe("escalate");
  });
  it("first no-answer retries, second escalates", () => {
    expect(nextStepFor("no_answer", 1)).toBe("retry");
    expect(nextStepFor("no_answer", 2)).toBe("escalate_after_retry");
  });
  it("classifier maps Cantonese answers", () => {
    expect(classifyAnswer("我幾好")).toBe("safe");
    expect(classifyAnswer("有啲頭暈")).toBe("worrying");
    expect(classifyAnswer("我跌倒咗")).toBe("danger");
    expect(classifyAnswer("")).toBe("no_answer");
  });
  it("no connected human response is never safe", () => {
    expect(classifyAnswer(null)).toBe("no_answer");
    expect(classifyAnswer("   ")).toBe("no_answer");
  });
});

describe("timing", () => {
  it("retry is between 5 and 10 minutes", () => {
    const mins = (retryDueAt(t0).getTime() - t0.getTime()) / 60000;
    expect(mins).toBeGreaterThanOrEqual(5);
    expect(mins).toBeLessThanOrEqual(10);
  });
  it("next check is 2 or 3 days", () => {
    expect(nextCheckAt(t0, 2).toISOString()).toBe("2026-10-03T10:00:00.000Z");
    expect(nextCheckAt(t0, 3).toISOString()).toBe("2026-10-04T10:00:00.000Z");
  });
  it("escalation must start within 60 seconds", () => {
    expect(escalationWithinLimit(t0, new Date(t0.getTime() + 59_000))).toBe(true);
    expect(escalationWithinLimit(t0, new Date(t0.getTime() + 61_000))).toBe(false);
  });
  it("overdue when next check has passed", () => {
    expect(isOverdue("2026-10-01T09:00:00Z", t0)).toBe(true);
    expect(isOverdue("2026-10-01T11:00:00Z", t0)).toBe(false);
  });
});

describe("contact chain", () => {
  const start: ChainStep[] = [
    { target: "contact1", status: "calling" },
    { target: "contact2", status: "pending" },
    { target: "operator", status: "pending" },
  ];
  it("first contact answering skips the rest", () => {
    expect(advanceChain(start, "answered").map((s) => s.status)).toEqual(["answered", "skipped", "skipped"]);
  });
  it("no answer moves to the next contact, then operator", () => {
    const s1 = advanceChain(start, "no_answer");
    expect(s1.map((s) => s.status)).toEqual(["no_answer", "calling", "pending"]);
    expect(advanceChain(s1, "no_answer").map((s) => s.status)).toEqual(["no_answer", "no_answer", "calling"]);
  });
  it("a step ringing longer than 2 minutes is stale", () => {
    expect(chainStepStale(t0.toISOString(), new Date(t0.getTime() + 119_000))).toBe(false);
    expect(chainStepStale(t0.toISOString(), new Date(t0.getTime() + 121_000))).toBe(true);
    expect(chainStepStale(null, t0)).toBe(false);
  });
});

describe("enrolment and privacy", () => {
  const full = {
    display_name: "陳婆婆",
    reference_number: "EL-0001",
    phone: "+852 5000 0001",
    preferred_call_time: "10:00",
    centre: "Sham Shui Po",
    consent_elder: true,
    consent_contact: true,
    consent_service: true,
    contacts: [
      { name: "A", phone: "1" },
      { name: "B", phone: "2" },
    ],
  };
  it("complete record can activate", () => expect(activationBlockers(full)).toEqual([]));
  it("missing consent blocks activation", () =>
    expect(activationBlockers({ ...full, consent_contact: false })).toContain("consent_contact"));
  it("fewer than two contacts blocks activation", () =>
    expect(activationBlockers({ ...full, contacts: [full.contacts[0]!] })).toContain("contacts"));
  it("missing PRD minimum fields block activation", () => {
    expect(activationBlockers({ ...full, reference_number: "" })).toContain("reference");
    expect(activationBlockers({ ...full, preferred_call_time: "" })).toContain("preferredCallTime");
    expect(activationBlockers({ ...full, centre: "" })).toContain("centre");
  });
  it("detects HKID numbers", () => expect(containsHkid("A123456(7)")).toBe(true));
  it("masks phone numbers to last 4 digits", () => expect(maskPhone("+852 5000 0001")).toBe("••••0001"));
});

describe("consent gate before calls", () => {
  const ok = { status: "active", consent_elder: true, consent_contact: true, consent_service: true };
  it("all consents and active status pass", () => expect(callBlockers(ok)).toEqual([]));
  it("inactive elder is blocked", () => expect(callBlockers({ ...ok, status: "draft" })).toContain("status"));
  it("missing consent is blocked", () => expect(callBlockers({ ...ok, consent_elder: false })).toContain("consent_elder"));
});

describe("prototype safeguards", () => {
  it("call creation is limited to 3 per elder per minute", () => {
    expect(callRateLimited(0, CALLS_PER_MINUTE_LIMIT)).toBe(false);
    expect(callRateLimited(2, CALLS_PER_MINUTE_LIMIT)).toBe(false);
    expect(callRateLimited(3, CALLS_PER_MINUTE_LIMIT)).toBe(true);
  });
  it("case version increments for optimistic locking", () => {
    expect(nextVersion(1)).toBe(2);
    expect(nextVersion(null)).toBe(2);
  });
});

describe("login lockout", () => {
  it("locks after 5 failed attempts", () => {
    expect(shouldLockAfterFails(MAX_LOGIN_FAILS - 1)).toBe(false);
    expect(shouldLockAfterFails(MAX_LOGIN_FAILS)).toBe(true);
  });
  it("lock lasts 15 minutes", () => {
    const until = lockUntil(t0);
    expect(until.toISOString()).toBe("2026-10-01T10:15:00.000Z");
    expect(isLocked(until.toISOString(), new Date(t0.getTime() + 60_000))).toBe(true);
    expect(isLocked(until.toISOString(), new Date(t0.getTime() + 16 * 60_000))).toBe(false);
    expect(isLocked(null, t0)).toBe(false);
  });
});

describe("keypad answers", () => {
  it("maps keypad digits to outcomes", () => {
    expect(classifyAnswer(dtmfToAnswer("1"))).toBe("safe");
    expect(classifyAnswer(dtmfToAnswer("2"))).toBe("worrying");
    expect(classifyAnswer(dtmfToAnswer("3"))).toBe("danger");
  });
  it("an unknown or missing digit is no answer, never safe", () => {
    expect(dtmfToAnswer("9")).toBeNull();
    expect(dtmfToAnswer("")).toBeNull();
    expect(dtmfToAnswer(null)).toBeNull();
    expect(classifyAnswer(dtmfToAnswer(null))).toBe("no_answer");
  });
});
