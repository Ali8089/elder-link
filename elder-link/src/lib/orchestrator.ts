// Browser-side orchestrator: binds the shared runner to the signed-in Supabase
// client (anon key + RLS). Real phone calls are placed server-side (see
// src/lib/server/runner.server.ts) so provider secrets never reach the browser.
import { supabase } from "@/integrations/supabase/client";
import { createRunner } from "./runner";
import { MockProvider } from "./telephony";

export const runner = createRunner(supabase as never, MockProvider);

export const audit = runner.audit;
export const assertCallAllowed = runner.assertCallAllowed;
export const createCallJob = runner.createCallJob;
export const recordTelephonyEvent = runner.recordTelephonyEvent;
export const runCallJob = runner.runCallJob;
export const runDueCheckIns = runner.runDueCheckIns;
export const advanceCaseChain = runner.advanceCaseChain;
export const advanceStaleChains = runner.advanceStaleChains;
export const acknowledgeCase = runner.acknowledgeCase;
export const saveCaseNote = runner.saveCaseNote;
export const closeCase = runner.closeCase;
export const optOut = runner.optOut;
export const rescheduleElder = runner.rescheduleElder;
export const recordActivityInterest = runner.recordActivityInterest;

/** Demo call from the dashboard (mock provider — instant, simulated answer). */
export async function demoCall(elderId: string, answer: string | null) {
  const job = await runner.createCallJob(elderId, "demo");
  return runner.runCallJob(job.id, answer);
}

/** Simulated sensor alert from the dashboard (mock provider). */
export async function triggerSensor(elderId: string, answer: string | null) {
  const externalId = `sim-${elderId.slice(0, 8)}-${Date.now()}`;
  const job = await runner.createCallJob(elderId, "sensor");
  await supabase.from("sensor_alerts").insert({ elder_id: elderId, external_id: externalId, call_job_id: job.id });
  await runner.audit("sensor.alert", "sensor_alerts");
  return runner.runCallJob(job.id, answer);
}

/**
 * Real door-sensor trigger, for the browser dashboard.
 *
 * Differs from `triggerSensor` above in that it goes through the same
 * claim-then-call path as the poller's server route, so a dashboard click and a
 * physical door-open are handled identically — one call per episode, consent
 * checked, alert row written, and the safe path closing it via FR-08.
 */
export async function triggerDoorSensor(elderId: string, externalId: string, answer: string | null) {
  const claim = await runner.claimSensorEpisode({ elderId, externalId });
  if (claim.duplicate) return { duplicate: true as const };
  const job = await runner.createCallJob(elderId, "sensor");
  await runner.attachAlertJob(externalId, job.id);
  await runner.audit("sensor.alert", "sensor_alerts");
  const result = await runner.runCallJob(job.id, answer);
  return { duplicate: false as const, ...result };
}

/** The shape a sensor trigger resolves to on success. */
export type SensorTriggerResult = {
  ok: true;
  duplicate: boolean;
  action?: string;
  outcome?: string;
  step?: string;
  [key: string]: unknown;
};

/**
 * Browser-side sensor trigger for the dashboard's "觸發感應器" button.
 *
 * Goes through the authenticated server route (`POST /api/sensors/trigger`) so
 * a dashboard click and a physical door-open share one code path: the episode
 * is claimed first (UNIQUE `external_id` → one call per episode), consent is
 * checked by the runner, the alert row is written against the REAL elder id,
 * and the safe path can close it. The shared sensor secret is never exposed to
 * the browser — only the caregiver's own Supabase access token is sent.
 *
 * Unlike the older `triggerSensor` (which wrote through the browser client with
 * a hardcoded demo elder uuid and let the resulting FK error vanish), this
 * function treats ANY failure as fatal: it throws, so the caller's catch must
 * surface it. A button that does nothing is the bug; silence is the worst
 * outcome.
 *
 * @param elderId    The real elder id from the dashboard's elder list.
 * @param externalId A fresh id per click (one door-open episode).
 * @throws If there is no signed-in session, or the server returns a non-2xx
 *         response, or a `{ ok: false }` body.
 */
export async function triggerSensorViaEndpoint(elderId: string, externalId: string): Promise<SensorTriggerResult> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) {
    throw new Error("Not signed in — sign in again before triggering the sensor");
  }

  let res: Response;
  try {
    res = await fetch("/api/sensors/trigger", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ elderId, externalId }),
    });
  } catch (e) {
    // Network-level failure (offline, server down). Surface it rather than
    // resolving to a falsy value the caller might ignore.
    throw new Error(`Sensor trigger could not reach the server: ${(e as Error).message}`);
  }

  // Parse defensively: a proxy or crash can return a non-JSON body.
  let payload: Record<string, unknown> = {};
  try {
    payload = (await res.json()) as Record<string, unknown>;
  } catch {
    payload = {};
  }

  const reason = typeof payload["error"] === "string" ? (payload["error"] as string) : undefined;

  if (!res.ok) {
    throw new Error(reason ?? `Sensor trigger failed (HTTP ${res.status})`);
  }
  if (payload["ok"] !== true) {
    // A 2xx that still reports failure — the exact class of response the old
    // code discarded silently. Never let this pass.
    throw new Error(reason ?? "Sensor trigger failed (server did not confirm ok)");
  }

  return payload as SensorTriggerResult;
}
