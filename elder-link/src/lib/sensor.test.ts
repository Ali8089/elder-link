// Tests for the door-sensor edge detector.
//
// The behaviour under test is the difference between a system that calls an
// elder once when their door is left open and one that rings them thirty times
// a minute, so these are written to pin the *count* of triggers, not just the
// shape of a single decision.

import { describe, it, expect } from "vitest";
import {
  decideTrigger,
  initialTriggerState,
  episodeId,
  parseReading,
  type SensorReading,
  type TriggerState,
} from "./sensor";

const DEVICE = "10.129.230.175";

function reading(alarm: boolean, open = alarm): SensorReading {
  return { fsr: alarm ? 40 : 200, open, alarm };
}

/** Replays a sequence of readings, returning every episode id that triggered. */
function replay(sequence: (SensorReading | null)[], startSeconds = 0): string[] {
  const state: TriggerState = initialTriggerState();
  const fired: string[] = [];
  sequence.forEach((r, i) => {
    const now = new Date(Date.UTC(2026, 9, 15, 0, 0, startSeconds + i * 2));
    const d = decideTrigger(state, r, now, DEVICE);
    if (d.action === "trigger") fired.push(d.episodeId);
  });
  return fired;
}

describe("parseReading", () => {
  it("accepts a well-formed reading", () => {
    expect(parseReading({ fsr: 77, open: false, alarm: false })).toEqual({
      fsr: 77,
      open: false,
      alarm: false,
    });
  });

  it("rejects anything that is not a reading", () => {
    // The device is an untrusted LAN endpoint: a half-written response or a
    // different firmware revision must not be coerced into a reading.
    for (const bad of [
      null,
      undefined,
      42,
      "{}",
      [],
      {},
      { fsr: 77 },
      { fsr: "77", open: false, alarm: false },
      { fsr: 77, open: "false", alarm: false },
      { fsr: 77, open: false, alarm: 0 },
      { fsr: Number.NaN, open: false, alarm: false },
      { fsr: Number.POSITIVE_INFINITY, open: false, alarm: false },
    ]) {
      expect(parseReading(bad), `should reject ${JSON.stringify(bad)}`).toBeNull();
    }
  });
});

describe("decideTrigger", () => {
  it("does nothing while the door is closed", () => {
    const state = initialTriggerState();
    const d = decideTrigger(state, reading(false), new Date(), DEVICE);
    expect(d).toEqual({ action: "none", reason: "no-alarm" });
  });

  it("triggers exactly once on the rising edge", () => {
    const state = initialTriggerState();
    const now = new Date(Date.UTC(2026, 9, 15));

    const first = decideTrigger(state, reading(true), now, DEVICE);
    expect(first.action).toBe("trigger");

    const second = decideTrigger(state, reading(true), now, DEVICE);
    expect(second).toEqual({ action: "none", reason: "unchanged-alarm" });
  });

  it("calls once for a sustained alarm, not once per poll", () => {
    // 30 readings at 2s = one minute of the door standing open. The whole
    // point of the edge detector is that this yields ONE call.
    const sustained = Array.from({ length: 30 }, () => reading(true));
    expect(replay(sustained)).toHaveLength(1);
  });

  it("re-arms after the door is closed, so a second episode calls again", () => {
    const fired = replay([
      reading(true),
      reading(true),
      reading(false), // door closed
      reading(false),
      reading(true), // opened again
      reading(true),
    ]);
    expect(fired).toHaveLength(2);
    expect(fired[0]).not.toBe(fired[1]);
  });

  it("treats an unreachable device as unknown, not as a closed door", () => {
    // If a dropped request were read as "closed", a flaky wifi link would
    // re-arm the detector mid-episode and place a duplicate call.
    const fired = replay([reading(true), null, null, reading(true)]);
    expect(fired).toHaveLength(1);
  });

  it("still recovers correctly when the link comes back after an outage", () => {
    const state = initialTriggerState();
    const t0 = new Date(Date.UTC(2026, 9, 15));

    decideTrigger(state, reading(true), t0, DEVICE); // episode 1
    decideTrigger(state, null, t0, DEVICE); // link drops, still alarming
    decideTrigger(state, reading(true), t0, DEVICE); // link returns, still alarming
    expect(state.firedForEpisode).toBe(true);

    decideTrigger(state, reading(false), t0, DEVICE); // door closed
    expect(state.firedForEpisode).toBe(false);
  });

  it("keeps one episode id stable across every poll of that episode", () => {
    // sensor_alerts.external_id is UNIQUE and is what enforces one-call-per-
    // episode in the database, so it must not vary within an episode.
    const state = initialTriggerState();
    const openAt = new Date(Date.UTC(2026, 9, 15, 10, 30, 0));

    const d = decideTrigger(state, reading(true), openAt, DEVICE);
    expect(d.action).toBe("trigger");
    if (d.action !== "trigger") throw new Error("expected a trigger");

    expect(d.episodeId).toBe(episodeId(DEVICE, openAt));
    // Later polls produce no id at all, so nothing new can be inserted.
    const later = decideTrigger(state, reading(true), new Date(Date.UTC(2026, 9, 15, 10, 31)), DEVICE);
    expect(later.action).toBe("none");
  });

  it("scopes episode ids by device so two flats cannot collide", () => {
    const at = new Date(Date.UTC(2026, 9, 15));
    expect(episodeId("10.0.0.1", at)).not.toBe(episodeId("10.0.0.2", at));
  });

  it("never triggers on `open` alone when the firmware has not alarmed", () => {
    // The open flag is informational; the firmware owns the threshold. Acting
    // on `open` would call the elder every time they stepped into the corridor.
    const fired = replay([
      { fsr: 120, open: true, alarm: false },
      { fsr: 120, open: true, alarm: false },
    ]);
    expect(fired).toHaveLength(0);
  });
});
