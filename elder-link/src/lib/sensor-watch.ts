// Door-sensor watcher: polls the ESP32 device and starts a check-in call when
// the door has been left open long enough for the firmware to alarm.
//
// This is the front end of the sensor path. The rest of the machinery already
// existed and is reused unchanged:
//
//   sensor_alerts row  ->  createCallJob(elder, "sensor")  ->  runCallJob
//     ->  applyCallResult  ->  safe: close alert + notify the designated human
//                          ->  worrying/danger: open a case, escalate the chain
//
// Everything here is about the *trigger*: reaching the device, turning its
// readings into a decision (see sensor.ts), and handing an episode to the
// runner exactly once.
//
// Safety properties this file is responsible for:
//
//   * One call per door-open episode, enforced twice — by the edge detector and
//     again by the UNIQUE constraint on sensor_alerts.external_id. A duplicate
//     insert is treated as "already handled", not as an error.
//   * A failed poll never fabricates a closed door; see decideTrigger.
//   * A call is only *created* through createCallJob, which runs the consent and
//     rate-limit gate. This module does not bypass it.

import type { Runner } from "./runner";
import {
  decideTrigger,
  initialTriggerState,
  parseReading,
  type SensorReading,
  type TriggerState,
} from "./sensor";

/** The elder a door sensor belongs to. */
export type SensorTarget = {
  /** Device address, used to scope episode ids. */
  deviceId: string;
  /** URL of the device's JSON endpoint. */
  dataUrl: string;
  /** Elder the sensor is installed for. */
  elderId: string;
  /** Human-readable label, for logs. */
  label: string;
};

export type WatchOutcome =
  | { action: "none"; reason: string }
  | { action: "triggered"; episodeId: string; elderId: string; callJobId?: string | undefined }
  | { action: "suppressed"; episodeId: string; error: string };

/**
 * Fetch one reading from the device.
 *
 * Returns null on any failure — an unreachable device is a normal event for a
 * board on domestic wifi, not an exception. A short timeout matters because the
 * poller runs on an interval: a hung socket must not stall the next attempt.
 */
export async function fetchReading(
  dataUrl: string,
  opts: { timeoutMs?: number } = {},
): Promise<SensorReading | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 4_000);
  try {
    const res = await fetch(dataUrl, { signal: controller.signal });
    if (!res.ok) return null;
    return parseReading(await res.json());
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Polls one or more sensors and starts a call when one alarms.
 *
 * Holds the per-device detector state, so a single instance must be reused
 * across polls. `pollOnce()` is the unit of work — the interval wrapper is
 * deliberately separate so the logic can be tested without timers.
 */
export function createSensorWatcher(deps: {
  runner: Pick<Runner, "createCallJob" | "runCallJob" | "audit">;
  /** The alert insert, injected so the watcher is testable without a database. */
  recordAlert: (input: {
    elderId: string;
    externalId: string;
    callJobId: string | null;
  }) => Promise<{ duplicate: boolean }>;
  targets: SensorTarget[];
  now?: () => Date;
  log?: (message: string) => void;
}) {
  const states = new Map<string, TriggerState>();
  const now = deps.now ?? (() => new Date());
  const log = deps.log ?? (() => {});

  function stateFor(deviceId: string): TriggerState {
    let s = states.get(deviceId);
    if (!s) {
      s = initialTriggerState();
      states.set(deviceId, s);
    }
    return s;
  }

  /** One pass over every configured sensor. */
  async function pollOnce(): Promise<WatchOutcome[]> {
    const outcomes: WatchOutcome[] = [];

    for (const target of deps.targets) {
      const reading = await fetchReading(target.dataUrl);
      const decision = decideTrigger(stateFor(target.deviceId), reading, now(), target.deviceId);

      if (decision.action === "none") {
        outcomes.push({ action: "none", reason: decision.reason });
        continue;
      }

      outcomes.push(...(await trigger(target, decision.episodeId)));
    }

    return outcomes;
  }

  /** Hand one confirmed episode to the runner. */
  async function trigger(target: SensorTarget, episode: string): Promise<WatchOutcome[]> {
    try {
      const job = await deps.runner.createCallJob(target.elderId, "sensor");
      const { duplicate } = await deps.recordAlert({
        elderId: target.elderId,
        externalId: episode,
        callJobId: job.id,
      });

      // The database has the last word on idempotency: if this episode was
      // already recorded (a restart, a double-fire), do not place a second
      // call. The job created above is real, so report it as suppressed rather
      // than silently discarding it.
      if (duplicate) {
        log(`[sensor] episode already handled, not calling again: ${episode}`);
        return [{ action: "suppressed", episodeId: episode, error: "already handled" }];
      }

      await deps.runner.audit("sensor.alert", "sensor_alerts");
      log(`[sensor] ${target.label} door open past threshold — calling ${target.elderId}`);

      // The provider answers asynchronously for a real call; the mock resolves
      // inline. Either way runCallJob owns what happens next.
      await deps.runner.runCallJob(job.id, null);
      return [{ action: "triggered", episodeId: episode, elderId: target.elderId, callJobId: job.id }];
    } catch (e) {
      // Consent missing, rate-limited, or a database error. createCallJob
      // already audited the reason; surface it and keep polling — a sensor
      // that stops watching is worse than one that missed a single alert.
      const error = (e as Error).message;
      log(`[sensor] could not start call for ${target.label}: ${error}`);
      return [{ action: "suppressed", episodeId: episode, error }];
    }
  }

  return { pollOnce, stateFor };
}

export type SensorWatcher = ReturnType<typeof createSensorWatcher>;
