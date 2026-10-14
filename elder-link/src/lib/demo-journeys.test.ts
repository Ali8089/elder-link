// Integration test for local demo mode: the in-memory store + the shared runner
// + the mock telephony provider, exercising the PRD journeys end to end.
//
// This is what `npm run dev` with no Supabase credentials runs in the browser,
// so it doubles as proof that the local demo is not just a rendered shell.
import { beforeEach, describe, expect, it } from "vitest";
import { createDemoClient } from "@/integrations/supabase/demo-client";
import { createRunner } from "@/lib/runner";
import { MockProvider, SAMPLE_ANSWERS } from "@/lib/telephony";
import { CALLS_PER_MINUTE_LIMIT, escalationWithinLimit } from "@/lib/engine";

const STAFF = "00000000-0000-4000-8000-000000000001";

let db: any;
let runner: ReturnType<typeof createRunner>;

beforeEach(() => {
  db = createDemoClient();
  runner = createRunner(db as never, MockProvider);
});

async function elderByName(name: string) {
  const r = await db.from("elders").select("*").eq("status", "active").order("display_name");
  const found = r.data.find((e: any) => e.display_name === name);
  expect(found, `seeded elder ${name}`).toBeTruthy();
  return found;
}

async function openCaseFor(elderId: string) {
  const job = await runner.createCallJob(elderId, "demo");
  await runner.runCallJob(job.id, SAMPLE_ANSWERS.worrying);
  const cases = await db.from("cases").select("*").eq("elder_id", elderId);
  expect(cases.data.length).toBe(1);
  return cases.data[0];
}

describe("demo store", () => {
  it("seeds active elders, contacts and embedded relations", async () => {
    const elders = await db.from("elders").select("id, display_name").eq("status", "active");
    expect(elders.data.length).toBe(4);

    const contacts = await db.from("contacts").select("*").order("priority");
    expect(contacts.data.length).toBe(8);

    // Embedded relations, as used by the cases list.
    const cases = await db.from("cases").select("*, elders(display_name), escalation_steps(*)");
    expect(cases.data.length).toBe(1);
    expect(cases.data[0].elders.display_name).toBe("周伯");
    expect(cases.data[0].escalation_steps.length).toBe(3);
  });

  it("starts with one case mid-chain so the chain is visible on load", async () => {
    const cases = await db.from("cases").select("*, escalation_steps(*)").eq("status", "open").single();
    expect(cases.data.reason).toBe("worrying");
    const steps = cases.data.escalation_steps.sort((a: any, b: any) => a.step_order - b.step_order);
    expect(steps.map((s: any) => s.status)).toEqual(["no_answer", "calling", "pending"]);
    expect(escalationWithinLimit(cases.data.trigger_at, cases.data.escalation_started_at)).toBe(true);
  });

  it("projects only the requested columns", async () => {
    const r = await db.from("elders").select("id, display_name").limit(1);
    expect(Object.keys(r.data[0]).sort()).toEqual(["display_name", "id"]);
  });

  it("errors on .single() when nothing matches", async () => {
    const r = await db.from("elders").select("*").eq("id", "nope").single();
    expect(r.error).toBeTruthy();
    expect(r.data).toBeNull();
  });
});

describe("journey 1 — safe answer", () => {
  it("logs the check-in, offers an activity and schedules the next call", async () => {
    const elder = await elderByName("李伯");
    const before = elder.next_check_at;

    const job = await runner.createCallJob(elder.id, "demo");
    const res = await runner.runCallJob(job.id, SAMPLE_ANSWERS.safe);

    expect(res.outcome).toBe("safe");
    expect(res.step).toBe("log_and_suggest");

    const after = await db.from("elders").select("*").eq("id", elder.id).single();
    expect(after.data.last_check_at).toBeTruthy();
    expect(after.data.next_check_at).not.toBe(before);

    const jobRow = await db.from("call_jobs").select("*").eq("id", job.id).single();
    expect(jobRow.data.status).toBe("completed");
    expect(jobRow.data.activity_suggestion).toContain("/");

    // No case is opened for a safe answer.
    const cases = await db.from("cases").select("id").eq("elder_id", elder.id);
    expect(cases.data).toEqual([]);
  });
});

