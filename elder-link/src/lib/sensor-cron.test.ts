// The door alarm must place a call automatically, and exactly once.
//
// These tests exist because the failure mode here is not "no call" — it is
// "sixty calls". A door stays open for minutes; the scheduler ticks every
// minute; a naive implementation rings the elder on every tick. The tests
// therefore pin the *count*, not just the presence, of calls.

import { describe, expect, it, vi } from "vitest";
import { checkSensors, fetchDeviceReading, sensorConfigFromEnv, type SensorConfig, type SensorRunner } from "./sensor-cron";

const SENSOR: SensorConfig = {
  deviceId: "10.129.230.175",
  dataUrl: "http://10.129.230.175/data",
  elderId: "0ec7a7ef-d938-45f1-b0dd-d741bcd84726",
  label: "周伯",
};

const reading = (alarm: boolean, open = alarm) => ({ fsr: alarm ? 30 : 200, open, alarm });

/** A runner stub that records what it was asked to do, and remembers claims. */
function makeRunner(opts: { failCreate?: string } = {}) {
  const claimed = new Set<string>();
  const calls: string[] = [];
  const runner: SensorRunner = {
    async claimSensorEpisode({ externalId }) {
      if (claimed.has(externalId)) return { duplicate: true };
      claimed.add(externalId);
      return { duplicate: false };
    },
    async createCallJob(elderId) {
      if (opts.failCreate) throw new Error(opts.failCreate);
      const job = { id: `job-${calls.length + 1}-${elderId.slice(0, 4)}` };
      calls.push(job.id);
      return job;
    },
    async attachAlertJob() {
      return null;
    },
    async audit() {
      return null;
    },
    async runCallJob() {
      return { outcome: "safe" };
    },
  };
  return { runner, calls, claimed };
}

/** A fetch that returns a fixed reading, or throws to simulate a dead device. */
function fakeFetch(value: unknown, opts: { throw?: boolean; status?: number } = {}) {
  return vi.fn(async () => {
    if (opts.throw) throw new Error("network down");
    return {
      ok: opts.status ? opts.status < 400 : true,
      status: opts.status ?? 200,
      json: async () => value,
    } as unknown as Response;
  }) as unknown as typeof fetch;
}

