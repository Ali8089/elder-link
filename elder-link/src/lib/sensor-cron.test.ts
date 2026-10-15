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

/**
 * A reading with a believable force value for the state it describes.
 *
 * The force value is not decoration: `doorHeldOpen` reads it to decide whether
 * the door is still displaced, so a test that gave every alarming reading the
 * same fsr would be testing a device that cannot exist. The values follow the
 * pilot board — ~120 shut, ~30 open-but-under-threshold, ~2400 held open.
 */
const reading = (alarm: boolean, open = alarm) => ({
  fsr: alarm ? 2400 : open ? 30 : 120,
  open,
  alarm,
});


/**
 * A runner stub that records what it was asked to do, and — crucially —
 * remembers claims *and* open episodes, because that pair is what the database
 * provides in production.
 *
 * `openEpisodes` models the `sensor_alerts` rows that are still open. It has to
 * be here rather than in a variable inside the module under test, because the
 * real memory lives in the database precisely so it survives the tick being a
 * fresh process.
 */
function makeRunner(opts: { failCreate?: string } = {}) {
  const claimed = new Set<string>();
  const openEpisodes = new Map<string, string>(); // elderId -> externalId of the open episode
  const closedByApp: Array<{ externalId: string; endReason: string }> = [];
  const calls: string[] = [];
  const runner: SensorRunner = {
    async findOpenSensorEpisode(elderId) {
      const externalId = openEpisodes.get(elderId);
      if (!externalId) return null;
      // The real runner derives the onset by parsing the id, so the stub does the
      // same. Modelling it any other way would let the stub and the production
      // code disagree about which episode a reading belongs to.
      const openedAt = externalId.split(":").slice(2).join(":");
      return { externalId, receivedAt: openedAt, openedAt };
    },
    async claimSensorEpisode({ elderId, externalId }) {
      // Only a *successful* claim opens an episode. A refused claim must not
      // touch the open-episode map: the loser of a race does not own the
      // episode, and writing on the duplicate path would resurrect an episode
      // that a concurrent tick had just finished.
      if (claimed.has(externalId)) return { duplicate: true };
      claimed.add(externalId);
      openEpisodes.set(elderId, externalId);
      return { duplicate: false };
    },
    async closeSensorEpisode({ elderId, externalId, endReason }) {
      if (openEpisodes.get(elderId) !== externalId) return { closed: false };
      openEpisodes.delete(elderId);
      closedByApp.push({ externalId, endReason });
      return { closed: true };
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
  return { runner, calls, claimed, openEpisodes, closedByApp };
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

/**
 * A fetch that serves a *sequence* of readings, one per call, then repeats the
 * last. This is what models a real device being watched over the observation
 * window: the door settling back to baseline after being shut.
 */
function fetchSequence(values: unknown[]) {
  let i = 0;
  return vi.fn(async () => {
    const value = values[Math.min(i, values.length - 1)];
    i += 1;
    return {
      ok: true,
      status: 200,
      json: async () => value,
    } as unknown as Response;
  }) as unknown as typeof fetch;
}

/**
 * The observation window is real wall-clock time in production and irrelevant
 * waiting in a test. It is collapsed here by leaving the duration wide open and
 * capping the *sample count*, which is deterministic: the window then always
 * takes exactly as many samples as the scripted fetch sequence provides, with no
 * dependence on how fast the test host's event loop happens to be.
 */
const NO_WAIT = { windowMs: 60_000, samples: 4, sleep: async () => {} };

describe("checkSensors", () => {
  it("places NO call while the door is closed", async () => {
    const { runner, calls } = makeRunner();
    const out = await checkSensors({ ...NO_WAIT, runner, sensors: [SENSOR], fetchImpl: fakeFetch(reading(false)) });
    expect(out[0]?.action).toBe("none");
    expect(calls).toHaveLength(0);
  });

  it("places NO call when the door is open but under the threshold", async () => {
    // The distinctive case: open=true, alarm=false. A regression that keyed off
    // `open` alone would ring the elder here.
    const { runner, calls } = makeRunner();
    const out = await checkSensors({
      ...NO_WAIT,
      runner,
      sensors: [SENSOR],
      fetchImpl: fakeFetch({ fsr: 3000, open: true, alarm: false }),
    });
    expect(out[0]?.action).toBe("none");
    expect(calls).toHaveLength(0);
  });

  it("PLACES a call when the device reports the alarm", async () => {
    const { runner, calls } = makeRunner();
    const out = await checkSensors({ ...NO_WAIT, runner, sensors: [SENSOR], fetchImpl: fakeFetch(reading(true)) });
    expect(out[0]?.action).toBe("called");
    expect(calls).toHaveLength(1);
    expect(out[0]).toMatchObject({ label: "周伯", outcome: "safe" });
  });

  it("calls exactly ONCE across many ticks of one open door", async () => {
    // The property that matters most, and the one the original bug violated.
    // Ten ticks over a door that stays open must produce one call, not ten.
    //
    // The clock ADVANCES here on purpose. The broken version keyed the episode
    // off `now()`, so a frozen clock would have hidden the bug — the whole
    // failure was that each new minute minted a new episode id. With the open
    // episode remembered, the advancing clock must make no difference.
    const { runner, calls } = makeRunner();
    let minute = 0;
    for (let tick = 0; tick < 10; tick++) {
      const at = () => new Date(Date.UTC(2026, 9, 15, 0, minute++));
      await checkSensors({ ...NO_WAIT, runner, sensors: [SENSOR], fetchImpl: fakeFetch(reading(true)), now: at });
    }
    expect(calls).toHaveLength(1);
  });

  it("calls exactly ONCE even when every tick lands in a different hour", async () => {
    // Fiercer version of the same guard: an hour between looks at the same open
    // door. A naive `now()`-keyed episode would place 24 calls here.
    const { runner, calls } = makeRunner();
    for (let hour = 0; hour < 24; hour++) {
      const at = () => new Date(Date.UTC(2026, 9, 15, hour));
      await checkSensors({ ...NO_WAIT, runner, sensors: [SENSOR], fetchImpl: fakeFetch(reading(true)), now: at });
    }
    expect(calls).toHaveLength(1);
  });

  it("does NOT call again when the device is unreachable mid-alarm", async () => {
    const { runner, calls } = makeRunner();
    const at = () => new Date("2026-10-15T00:00:00Z");
    await checkSensors({ ...NO_WAIT, runner, sensors: [SENSOR], fetchImpl: fakeFetch(reading(true)), now: at });
    await checkSensors({ ...NO_WAIT, runner, sensors: [SENSOR], fetchImpl: fakeFetch(null, { throw: true }), now: at });
    await checkSensors({ ...NO_WAIT, runner, sensors: [SENSOR], fetchImpl: fakeFetch(reading(true)), now: at });
    expect(calls).toHaveLength(1);
  });

  it("holds state (no call) when the device is unreachable while closed", async () => {
    const { runner, calls } = makeRunner();
    const out = await checkSensors({ ...NO_WAIT, runner, sensors: [SENSOR], fetchImpl: fakeFetch(null, { throw: true }) });
    expect(out[0]).toMatchObject({ action: "none", reason: "unreachable" });
    expect(calls).toHaveLength(0);
  });

  it("treats a non-200 device response as unreachable, not as closed", async () => {
    const { runner, calls } = makeRunner();
    const out = await checkSensors({ ...NO_WAIT, runner, sensors: [SENSOR], fetchImpl: fakeFetch({}, { status: 500 }) });
    expect(out[0]).toMatchObject({ action: "none", reason: "unreachable" });
    expect(calls).toHaveLength(0);
  });

  it("calls a SECOND time for a genuinely new episode", async () => {
    // The dedup must not be so eager that it swallows a real second alarm. A
    // second alarm only counts as new if the first episode was closed — which
    // the app does when it sees the door stop alarming. This walks that whole
    // cycle through checkSensors rather than poking the stub, because "the app
    // closes episodes" is exactly the behaviour under test.
    const { runner, calls } = makeRunner();
    const at = (min: number) => () => new Date(Date.UTC(2026, 9, 15, 0, min));
    await checkSensors({ ...NO_WAIT, runner, sensors: [SENSOR], fetchImpl: fakeFetch(reading(true)), now: at(0) });
    await checkSensors({ ...NO_WAIT, runner, sensors: [SENSOR], fetchImpl: fakeFetch(reading(false)), now: at(1) }); // door shuts
    await checkSensors({ ...NO_WAIT, runner, sensors: [SENSOR], fetchImpl: fakeFetch(reading(true)), now: at(2) });
    expect(calls).toHaveLength(2);
  });

  it("STILL calls when the door closes and reopens within the same second", async () => {
    // The nastiest version, and the one that would silence an elder forever.
    // The episode id is the door-open timestamp, so two alarms a second apart
    // mint the *same* id. If the stale open row were not finished before the
    // successor claims, the claim would collide with the predecessor's row —
    // and because `external_id` is UNIQUE, no amount of retrying would ever get
    // a call through for that door again.
    //
    // The device is served as a *sequence* because that is what a real board
    // does: the third tick's top-level read still shows the alarm, and only the
    // observation window can reveal that the door came back to baseline in
    // between. A fixed-value fetch cannot express a door that closed and
    // reopened, which is exactly why the original bug hid for so long.
    //
    // The close and the reopen share one second — tick 2 and tick 3 both run at
    // second 1 — but that second is *later* than the original alarm, which is
    // what makes the successor a genuinely new episode. (Pinning every tick to
    // the original second is the collision case, and is covered by the
    // "does not place a third call" test below.) The scripted fetch must supply
    // the initial read's value FIRST: `checkSensors` reads the device once at the
    // top of the loop before it ever considers the observation window, so the
    // window's samples are the *remaining* entries.
    const { runner, calls, closedByApp } = makeRunner();
    const at = (s: number) => () => new Date(Date.UTC(2026, 9, 15, 0, 0, s));
    await checkSensors({ ...NO_WAIT, runner, sensors: [SENSOR], fetchImpl: fakeFetch(reading(true)), now: at(0) });
    await checkSensors({ ...NO_WAIT, runner, sensors: [SENSOR], fetchImpl: fakeFetch(reading(false)), now: at(1) }); // door shuts
    const second = await checkSensors({
      ...NO_WAIT,
      runner,
      sensors: [SENSOR],
      // Initial read (alarm), then the observation window sees only the closed
      // baseline — which is what proves the door shut rather than being held.
      fetchImpl: fetchSequence([reading(true), reading(false)]),
      now: at(1),
    });
    expect(second[0]?.action).toBe("called");
    expect(calls).toHaveLength(2);
    expect(closedByApp).toHaveLength(1);
  });

  it("does NOT suppress a successor when the door never reads as closed at all", async () => {
    // The door is slammed and pushed open again between two ticks, so every
    // top-level read says `open: true, alarm: true` and the flags alone would
    // insist the door never closed. The observation window is what sees the
    // closure: every sample it takes is back at the closed baseline, which is
    // the only positive evidence that ends an episode. (A window that *ended*
    // displaced would return "still open" and hold state on purpose, so the
    // fixture must not script a held-open sample inside it.)
    //
    // The scripted fetch supplies the top-of-loop read first — that read is the
    // one that keeps the flags alarming — and the window then sees the baseline.
    const { runner, calls } = makeRunner();
    const at = (s: number) => () => new Date(Date.UTC(2026, 9, 15, 0, 0, s));
    await checkSensors({ ...NO_WAIT, runner, sensors: [SENSOR], fetchImpl: fakeFetch(reading(true)), now: at(1) });
    const second = await checkSensors({
      ...NO_WAIT,
      runner,
      sensors: [SENSOR],
      fetchImpl: fetchSequence([reading(true), reading(false)]),
      now: at(9),
    });
    expect(second[0]?.action).toBe("called");
    expect(calls).toHaveLength(2);
  });

  it("closes the episode when the door stops alarming, so the next alarm is not silenced", async () => {
    // The failure this guards against is the worst kind: the dedup turning into
    // a permanent gag. If the episode were left open, the door being left open
    // tomorrow would look like a duplicate of today's and no call would ever be
    // made again.
    const { runner, calls, closedByApp } = makeRunner();
    const at = () => new Date("2026-10-15T00:00:00Z");
    await checkSensors({ ...NO_WAIT, runner, sensors: [SENSOR], fetchImpl: fakeFetch(reading(true)), now: at });
    await checkSensors({ ...NO_WAIT, runner, sensors: [SENSOR], fetchImpl: fakeFetch(reading(false)), now: at });
    expect(closedByApp).toHaveLength(1);
    expect(closedByApp[0]?.endReason).toBe("door_closed");
    await checkSensors({ ...NO_WAIT, runner, sensors: [SENSOR], fetchImpl: fakeFetch(reading(true)), now: at });
    expect(calls).toHaveLength(1);
  });

  it("does not place a third call when the door is reopened by the observation window", async () => {
    // The observation window legitimately ends an episode, but the episode id is
    // still derived from the same second — so the successor collides with its
    // predecessor. That is correct and safe: the elder has already been called
    // about this door-open, and ringing again adds no information. What must not
    // happen is the app *claiming* a call it did not make.
    const { runner, calls } = makeRunner();
    const at = () => new Date("2026-10-15T00:00:00Z");
    const first = await checkSensors({ ...NO_WAIT, runner, sensors: [SENSOR], fetchImpl: fakeFetch(reading(true)), now: at });
    const second = await checkSensors({
      ...NO_WAIT,
      runner,
      sensors: [SENSOR],
      // The initial read must still be alarming (we are in the alarm branch for
      // this tick); the observation window then sees only the baseline, so it
      // ends the episode with `door_reopened`. The successor then mints the same
      // second-derived id and collides — no third call.
      fetchImpl: fetchSequence([reading(true), reading(false)]),
      now: at,
    });
    expect(first[0]?.action).toBe("called");
    expect(second[0]?.action).toBe("already-called");
    expect(calls).toHaveLength(1);
  });

  it("records WHY the episode ended, distinguishing a shut door from one under threshold", async () => {
    const reasons: string[] = [];
    const { runner } = makeRunner();
    const spy: SensorRunner = {
      ...runner,
      async closeSensorEpisode(input) {
        reasons.push(input.endReason);
        return runner.closeSensorEpisode(input);
      },
    };
    const at = () => new Date("2026-10-15T00:00:00Z");
    // Open the episode, then end it with the door still ajar but under 15s.
    await checkSensors({ ...NO_WAIT, runner: spy, sensors: [SENSOR], fetchImpl: fakeFetch(reading(true)), now: at });
    await checkSensors({ ...NO_WAIT, runner: spy, sensors: [SENSOR], fetchImpl: fakeFetch({ fsr: 2400, open: true, alarm: false }), now: at });
    expect(reasons).toEqual(["door_open_under_threshold"]);
  });

  it("does NOT close the episode when the device is unreachable", async () => {
    // Unreachable is not "closed". Ending the episode here would make the next
    // successful reading start a new one and ring the elder a second time for
    // one open door — the flaky-wifi double call.
    const { runner, calls, closedByApp } = makeRunner();
    const at = () => new Date("2026-10-15T00:00:00Z");
    await checkSensors({ ...NO_WAIT, runner, sensors: [SENSOR], fetchImpl: fakeFetch(reading(true)), now: at });
    await checkSensors({ ...NO_WAIT, runner, sensors: [SENSOR], fetchImpl: fakeFetch(null, { throw: true }), now: at });
    expect(closedByApp).toHaveLength(0);
    await checkSensors({ ...NO_WAIT, runner, sensors: [SENSOR], fetchImpl: fakeFetch(reading(true)), now: at });
    expect(calls).toHaveLength(1);
  });

  it("does nothing when a closed door has no episode to close", async () => {
    const { runner, calls, closedByApp } = makeRunner();
    const out = await checkSensors({ ...NO_WAIT, runner, sensors: [SENSOR], fetchImpl: fakeFetch(reading(false)) });
    expect(out[0]?.action).toBe("none");
    expect(closedByApp).toHaveLength(0);
    expect(calls).toHaveLength(0);
  });

  it("leaves the episode claimed when consent or rate limiting refuses", async () => {
    // Retrying a blocked elder every minute would hammer a gate that is
    // refusing on purpose, so the block must be sticky for that episode.
    const { runner, calls } = makeRunner({ failCreate: "consent missing" });
    const at = () => new Date("2026-10-15T00:00:00Z");
    const first = await checkSensors({ ...NO_WAIT, runner, sensors: [SENSOR], fetchImpl: fakeFetch(reading(true)), now: at });
    const second = await checkSensors({ ...NO_WAIT, runner, sensors: [SENSOR], fetchImpl: fakeFetch(reading(true)), now: at });
    expect(first[0]?.action).toBe("blocked");
    expect(second[0]?.action).toBe("already-called");
    expect(calls).toHaveLength(0);
  });

  it("reports a blocked episode with the reason, without throwing", async () => {
    const { runner } = makeRunner({ failCreate: "elder has opted out" });
    const out = await checkSensors({ ...NO_WAIT, runner, sensors: [SENSOR], fetchImpl: fakeFetch(reading(true)) });
    expect(out[0]).toMatchObject({ action: "blocked", error: "elder has opted out" });
  });

  it("checks every configured sensor", async () => {
    const { runner, calls } = makeRunner();
    const second: SensorConfig = { ...SENSOR, deviceId: "10.0.0.9", elderId: "other-elder" };
    const out = await checkSensors({ ...NO_WAIT, runner, sensors: [SENSOR, second], fetchImpl: fakeFetch(reading(true)) });
    expect(out).toHaveLength(2);
    expect(calls).toHaveLength(2);
  });

  it("keeps each elder's episode separate — one flat's door cannot suppress another's", async () => {
    const { runner, calls } = makeRunner();
    const second: SensorConfig = { ...SENSOR, deviceId: "10.0.0.9", elderId: "other-elder" };
    const at = () => new Date("2026-10-15T00:00:00Z");
    await checkSensors({ ...NO_WAIT, runner, sensors: [SENSOR, second], fetchImpl: fakeFetch(reading(true)), now: at });
    await checkSensors({ ...NO_WAIT, runner, sensors: [SENSOR, second], fetchImpl: fakeFetch(reading(true)), now: at });
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