describe("journey 2 — worrying answer", () => {
  it("opens a case and starts the contact chain on contact 1", async () => {
    const elder = await elderByName("陳婆婆");
    const job = await runner.createCallJob(elder.id, "demo");
    const res = await runner.runCallJob(job.id, SAMPLE_ANSWERS.worrying);

    expect(res.outcome).toBe("worrying");
    expect(res.step).toBe("escalate");

    const cases = await db
      .from("cases")
      .select("*, escalation_steps(*)")
      .eq("elder_id", elder.id)
      .single();

    expect(cases.data.reason).toBe("worrying");
    expect(cases.data.severity).toBe(2);
    expect(cases.data.status).toBe("open");
    expect(cases.data.escalation_steps.length).toBe(3);

    const calling = cases.data.escalation_steps.find((s: any) => s.status === "calling");
    expect(calling.step_order).toBe(1);
    expect(calling.target).toBe("contact1");
    expect(calling.target_label).toContain("陳小明");

    // FR-09: escalation must start within 60 seconds of the trigger.
    expect(escalationWithinLimit(cases.data.trigger_at, cases.data.escalation_started_at)).toBe(true);
  });

  it("marks a danger answer as severity 3", async () => {
    const elder = await elderByName("黃婆婆");
    const job = await runner.createCallJob(elder.id, "demo");
    await runner.runCallJob(job.id, SAMPLE_ANSWERS.danger);
    const cases = await db.from("cases").select("*").eq("elder_id", elder.id).single();
    expect(cases.data.severity).toBe(3);
  });
});

describe("journey 3 — no answer", () => {
  it("retries once, then escalates on the second failure", async () => {
    const elder = await elderByName("李伯");
    const job = await runner.createCallJob(elder.id, "demo");

    const first = await runner.runCallJob(job.id, null);
    expect(first.step).toBe("retry");

    const retries = await db.from("call_jobs").select("*").eq("elder_id", elder.id).eq("kind", "retry");
    expect(retries.data.length).toBe(1);
    expect(retries.data[0].attempt).toBe(2);

    const second = await runner.runCallJob(retries.data[0].id, null);
    expect(second.step).toBe("escalate_after_retry");

    const cases = await db.from("cases").select("*").eq("elder_id", elder.id);
    expect(cases.data.length).toBe(1);
    expect(cases.data[0].reason).toBe("no_answer");
  });
});

describe("journey 4 — sensor alert", () => {
  it("closes the alert safely and informs the designated human (FR-08)", async () => {
    const elder = await elderByName("黃婆婆");
    const job = await runner.createCallJob(elder.id, "sensor");
    await db.from("sensor_alerts").insert({
      elder_id: elder.id,
      external_id: `sim-${Date.now()}`,
      call_job_id: job.id,
    });

    const res = await runner.runCallJob(job.id, SAMPLE_ANSWERS.safe);
    expect(res.step).toBe("log_and_suggest");

    const alert = await db.from("sensor_alerts").select("*").eq("call_job_id", job.id).single();
    expect(alert.data.status).toBe("closed");
    expect(alert.data.safe_note).toBeTruthy();
    expect(alert.data.human_informed_at).toBeTruthy();

    const notes = await db.from("notifications").select("*").eq("elder_id", elder.id);
    expect(notes.data.length).toBe(1);
    expect(notes.data[0].target).toContain("黃家俊");
  });

  it("opens a sensor case when the answer is worrying", async () => {
    const elder = await elderByName("黃婆婆");
    const job = await runner.createCallJob(elder.id, "sensor");
    await db.from("sensor_alerts").insert({
      elder_id: elder.id,
      external_id: `sim-${Date.now()}`,
      call_job_id: job.id,
    });
    await runner.runCallJob(job.id, SAMPLE_ANSWERS.worrying);
    const cases = await db.from("cases").select("*").eq("elder_id", elder.id).single();
    expect(cases.data.reason).toBe("sensor");
  });
});

describe("contact chain", () => {
  it("advances to the next contact on no answer", async () => {
    const elder = await elderByName("陳婆婆");
    const c = await openCaseFor(elder.id);

    await runner.advanceCaseChain(c.id, "no_answer");

    const steps = await db.from("escalation_steps").select("*").eq("case_id", c.id).order("step_order");
    expect(steps.data[0].status).toBe("no_answer");
    expect(steps.data[1].status).toBe("calling");
    expect(steps.data[1].target).toBe("contact2");
    expect(steps.data[2].status).toBe("pending");
  });

  it("stops the chain and skips the remaining contacts when someone answers", async () => {
    const elder = await elderByName("陳婆婆");
    const c = await openCaseFor(elder.id);

    await runner.advanceCaseChain(c.id, "answered");

    const steps = await db.from("escalation_steps").select("*").eq("case_id", c.id).order("step_order");
    expect(steps.data[0].status).toBe("answered");
    expect(steps.data[1].status).toBe("skipped");
    expect(steps.data[2].status).toBe("skipped");
  });

  it("scheduler query excludes steps whose case is closed", async () => {
    const elder = await elderByName("陳婆婆");
    const c = await openCaseFor(elder.id);

    const open = await db
      .from("escalation_steps")
      .select("id, case_id, cases!inner(status)")
      .eq("case_id", c.id)
      .eq("status", "calling")
      .eq("cases.status", "open");
    expect(open.data.length).toBe(1);

    await runner.closeCase(c.id, c.version);

    const afterClose = await db
      .from("escalation_steps")
      .select("id, case_id, cases!inner(status)")
      .eq("case_id", c.id)
      .eq("status", "calling")
      .eq("cases.status", "open");
    expect(afterClose.data.length).toBe(0);
  });
});

