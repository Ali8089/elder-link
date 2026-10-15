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

import { parseReading, doorHeldOpen, type SensorReading } from "./sensor";
import { episodeEnded, resolveEpisodeId, type OpenEpisode } from "./sensor-episode";

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

/**
 * How long the force reading must sit at the closed baseline before the app
 * believes the door is really shut.
 *
 * Needed because the firmware's `open`/`alarm` booleans are not always enough to
 * tell one door-open episode from the next, and the force value alone does not
 * either — a single sample at baseline could be the door settling rather than
 * the door being shut. Both questions come down to "is this door actually still
 * displaced?", which is a question about a *span of time*, not about one instant.
 *
 * So the app samples for this long before concluding. Four seconds is chosen
 * against the two costs: long enough that a door mid-swing or a noisy load cell
 * cannot fake a closure, short enough that a genuine reopen is noticed well
 * inside the firmware's own 15-second threshold. If the device goes away during
 * the window, the window reports "still open" — holding state is always the safe
 * direction, because it can only ever cost a delayed second call, never a
 * spurious one.
 *
 * A window is expressed as *both* a duration and a sample count, and it ends
 * when either is reached. The count is what makes the behaviour deterministic:
 * a duration alone would make the number of samples depend on how fast the
 * network and the event loop happen to be, so the same door could produce a
 * different verdict on a busy host than an idle one.
 */
export const OBSERVATION_WINDOW_MS = 4_000;

/** How often to sample during the observation window. */
export const OBSERVATION_SAMPLE_MS = 500;

/** How many samples a window takes, whichever comes first. */
export const OBSERVATION_SAMPLES = 6;

/**
 * Watch the device for a moment to decide whether the door is still displaced.
 *
 * Returns true when any sample showed the door still held open — that is, the
 * door has *not* demonstrably returned to rest. Returns false only when every
 * sample was readable and all of them sat at the closed baseline, which is a
 * door that has shut.
 *
 * The asymmetry is deliberate and is the whole point of the function: proving a
 * closure requires positive evidence across the whole window, while *not*
 * proving one needs only a single sample. Unreadable samples therefore count as
 * "still open", so an unreachable device can never end an episode.
 */
export async function observeDoorStillDisplaced(
  sensor: SensorConfig,
  opts: {
    fetchImpl?: typeof fetch;
    windowMs?: number;
    sampleMs?: number;
    samples?: number;
    sleep?: (ms: number) => Promise<void>;
    /** Per-request timeout. Kept below the window so one slow read cannot eat it all. */
    requestTimeoutMs?: number;
  } = {},
): Promise<boolean> {
  const windowMs = opts.windowMs ?? OBSERVATION_WINDOW_MS;
  const sampleMs = opts.sampleMs ?? OBSERVATION_SAMPLE_MS;
  const requestedSamples = opts.samples ?? OBSERVATION_SAMPLES;
  const maxSamples = Math.max(1, requestedSamples);
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const requestTimeoutMs = opts.requestTimeoutMs ?? Math.max(1_000, Math.min(3_000, windowMs));

  // In production the window ends on the clock. When a caller pins the sample
  // count explicitly the clock is not consulted at all, so the outcome is
  // reproducible rather than dependent on how fast the host happens to be — a
  // door that shut and reopened must not be judged differently on a busy machine.
  const clockBounded = opts.samples === undefined;
  const deadline = Date.now() + windowMs;

  for (let taken = 0; taken < maxSamples; taken++) {
    const reading = await fetchDeviceReading(sensor.dataUrl, {
      timeoutMs: requestTimeoutMs,
      ...(opts.fetchImpl ? { fetchImpl: opts.fetchImpl } : {}),
    });
    if (reading === null || doorHeldOpen(reading)) return true;
    // The last sample has been taken; stopping here keeps the count exact
    // instead of sleeping once more for nothing.
    if (taken === maxSamples - 1) return false;
    if (clockBounded && Date.now() >= deadline) return false;
    await sleep(sampleMs);
  }
  return false;
}

/** What one check of one sensor decided. Returned for logging and tests. */
export type SensorCheckOutcome =
  | { action: "none"; reason: "no-alarm" | "unreachable"; label: string }
  | { action: "called"; label: string; episodeId: string; callJobId: string; outcome: string }
  | { action: "already-called"; label: string; episodeId: string }
  | { action: "blocked"; label: string; episodeId: string; error: string };

/** A door-open episode as recorded in the database, plus when the door opened. */
export type OpenEpisodeRef = OpenEpisode & {
  /**
   * The onset moment of the episode, read back out of its id.
   *
   * The id is `door:<device>:<iso>` and was written once, on the tick the alarm
   * was first seen — so it is a durable record of when this door-open *began*.
   * Comparing onsets is how the app distinguishes "the same door, still open"
   * from "the door was shut and opened again", without a second column that
   * could drift out of sync with the id it is supposed to describe.
   */
  openedAt: string;
};

