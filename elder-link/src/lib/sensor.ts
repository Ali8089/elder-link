// Door-sensor trigger for Elder Link.
//
// A physical ESP32-S3 force-sensor on the elder's door serves a tiny JSON
// endpoint:
//
//   GET http://<device>/data  ->  { "fsr": 77, "open": false, "alarm": false }
//
// The firmware raises `alarm` once the door has been held open past its own
// threshold. That threshold belongs to the device and is not something this app
// sets or enforces — see device-threshold.ts for the value currently flashed and
// why the app does not impose one of its own. This module turns the device's
// signal into an Elder Link call job, so a door left standing open is a *second*
// way a check-in call gets started, alongside the scheduled daily call.
//
// Why this is a separate module from the poller (sensor-watch.ts):
// everything here is a pure function of (previous state, current reading). That
// makes the edge-detection — the part that is easy to get wrong and expensive to
// get wrong, because getting it wrong means either a missed alert or a phone
// call every 2 seconds — testable without a device, a clock, or a network.
//
// Design notes that matter:
//
//   * An alarm is an EDGE, not a level. `alarm` stays true for as long as the
//     door is open, and the poller runs every 2 s, so a naive "if alarm then
//     call" would place ~30 calls a minute. We fire once when the reading
//     transitions into the alarming state, and only re-arm after the door has
//     been seen closed again.
//
//   * A transient fetch failure must not be read as "door closed". If it were,
//     a flaky wifi link would reset the edge detector mid-alarm and produce a
//     second call. Unreachable readings preserve the previous state.

/** One reading from the door sensor. */
export type SensorReading = {
  /** Raw force-sensitive-resistor value; the firmware's own units. */
  fsr: number;
  /** True while the door is held open. */
  open: boolean;
  /** True once the firmware's threshold has elapsed. */
  alarm: boolean;
};

/** Why a poller decided to (or not to) act. Returned for logging/tests. */
export type TriggerDecision =
  | { action: "none"; reason: "no-alarm" | "unchanged-alarm" | "unreachable" }
  | { action: "trigger"; reason: "alarm-rising"; episodeId: string };

/** The edge-detector's memory. */
export type TriggerState = {
  /**
   * True once we have raised an alert for the current door-open episode.
   * Reset only when the door is positively observed closed again.
   */
  firedForEpisode: boolean;
  /** True if the last *successful* reading was alarming. */
  lastWasAlarming: boolean;
};

export function initialTriggerState(): TriggerState {
  return { firedForEpisode: false, lastWasAlarming: false };
}

/**
 * Validate an arbitrary parsed JSON value as a SensorReading.
 *
 * The device is a small embedded board on the LAN and its response is not a
 * trusted input shape: a half-written response, a captive portal, or a different
 * firmware revision could all return valid JSON that is not a reading. Treat
 * anything unexpected as unusable rather than coercing it.
 */
export function parseReading(value: unknown): SensorReading | null {
  if (typeof value !== "object" || value === null) return null;
  const v = value as Record<string, unknown>;
  const { fsr, open, alarm } = v;
  if (typeof fsr !== "number" || !Number.isFinite(fsr)) return null;
  if (typeof open !== "boolean") return null;
  if (typeof alarm !== "boolean") return null;
  return { fsr, open, alarm };
}

/**
 * A stable id for one door-open episode.
 *
 * `sensor_alerts.external_id` is UNIQUE and this is the value that enforces
 * "one call per episode" at the database level, so it must be identical for
 * every poll within a single episode and different between episodes. The
 * episode is keyed off the moment the alarm was first seen; `observedAt` is
 * passed in rather than read from the clock so this stays pure.
 *
 * `deviceId` scopes it so two flats' sensors can never collide.
 */
export function episodeId(deviceId: string, observedAt: Date): string {
  return `door:${deviceId}:${observedAt.toISOString()}`;
}

/**
 * Decide what to do about one reading.
 *
 * @param state  Mutable detector state; updated in place on a successful read.
 * @param reading The reading, or null when the device could not be reached.
 * @param now    Observation time, injected for testability.
 * @param deviceId Identifies the physical device, for the episode id.
 */
export function decideTrigger(
  state: TriggerState,
  reading: SensorReading | null,
  now: Date,
  deviceId: string,
): TriggerDecision {
  // Unreachable: keep the previous state exactly as it was. Treating a dropped
  // request as "not alarming" would reset the detector mid-episode and cause a
  // duplicate call when the device came back.
  if (reading === null) return { action: "none", reason: "unreachable" };

  const alarming = reading.alarm;

  // The door was positively seen closed: re-arm for the next episode.
  if (!alarming) {
    state.firedForEpisode = false;
    state.lastWasAlarming = false;
    return { action: "none", reason: "no-alarm" };
  }

  // Already alarming and already actioned: nothing further for this episode.
  if (state.firedForEpisode) {
    state.lastWasAlarming = true;
    return { action: "none", reason: "unchanged-alarm" };
  }

  // The rising edge — the one moment a call is warranted.
  state.firedForEpisode = true;
  state.lastWasAlarming = true;
  return { action: "trigger", reason: "alarm-rising", episodeId: episodeId(deviceId, now) };
}