describe("case actions", () => {
  it("acknowledges, notes and closes a case", async () => {
    const elder = await elderByName("陳婆婆");
    const c = await openCaseFor(elder.id);

    await runner.acknowledgeCase(c.id, STAFF, c.version);
    let row = await db.from("cases").select("*").eq("id", c.id).single();
    expect(row.data.status).toBe("acknowledged");
    expect(row.data.acknowledged_by).toBe(STAFF);

    await runner.saveCaseNote(c.id, "Called the son, he is on his way.", row.data.version);
    row = await db.from("cases").select("*").eq("id", c.id).single();
    expect(row.data.note).toContain("on his way");

    await runner.closeCase(c.id, row.data.version);
    row = await db.from("cases").select("*").eq("id", c.id).single();
    expect(row.data.status).toBe("closed");
    expect(row.data.closed_at).toBeTruthy();
  });

  it("rejects a stale version (optimistic locking)", async () => {
    const elder = await elderByName("陳婆婆");
    const c = await openCaseFor(elder.id);

    await runner.acknowledgeCase(c.id, STAFF, c.version);
    await expect(runner.acknowledgeCase(c.id, STAFF, c.version)).rejects.toThrow(/changed by someone else/i);
  });

  it("caps the case note at 500 characters", async () => {
    const elder = await elderByName("陳婆婆");
    const c = await openCaseFor(elder.id);
    await runner.saveCaseNote(c.id, "x".repeat(600), c.version);
    const row = await db.from("cases").select("*").eq("id", c.id).single();
    expect(row.data.note.length).toBe(500);
  });
});

describe("guards", () => {
  it("blocks calls for an elder without full consent", async () => {
    const draft = await db.from("elders").select("*").eq("status", "draft").single();
    await expect(runner.createCallJob(draft.data.id, "demo")).rejects.toThrow(/Call blocked/);
  });

  it(`rate limits to ${CALLS_PER_MINUTE_LIMIT} calls per elder per minute`, async () => {
    const elder = await elderByName("陳婆婆");
    for (let i = 0; i < CALLS_PER_MINUTE_LIMIT; i++) {
      await runner.createCallJob(elder.id, "demo");
    }
    await expect(runner.createCallJob(elder.id, "demo")).rejects.toThrow(/Rate limited/);
  });

  it("ignores duplicate telephony event ids (idempotent webhooks)", async () => {
    const elder = await elderByName("陳婆婆");
    const job = await runner.createCallJob(elder.id, "demo");
    const first = await runner.recordTelephonyEvent("evt-dup-1", job.id, "call.completed");
    const second = await runner.recordTelephonyEvent("evt-dup-1", job.id, "call.completed");
    expect(first.duplicate).toBe(false);
    expect(second.duplicate).toBe(true);
  });
});

describe("reschedule and opt-out", () => {
  it("moves the next check when the interval changes (FR-16)", async () => {
    const elder = await elderByName("李伯");
    const next = await runner.rescheduleElder(elder.id, "16:45", 3);
    const row = await db.from("elders").select("*").eq("id", elder.id).single();
    expect(row.data.preferred_call_time).toBe("16:45");
    expect(row.data.check_interval_days).toBe(3);
    expect(row.data.next_check_at).toBe(next);
  });

  it("opts an elder out and clears the schedule", async () => {
    const elder = await elderByName("李伯");
    await runner.optOut(elder.id);
    const row = await db.from("elders").select("*").eq("id", elder.id).single();
    expect(row.data.status).toBe("opted_out");
    expect(row.data.next_check_at).toBeNull();
    expect(row.data.opted_out_at).toBeTruthy();
  });

  it("purges only elders opted out more than 30 days ago (FR-13)", async () => {
    const elder = await elderByName("李伯");
    await runner.optOut(elder.id);
    expect(await runner.purgeOptedOut()).toBe(0);

    const old = new Date(Date.now() - 31 * 24 * 3_600_000).toISOString();
    await db.from("elders").update({ opted_out_at: old }).eq("id", elder.id);
    expect(await runner.purgeOptedOut()).toBe(1);

    const gone = await db.from("elders").select("id").eq("id", elder.id);
    expect(gone.data.length).toBe(0);
  });
});

describe("activity interest (FR-05)", () => {
  it("records the activity the elder is interested in", async () => {
    const elder = await elderByName("黃婆婆");
    await runner.recordActivityInterest(elder.id, "tea");
    const rows = await db.from("activity_interests").select("*").eq("elder_id", elder.id).single();
    expect(rows.data.activity_code).toBe("tea");
    expect(rows.data.source).toBe("staff");
  });
});

describe("audit trail", () => {
  it("records an audit row for every state change", async () => {
    const elder = await elderByName("陳婆婆");
    await openCaseFor(elder.id);
    const audit = await db.from("audit_events").select("*").order("at", { ascending: false });
    const actions = audit.data.map((a: any) => a.action);
    expect(actions).toContain("case.open");
    expect(actions).toContain("call.worrying");
  });
});
