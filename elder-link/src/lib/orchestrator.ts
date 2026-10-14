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
