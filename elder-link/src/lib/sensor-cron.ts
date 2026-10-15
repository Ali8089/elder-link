// Server-side door-sensor check — the part that makes the alarm automatic.
//
// The problem this solves: the ESP32 could detect a door left open and the app
// could read that, but *nothing was watching*. The poller (scripts/sensor-poller.mjs)
// only ran when a person started it, so a door left open at 3am triggered
// nothing until someone happened to be at a keyboard. A check-in system that
// needs a human to be watching is not a check-in system.
//
// So the door is now watched from the server, on the same scheduler tick that
// already runs due check-ins and retries (POST /api/cron/tick, every minute).
// That reuses an existing, already-trusted heartbeat rather than adding a second
// thing to deploy and monitor.
//
// Why the state lives in the database rather than in memory:
// the tick is stateless and serverless — each invocation is a fresh process, and
// there may be several. An in-memory edge detector would forget that it had
// already called and would ring the elder again on the next tick, every minute,
// forever. The `sensor_alerts` row is therefore the memory: `external_id` is the
// episode, and its UNIQUE constraint is what guarantees one call per door-open
// episode across restarts and concurrent ticks.
//
// The episode id is keyed to the moment the door was *first seen alarming*, not
// to the moment we noticed. That matters: if the tick fails for ten minutes
// mid-episode, the episode id is still the same one, so the constraint still
// suppresses the duplicate and the elder is not rung twice for one open door.

import { episodeId, parseReading, type SensorReading } from "./sensor";

/** A watched door sensor and the elder it belongs to. */
export type SensorConfig = {
  /** Device address, used to scope episode ids. */
  deviceId: string;
  /** URL of the device's JSON endpoint. */
  dataUrl: string;
  /** Elder the sensor is installed for. */
  elderId: string;
  /** Human-readable label, for logs. */
  label: string;
};

/**
 * Read the configured sensors from the environment.
 *
 * Deliberately env-driven and single-sensor for now: there is one door in the
 * pilot, and a config file or database table would be inventing structure before
 * there is a second case to shape it. `SENSOR_URL` + `SENSOR_ELDER_ID` is the
 * same pair the poller already uses, so the two paths are configured alike.
 *
 * Returns an empty list when unconfigured, which the tick treats as "no sensors
 * to watch" rather than an error — a deployment without a door sensor is a valid
 * deployment.
 */
export function sensorConfigFromEnv(env: (key: string) => string | undefined): SensorConfig[] {
  const url = env("SENSOR_URL");
  const elderId = env("SENSOR_ELDER_ID");
  if (!url || !elderId) return [];
  return [
    {
      deviceId: env("SENSOR_DEVICE_ID") ?? new URL(url).host,
      dataUrl: url,
      elderId,
      label: env("SENSOR_ELDER_LABEL") ?? elderId,
    },
  ];
}

/**
 * Fetch one reading from a device.
 *
 * Returns null on any failure. A board on domestic wifi being briefly
 * unreachable is routine, not an exception — and critically, a null must never
 * be read as "door closed", or a flaky network would reset the episode and
 * produce a second call.
 */
export async function fetchDeviceReading(
  dataUrl: string,
  opts: { timeoutMs?: number; fetchImpl?: typeof fetch } = {},
): Promise<SensorReading | null> {
  const doFetch = opts.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 4_000);
  try {
    const res = await doFetch(dataUrl, { signal: controller.signal });
    if (!res.ok) return null;
    return parseReading(await res.json());
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** What one check of one sensor decided. Returned for logging and tests. */
export type SensorCheckOutcome =
  | { action: "none"; reason: "no-alarm" | "unreachable"; label: string }
  | { action: "called"; label: string; episodeId: string; callJobId: string; outcome: string }
  | { action: "already-called"; label: string; episodeId: string }
  | { action: "blocked"; label: string; episodeId: string; error: string };

/** The narrow slice of the runner this module needs. */
export type SensorRunner = {
  claimSensorEpisode(input: { elderId: string; externalId: string }): Promise<{ duplicate: boolean }>;
  createCallJob(elderId: string, kind: "sensor"): Promise<{ id: string }>;
  attachAlertJob(externalId: string, jobId: string): Promise<unknown>;
  audit(action: string, entity: string): Promise<unknown>;
  runCallJob(jobId: string, answer: string | null): Promise<{ outcome?: string | null }>;
};

/**
 * Check every configured sensor once, calling the elder where a door is
 * genuinely alarming.
 *
 * The order is the safety property, and it is not arbitrary:
 *
 *   1. Claim the episode FIRST. `sensor_alerts.external_id` is UNIQUE, so this
 *      insert is the mutual-exclusion primitive. Claiming before creating the
 *      job is what stops a duplicate tick from ringing the elder — if we created
 *      the job first, a losing duplicate would still have placed a call.
 *   2. Only then create the job, link it to the alert, and run it.
 *
 * A consent or rate-limit refusal leaves the episode claimed on purpose:
 * retrying a blocked elder every minute would hammer a gate that is refusing
 * for a reason.
 */
export async function checkSensors(deps: {
  runner: SensorRunner;
  sensors: SensorConfig[];
  fetchImpl?: typeof fetch;
  now?: () => Date;
  log?: (message: string) => void;
  /** How long to wait for all sensors. */
  timeoutMs?: number;
}): Promise<SensorCheckOutcome[]> {
  const log = deps.log ?? (() => {});
  const now = deps.now ?? (() => new Date());
  const outcomes: SensorCheckOutcome[] = [];

  for (const sensor of deps.sensors) {
    const reading = await fetchDeviceReading(sensor.dataUrl, {
      ...(deps.timeoutMs !== undefined ? { timeoutMs: deps.timeoutMs } : {}),
      ...(deps.fetchImpl ? { fetchImpl: deps.fetchImpl } : {}),
    });

    if (reading === null) {
      // Hold. Do NOT treat an unreachable device as a closed door: that would
      // re-arm the episode mid-alarm and cause a second call when it returns.
      log(`[sensor] ${sensor.label}: device unreachable, holding`);
      outcomes.push({ action: "none", reason: "unreachable", label: sensor.label });
      continue;
    }

    if (!reading.alarm) {
      // The door is closed, or open but not yet past the firmware's threshold.
      // Either way there is nothing to do — the device owns that timing.
      outcomes.push({ action: "none", reason: "no-alarm", label: sensor.label });
      continue;
    }

    const episode = episodeId(sensor.deviceId, now());
    const claim = await deps.runner.claimSensorEpisode({ elderId: sensor.elderId, externalId: episode });
    if (claim.duplicate) {
      // Already actioned for this open door. Silent by design — this is the
      // expected state on every tick while a door stays open.
      outcomes.push({ action: "already-called", label: sensor.label, episodeId: episode });
      continue;
    }

    try {
      const job = await deps.runner.createCallJob(sensor.elderId, "sensor");
      await deps.runner.attachAlertJob(episode, job.id);
      await deps.runner.audit("sensor.alert", "sensor_alerts");
      log(`[sensor] ${sensor.label}: door open past threshold — calling`);
      const result = await deps.runner.runCallJob(job.id, null);
      outcomes.push({
        action: "called",
        label: sensor.label,
        episodeId: episode,
        callJobId: job.id,
        outcome: result.outcome ?? "unknown",
      });
    } catch (e) {
      const error = (e as Error).message;
      log(`[sensor] ${sensor.label}: could not start call: ${error}`);
      outcomes.push({ action: "blocked", label: sensor.label, episodeId: episode, error });
    }
  }

  return outcomes;
}