/** The narrow slice of the runner this module needs. */
export type SensorRunner = {
  /**
   * The still-open episode for this elder's sensor, if any.
   *
   * This is what makes the check stateless-safe: the open row IS the memory of
   * "we have already called about this door". Without it each tick would mint a
   * new episode id and ring the elder again.
   */
  findOpenSensorEpisode(elderId: string): Promise<OpenEpisodeRef | null>;
  claimSensorEpisode(input: { elderId: string; externalId: string }): Promise<{ duplicate: boolean }>;
  /**
   * Finish a running episode because the door is no longer alarming.
   *
   * Without this the dedup becomes a permanent gag: the next time the same door
   * is left open, the stale open row is found, the claim collides, and no call
   * is made. See the note on `resolveEpisodeId`.
   */
  closeSensorEpisode(input: { elderId: string; externalId: string; endReason: string }): Promise<{ closed: boolean }>;
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
  /** How long to wait for a single device read. */
  timeoutMs?: number;
  /** Observation-window length, injected so tests need not wait in real time. */
  windowMs?: number;
  /** Observation-window sampling interval. */
  sampleMs?: number;
  /** How many samples the observation window takes. */
  samples?: number;
  /** Injected sleep, so tests can make the observation window instantaneous. */
  sleep?: (ms: number) => Promise<void>;
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
      // Either way there is nothing to call about — the device owns that timing.
      //
      // But there is bookkeeping to do: if an episode is still open, the door
      // has now demonstrably come back below the threshold, so that episode is
      // over and must be closed. Leaving it open would make the *next* alarm on
      // this door look like a duplicate and silently suppress the call.
      //
      // This is safe because we have a real reading: `episodeEnded` is only
      // reached here, never on the null (unreachable) path above. A board going
      // quiet must not end an episode, or the next successful read would start a
      // fresh one and ring the elder twice for a single open door.
      const openEpisode = await deps.runner.findOpenSensorEpisode(sensor.elderId);
      if (openEpisode && episodeEnded(reading)) {
        await deps.runner.closeSensorEpisode({
          elderId: sensor.elderId,
          externalId: openEpisode.externalId,
          endReason: reading.open ? "door_open_under_threshold" : "door_closed",
        });
        log(`[sensor] ${sensor.label}: door no longer alarming — episode closed`);
      }
      outcomes.push({ action: "none", reason: "no-alarm", label: sensor.label });
      continue;
    }
    // The door is genuinely alarming. Before deciding it is a NEW episode, ask
    // the database whether one is already open for this sensor. If it is, this
    // reading belongs to it: reuse the id so the claim below collides and no
    // second call is placed. This lookup is what stops a door left open all
    // night from ringing the elder once a minute.
    //
    // The comparison is by *episode*, not by state, which is what makes this
    // safe to run on every tick. `deviceReportedAlarmAt` is when the device's own
    // threshold tripped — the moment this door-open began — not when we happened
    // to look. Two alarms with different onset times are different episodes.
    const deviceReportedAlarmAt = new Date(now().toISOString());
    let openEpisode = await deps.runner.findOpenSensorEpisode(sensor.elderId);

    // Has this door been shut and opened again since we last called about it?
    //
    // The firmware's `open`/`alarm` booleans cannot answer that on their own: a
    // reopen can be fast enough, or the reads far enough apart, that no sample
    // ever lands in between. Every read is then `open: true, alarm: true` and a
    // flags-only detector concludes the door never closed — suppressing a real
    // second call for as long as the stale episode stays open.
    //
    // So the question is re-asked as one about the door rather than the flags:
    // is the door still physically displaced? That is decided by watching the
    // force reading for a moment (see observeDoorStillDisplaced), because the
    // answer is about a span of time. Only a door that demonstrably returned to
    // its closed baseline counts as having shut — anything else, including an
    // unreadable device, keeps the current episode.
    //
    // Being wrong here costs a duplicate call rather than a missed one, and a
    // duplicate is the cheaper mistake: a missed call is an elder sitting behind
    // a door nobody rang about.
    if (openEpisode) {
      const stillDisplaced = await observeDoorStillDisplaced(sensor, {
        ...(deps.fetchImpl ? { fetchImpl: deps.fetchImpl } : {}),
        ...(deps.windowMs !== undefined ? { windowMs: deps.windowMs } : {}),
        ...(deps.sampleMs !== undefined ? { sampleMs: deps.sampleMs } : {}),
        ...(deps.samples !== undefined ? { samples: deps.samples } : {}),
        ...(deps.sleep ? { sleep: deps.sleep } : {}),
      });
      if (!stillDisplaced) {
        await deps.runner.closeSensorEpisode({
          elderId: sensor.elderId,
          externalId: openEpisode.externalId,
          endReason: "door_reopened",
        });
        log(`[sensor] ${sensor.label}: door was shut and reopened — previous episode closed`);
        // The episode is finished; this reading starts the successor. Dropping
        // the reference is what lets the successor's id differ from its
        // predecessor's — if the stale row were still visible here, the new
        // claim would collide with it and be refused, and because external_id is
        // UNIQUE no retry would ever get a call through for that door again.
        openEpisode = null;
      }
    }

    const { externalId: episode, reused } = resolveEpisodeId(sensor.deviceId, {
      openEpisode,
      firstSeenAt: deviceReportedAlarmAt,
    });

    if (reused) {
      outcomes.push({ action: "already-called", label: sensor.label, episodeId: episode });
      continue;
    }

    // The claim is the authority, and it is the *only* authority. The UNIQUE
    // constraint on `sensor_alerts.external_id` is what guarantees one call per
    // episode, so its verdict is final: a duplicate means somebody already owns
    // this episode and no other check — including the lookup above — gets to
    // overrule it. In particular the code must not assume a previously closed
    // episode has been forgotten; if the id comes back as taken, that is the end
    // of the matter, and the elder is not called.
    const claim = await deps.runner.claimSensorEpisode({ elderId: sensor.elderId, externalId: episode });
    if (claim.duplicate) {
      // Two ticks raced and the other won the claim. Let it own the call.
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