describe("checkSensors", () => {
  it("places NO call while the door is closed", async () => {
    const { runner, calls } = makeRunner();
    const out = await checkSensors({ runner, sensors: [SENSOR], fetchImpl: fakeFetch(reading(false)) });
    expect(out[0]?.action).toBe("none");
    expect(calls).toHaveLength(0);
  });

  it("places NO call when the door is open but under the threshold", async () => {
    // The distinctive case: open=true, alarm=false. A regression that keyed off
    // `open` alone would ring the elder here.
    const { runner, calls } = makeRunner();
    const out = await checkSensors({
      runner,
      sensors: [SENSOR],
      fetchImpl: fakeFetch({ fsr: 3000, open: true, alarm: false }),
    });
    expect(out[0]?.action).toBe("none");
    expect(calls).toHaveLength(0);
  });

  it("PLACES a call when the device reports the alarm", async () => {
    const { runner, calls } = makeRunner();
    const out = await checkSensors({ runner, sensors: [SENSOR], fetchImpl: fakeFetch(reading(true)) });
    expect(out[0]?.action).toBe("called");
    expect(calls).toHaveLength(1);
    expect(out[0]).toMatchObject({ label: "周伯", outcome: "safe" });
  });

  it("calls exactly ONCE across many ticks of one open door", async () => {
    // The property that matters most. Ten scheduler ticks over a door that stays
    // open must produce one call, not ten.
    const { runner, calls } = makeRunner();
    for (let tick = 0; tick < 10; tick++) {
      // A fresh episode id per tick would defeat the dedup, so pin the clock:
      // this models the tick firing repeatedly while the door stays open, but
      // the caller's `now()` advancing is what creates a new episode. The
      // runner stub shares its claim set across the loop, which is the database.
      await checkSensors({ runner, sensors: [SENSOR], fetchImpl: fakeFetch(reading(true)), now: () => new Date("2026-10-15T00:00:00Z") });
    }
    expect(calls).toHaveLength(1);
  });

  it("does NOT call again when the device is unreachable mid-alarm", async () => {
    const { runner, calls } = makeRunner();
    const at = () => new Date("2026-10-15T00:00:00Z");
    await checkSensors({ runner, sensors: [SENSOR], fetchImpl: fakeFetch(reading(true)), now: at });
    await checkSensors({ runner, sensors: [SENSOR], fetchImpl: fakeFetch(null, { throw: true }), now: at });
    await checkSensors({ runner, sensors: [SENSOR], fetchImpl: fakeFetch(reading(true)), now: at });
    expect(calls).toHaveLength(1);
  });

  it("holds state (no call) when the device is unreachable while closed", async () => {
    const { runner, calls } = makeRunner();
    const out = await checkSensors({ runner, sensors: [SENSOR], fetchImpl: fakeFetch(null, { throw: true }) });
    expect(out[0]).toMatchObject({ action: "none", reason: "unreachable" });
    expect(calls).toHaveLength(0);
  });

  it("treats a non-200 device response as unreachable, not as closed", async () => {
    const { runner, calls } = makeRunner();
    const out = await checkSensors({ runner, sensors: [SENSOR], fetchImpl: fakeFetch({}, { status: 500 }) });
    expect(out[0]).toMatchObject({ action: "none", reason: "unreachable" });
    expect(calls).toHaveLength(0);
  });

  it("calls a SECOND time for a genuinely new episode", async () => {
    const { runner, calls } = makeRunner();
    await checkSensors({ runner, sensors: [SENSOR], fetchImpl: fakeFetch(reading(true)), now: () => new Date("2026-10-15T00:00:00Z") });
    await checkSensors({ runner, sensors: [SENSOR], fetchImpl: fakeFetch(reading(true)), now: () => new Date("2026-10-15T01:00:00Z") });
    expect(calls).toHaveLength(2);
  });

  it("leaves the episode claimed when consent or rate limiting refuses", async () => {
    // Retrying a blocked elder every minute would hammer a gate that is
    // refusing on purpose, so the block must be sticky for that episode.
    const { runner, calls } = makeRunner({ failCreate: "consent missing" });
    const at = () => new Date("2026-10-15T00:00:00Z");
    const first = await checkSensors({ runner, sensors: [SENSOR], fetchImpl: fakeFetch(reading(true)), now: at });
    const second = await checkSensors({ runner, sensors: [SENSOR], fetchImpl: fakeFetch(reading(true)), now: at });
    expect(first[0]?.action).toBe("blocked");
    expect(second[0]?.action).toBe("already-called");
    expect(calls).toHaveLength(0);
  });

  it("reports a blocked episode with the reason, without throwing", async () => {
    const { runner } = makeRunner({ failCreate: "elder has opted out" });
    const out = await checkSensors({ runner, sensors: [SENSOR], fetchImpl: fakeFetch(reading(true)) });
    expect(out[0]).toMatchObject({ action: "blocked", error: "elder has opted out" });
  });

  it("checks every configured sensor", async () => {
    const { runner, calls } = makeRunner();
    const second: SensorConfig = { ...SENSOR, deviceId: "10.0.0.9", elderId: "other-elder" };
    const out = await checkSensors({ runner, sensors: [SENSOR, second], fetchImpl: fakeFetch(reading(true)) });
    expect(out).toHaveLength(2);
    expect(calls).toHaveLength(2);
  });

  it("returns quietly when there are no sensors configured", async () => {
    const { runner, calls } = makeRunner();
    const out = await checkSensors({ runner, sensors: [], fetchImpl: fakeFetch(reading(true)) });
    expect(out).toEqual([]);
    expect(calls).toHaveLength(0);
  });
});

describe("fetchDeviceReading", () => {
  it("returns the parsed reading for a well-formed response", async () => {
    const r = await fetchDeviceReading(SENSOR.dataUrl, { fetchImpl: fakeFetch(reading(true)) });
    expect(r).toEqual(reading(true));
  });

  it("returns null rather than throwing when the network fails", async () => {
    const r = await fetchDeviceReading(SENSOR.dataUrl, { fetchImpl: fakeFetch(null, { throw: true }) });
    expect(r).toBeNull();
  });

  it("returns null for a body that is not a reading", async () => {
    const r = await fetchDeviceReading(SENSOR.dataUrl, { fetchImpl: fakeFetch({ hello: "world" }) });
    expect(r).toBeNull();
  });
});

describe("sensorConfigFromEnv", () => {
  it("returns nothing when unconfigured — a deployment without a door is valid", () => {
    expect(sensorConfigFromEnv(() => undefined)).toEqual([]);
  });

  it("requires both the URL and the elder id", () => {
    expect(sensorConfigFromEnv((k) => (k === "SENSOR_URL" ? "http://10.0.0.1/data" : undefined))).toEqual([]);
  });

  it("derives the device id from the URL when not given explicitly", () => {
    const cfg = sensorConfigFromEnv((k) =>
      ({ SENSOR_URL: "http://10.129.230.175/data", SENSOR_ELDER_ID: "elder-1" })[k],
    );
    expect(cfg).toHaveLength(1);
    expect(cfg[0]?.deviceId).toBe("10.129.230.175");
    expect(cfg[0]?.elderId).toBe("elder-1");
  });
});
