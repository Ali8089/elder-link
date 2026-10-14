// Elder Link runner — one place that owns the workflow rules, so the browser
// dashboard and the server cron use exactly the same logic.
// It takes a database client and a telephony provider, so it can run:
//   - in the browser (staff dashboard, anon key + RLS)
//   - on the server (cron tick, service-role key)
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  advanceChain,
  callBlockers,
  callRateLimited,
  chainStepStale,
  classifyAnswer,
  nextCheckAt,
  nextStepFor,
  nextVersion,
  pickActivity,
  retryDueAt,
  CALLS_PER_MINUTE_LIMIT,
  CHAIN_ORDER,
  type ChainStep,
  type AnalyticsCategory,
} from "./engine";
import { MockProvider, type TelephonyProvider } from "./telephony";

type Row = Record<string, any>;

export function createRunner(db: SupabaseClient<any, any, any>, provider: TelephonyProvider = MockProvider) {
  function check<T>(r: { data: T; error: { message: string } | null }): NonNullable<T> {
    if (r.error) throw new Error(r.error.message);
    return r.data as NonNullable<T>;
  }

  async function logAnalytics(category: AnalyticsCategory, ref?: string) {
    await db.from("analytics_events").insert({ category, ref: ref ?? null });
  }

  async function audit(action: string, entity: string, entityId?: string, actorId?: string | null) {
    await db.from("audit_events").insert({
      actor: actorId ?? null,
      action,
      entity,
      entity_id: entityId ?? null,
    });
  }

  /** Creates a case and starts the contact chain (first contact calling). */
  async function openCase(elderId: string, reason: string, callJobId: string | null, triggerAt: Date) {
    const severity = reason === "danger" ? 3 : 2;
    const c = check(
      await db
        .from("cases")
        .insert({ elder_id: elderId, reason, severity, call_job_id: callJobId, trigger_at: triggerAt.toISOString() })
        .select()
        .single(),
    );
    const contacts = check(await db.from("contacts").select("*").eq("elder_id", elderId).order("priority"));
    const now = new Date().toISOString();
    const steps = CHAIN_ORDER.map((target, i) => {
      const ct = contacts.find((x: Row) => x["priority"] === i + 1);
      return {
        case_id: c.id,
        step_order: i + 1,
        target,
        target_label: ct ? `${ct.name} (${ct.relation})` : "Duty operator",
        status: i === 0 ? "calling" : "pending",
        started_at: i === 0 ? now : null,
      };
    });
    check(await db.from("escalation_steps").insert(steps));
    check(await db.from("cases").update({ escalation_started_at: now, version: nextVersion(c.version) }).eq("id", c.id));
    await audit("case.open", "cases", c.id);
    await logAnalytics("escalation_started", c.id);
    return c;
  }

  /** Records a provider event idempotently (duplicate ids are ignored). */
  async function recordTelephonyEvent(eventId: string, jobId: string, type: string) {
    const r = await db.from("telephony_events").insert({ event_id: eventId, call_job_id: jobId, event_type: type });
    if (r.error && r.error.code === "23505") return { duplicate: true };
    if (r.error) throw new Error(r.error.message);
    return { duplicate: false };
  }

  /** Consent gate + prototype rate limit, checked before any call is created. */
  async function assertCallAllowed(elderId: string) {
    const elder = check(await db.from("elders").select("*").eq("id", elderId).single());
    const blocked = callBlockers(elder);
    if (blocked.length) {
      await audit(`call.blocked:${blocked.join(",")}`, "elders", elderId);
      throw new Error(`Call blocked — missing or inactive: ${blocked.join(", ")}`);
    }
    const since = new Date(Date.now() - 60_000).toISOString();
    const recent = check(await db.from("call_jobs").select("id").eq("elder_id", elderId).gte("created_at", since));
    if (callRateLimited(recent.length, CALLS_PER_MINUTE_LIMIT)) {
      await audit("call.rate_limited", "elders", elderId);
      throw new Error(`Rate limited — max ${CALLS_PER_MINUTE_LIMIT} calls per elder per minute`);
    }
    await db.from("elders").update({ consent_checked_at: new Date().toISOString() }).eq("id", elderId);
    return elder;
  }

  async function createCallJob(elderId: string, kind: "scheduled" | "demo" | "sensor") {
    await assertCallAllowed(elderId);
    return check(await db.from("call_jobs").insert({ elder_id: elderId, kind }).select().single());
  }

  /**
   * Applies a call result to a job: classify the answer, then run the rules
   * (log + activity, retry, or escalate). Used by both the mock provider and
   * the real provider webhook, so the rules live in exactly one place.
   */
  async function applyCallResult(jobId: string, answer: string | null, actorId?: string | null) {
    const job = check(await db.from("call_jobs").select("*, elders(*)").eq("id", jobId).single());
    const elder = job.elders as Row;
    const outcome = classifyAnswer(answer);
    const step = nextStepFor(outcome, job.attempt);
    const done = new Date();
    const activity = step === "log_and_suggest" ? pickActivity(done.getMinutes()) : null;

    check(
      await db
        .from("call_jobs")
        .update({
          status: outcome === "no_answer" ? "no_answer" : "completed",
          outcome,
          completed_at: done.toISOString(),
          activity_suggestion: activity ? `${activity.zh} / ${activity.en}` : null,
        })
        .eq("id", jobId),
    );
    await logAnalytics("call_completed", jobId);

    if (step === "log_and_suggest") {
      check(
        await db
          .from("elders")
          .update({
            last_check_at: done.toISOString(),
            next_check_at: nextCheckAt(done, elder["check_interval_days"]).toISOString(),
          })
          .eq("id", elder["id"]),
      );
      if (job.kind === "sensor") {
        // FR-08: a safe sensor result closes the alert AND informs the designated human.
        check(
          await db
            .from("sensor_alerts")
            .update({
              status: "closed",
              closed_at: done.toISOString(),
              safe_note: "Sensor-triggered call confirmed the elder is safe.",
              human_informed_at: done.toISOString(),
            })
            .eq("call_job_id", jobId),
        );
        await notifyDesignatedContact(elder["id"], null, "Sensor alert closed safely after verification call.");
        await logAnalytics("sensor_safe_closure", elder["id"]);
      }
      await logAnalytics("activity_offered", elder["id"]);
    } else if (step === "retry") {
      check(
        await db.from("call_jobs").insert({
          elder_id: elder["id"],
          kind: "retry",
          attempt: job.attempt + 1,
          due_at: retryDueAt(done).toISOString(),
        }),
      );
      await logAnalytics("retry_scheduled", elder["id"]);
    } else {
      const reason = job.kind === "sensor" && outcome !== "danger" ? "sensor" : outcome;
      await openCase(elder["id"], reason, jobId, done);
    }
    await audit(`call.${outcome}`, "call_jobs", jobId, actorId);
    return { outcome, step };
  }

  /**
   * Places one call job through the provider.
   * - Mock provider: the answer comes back inline, so the result is applied now.
   * - Real provider: the call is placed and the job stays "ringing"; the spoken
   *   answer arrives later at the telephony webhook (see /api/telephony/events).
   */
  async function runCallJob(jobId: string, simulatedAnswer: string | null, actorId?: string | null) {
    const job = check(await db.from("call_jobs").select("*, elders(*)").eq("id", jobId).single());
    const elder = job.elders as Row;
    const started = new Date();
    check(await db.from("call_jobs").update({ status: "ringing", started_at: started.toISOString() }).eq("id", jobId));
    await logAnalytics("call_initiated", jobId);

    const res = await provider.placeCall({ jobId, to: elder["phone"], simulatedAnswer });
    await recordTelephonyEvent(res.eventId, jobId, "call.completed");

    if (!res.placed) {
      // Provider refused the call: leave it queued for a bounded retry and record why.
      check(await db.from("call_jobs").update({ status: "queued" }).eq("id", jobId));
      await audit(`call.provider_error:${res.error ?? "unknown"}`, "call_jobs", jobId, actorId);
      await logAnalytics("system_error", jobId);
      return { outcome: "no_answer" as const, step: "retry" as const, placed: false, error: res.error };
    }

    if (res.answer === null && provider.name !== "mock") {
      return { outcome: null, step: "await_webhook" as const, placed: true };
    }

    const applied = await applyCallResult(jobId, res.answer ?? simulatedAnswer, actorId);
    return { ...applied, placed: true as const, error: undefined };
  }

  /** Records a notification to the designated human (contact 1 by default). */
  async function notifyDesignatedContact(elderId: string, caseId: string | null, detail: string) {
    const contacts = check(await db.from("contacts").select("*").eq("elder_id", elderId).order("priority").limit(1));
    const target = contacts[0] ? `${contacts[0].name} (${contacts[0].relation})` : "Duty operator";
    return check(
      await db
        .from("notifications")
        .insert({ elder_id: elderId, case_id: caseId, target, channel: "phone", status: "sent", detail, sent_at: new Date().toISOString() })
        .select()
        .single(),
    );
  }

  /** Scheduler tick: queue jobs for due active elders, then run due queued jobs. */
  async function runDueCheckIns(simulatedAnswer: string | null, actorId?: string | null) {
    const now = new Date().toISOString();
    const due = check(await db.from("elders").select("id").eq("status", "active").lte("next_check_at", now));
    let created = 0;
    for (const e of due) {
      const pending = check(
        await db.from("call_jobs").select("id").eq("elder_id", e.id).in("status", ["queued", "ringing"]),
      );
      if (pending.length === 0) {
        try {
          await createCallJob(e.id, "scheduled");
          created += 1;
          await logAnalytics("check_due", e.id);
        } catch {
          // Consent or rate limit blocked this elder — already audited.
        }
      }
    }
    const jobs = check(await db.from("call_jobs").select("id").eq("status", "queued").lte("due_at", now));
    let ran = 0;
    for (const j of jobs) {
      const claimed = check(
        await db.from("call_jobs").update({ status: "ringing" }).eq("id", j.id).eq("status", "queued").select("id"),
      );
      if (claimed.length) {
        await runCallJob(j.id, simulatedAnswer, actorId);
        ran += 1;
      }
    }
    return { created, ran };
  }

  /** Advances contact-chain steps that have been ringing longer than the timeout. */
  async function advanceStaleChains() {
    const cutoff = new Date(Date.now() - 2 * 60_000).toISOString();
    const stale = check(
      await db
        .from("escalation_steps")
        .select("id, case_id, started_at, cases!inner(status)")
        .eq("status", "calling")
        .eq("cases.status", "open")
        .lte("started_at", cutoff),
    );
    let advanced = 0;
    for (const s of stale) {
      if (!chainStepStale(s.started_at, new Date())) continue;
      const still = check(await db.from("escalation_steps").select("id").eq("id", s.id).eq("status", "calling"));
      if (still.length) {
        await advanceCaseChain(s.case_id, "no_answer");
        advanced += 1;
      }
    }
    return advanced;
  }

  async function advanceCaseChain(caseId: string, result: "answered" | "no_answer") {
    const rows = check(await db.from("escalation_steps").select("*").eq("case_id", caseId).order("step_order"));
    const next = advanceChain(
      rows.map((r: Row) => ({ target: r["target"], status: r["status"] }) as ChainStep),
      result,
    );
    const now = new Date().toISOString();
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i]!;
      const s = next[i]!;
      if (s.status !== r.status) {
        check(
          await db
            .from("escalation_steps")
            .update({
              status: s.status,
              started_at: s.status === "calling" ? now : r.started_at,
              ended_at: s.status === "calling" ? null : now,
            })
            .eq("id", r.id),
        );
      }
    }
    await audit(`chain.${result}`, "cases", caseId);
    return next;
  }

  /** Case actions use optimistic locking: the caller's version must still match. */
  async function updateCase(caseId: string, expectedVersion: number, patch: Row) {
    const updated = check(
      await db
        .from("cases")
        .update({ ...patch, version: nextVersion(expectedVersion) })
        .eq("id", caseId)
        .eq("version", expectedVersion)
        .select("id"),
    );
    if (updated.length === 0) {
      throw new Error("This case was changed by someone else. Reload and try again.");
    }
    return updated;
  }

  async function acknowledgeCase(caseId: string, userId: string, version = 1) {
    await updateCase(caseId, version, {
      status: "acknowledged",
      acknowledged_at: new Date().toISOString(),
      acknowledged_by: userId,
    });
    await audit("case.acknowledge", "cases", caseId, userId);
    await logAnalytics("staff_acknowledge", caseId);
  }

  async function saveCaseNote(caseId: string, note: string, version = 1) {
    await updateCase(caseId, version, { note: note.slice(0, 500) });
    await audit("case.note", "cases", caseId); // note text deliberately not copied to audit
  }

  async function closeCase(caseId: string, version = 1) {
    await updateCase(caseId, version, { status: "closed", closed_at: new Date().toISOString() });
    await audit("case.close", "cases", caseId);
    await logAnalytics("case_closed", caseId);
  }

  async function optOut(elderId: string) {
    check(
      await db
        .from("elders")
        .update({ status: "opted_out", opted_out_at: new Date().toISOString(), next_check_at: null })
        .eq("id", elderId),
    );
    await audit("elder.opt_out", "elders", elderId);
    await logAnalytics("opt_out", elderId);
  }

  /** FR-16: reschedule — saves the preferred call time / interval and moves the next check. */
  async function rescheduleElder(elderId: string, preferredCallTime: string, intervalDays: number) {
    const elder = check(await db.from("elders").select("*").eq("id", elderId).single());
    const next = elder.status === "active" ? nextCheckAt(new Date(), intervalDays).toISOString() : null;
    check(
      await db
        .from("elders")
        .update({
          preferred_call_time: preferredCallTime,
          check_interval_days: intervalDays,
          next_check_at: next,
          updated_at: new Date().toISOString(),
        })
        .eq("id", elderId),
    );
    await audit("elder.reschedule", "elders", elderId);
    return next;
  }

  /** FR-05: records that the elder showed interest in the offered activity. */
  async function recordActivityInterest(elderId: string, activityCode: string, callJobId?: string | null, source = "staff") {
    check(
      await db
        .from("activity_interests")
        .insert({ elder_id: elderId, activity_code: activityCode, call_job_id: callJobId ?? null, source }),
    );
    await audit("activity.interest", "elders", elderId);
    await logAnalytics("activity_interest", elderId);
  }

  /** FR-13: permanent deletion 30 days after opt-out. */
  async function purgeOptedOut() {
    const { data, error } = await db.rpc("purge_opted_out_elders");
    if (error) throw new Error(error.message);
    const purged = typeof data === "number" ? data : 0;
    if (purged > 0) await logAnalytics("deletion", "elders");
    return purged;
  }

  /** Full scheduler tick used by the cron endpoint. */
  async function tick() {
    const startedAt = new Date();
    const row = check(await db.from("scheduler_runs").insert({ started_at: startedAt.toISOString() }).select().single());
    try {
      const { created, ran } = await runDueCheckIns(null);
      const chains = await advanceStaleChains();
      const purged = await purgeOptedOut();
      check(
        await db
          .from("scheduler_runs")
          .update({
            finished_at: new Date().toISOString(),
            jobs_created: created,
            jobs_run: ran,
            chains_advanced: chains,
            purged,
            ok: true,
          })
          .eq("id", row.id),
      );
      return { ok: true, jobs_created: created, jobs_run: ran, chains_advanced: chains, purged };
    } catch (e) {
      const detail = (e as Error).message;
      check(
        await db
          .from("scheduler_runs")
          .update({ finished_at: new Date().toISOString(), ok: false, detail })
          .eq("id", row.id),
      );
      await logAnalytics("system_error", "tick");
      return { ok: false, error: detail };
    }
  }

  return {
    // jobs & calls
    createCallJob,
    runCallJob,
    applyCallResult,
    runDueCheckIns,
    advanceStaleChains,
    advanceCaseChain,
    recordTelephonyEvent,
    notifyDesignatedContact,
    // case work
    acknowledgeCase,
    saveCaseNote,
    closeCase,
    optOut,
    rescheduleElder,
    recordActivityInterest,
    // maintenance
    purgeOptedOut,
    tick,
    // helpers
    audit,
    logAnalytics,
    assertCallAllowed,
  };
}

export type Runner = ReturnType<typeof createRunner>;
