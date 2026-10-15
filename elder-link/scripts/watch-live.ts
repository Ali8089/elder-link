#!/usr/bin/env node
// Watch the real door sensor and show, live, what the app would decide.
//
// Why this exists: when a call does not happen it is hard to tell whether the
// board is quiet, the app is wrong, or the scheduler is not running — three
// completely different problems that all look like "nothing happened". This
// prints the device's own reading next to the app's own edge-detector verdict,
// so the disagreement is visible instead of inferred.
//
// It is READ-ONLY: it never calls anyone and never writes to the database. Run
// it while you open and close the door to see the transition live.
//
// Usage:  npx tsx scripts/watch-live.ts [intervalSeconds]
import { parseReading, decideTrigger, initialTriggerState, doorHeldOpen, type SensorReading } from "../src/lib/sensor";
import { DEVICE_THRESHOLD_SECONDS } from "../src/lib/device-threshold";

const DEVICE_URL = process.env["SENSOR_URL"] ?? "http://10.129.230.175/data";
const INTERVAL_MS = Number(process.argv[2] ?? 2) * 1000;
const DEVICE_ID = process.env["SENSOR_DEVICE_ID"] ?? "esp32-door-01";

const state = initialTriggerState();
let lastLine = "";

const stamp = () => new Date().toTimeString().slice(0, 8);

async function sample() {
  let reading: SensorReading | null = null;
  let raw = "";
  try {
    const res = await fetch(DEVICE_URL, { signal: AbortSignal.timeout(4_000) });
    raw = await res.text();
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    reading = parseReading(JSON.parse(raw));
  } catch (e) {
    const line = `${stamp()}  UNREACHABLE        ${e instanceof Error ? e.message : String(e)}  — holding state`;
    if (line !== lastLine) console.log(line);
    lastLine = line;
    // An unreachable device deliberately preserves the detector state.
    decideTrigger(state, null, new Date(), DEVICE_ID);
    return;
  }

  if (reading === null) {
    console.log(`${stamp()}  UNPARSEABLE  ${raw.slice(0, 60)}`);
    return;
  }

  const decision = decideTrigger(state, reading, new Date(), DEVICE_ID);
  const held = doorHeldOpen(reading) ? "held" : "at-rest";
  const flags = `open=${String(reading.open).padEnd(5)} alarm=${String(reading.alarm).padEnd(5)}`;
  const verdict =
    decision.action === "trigger"
      ? `>>> WOULD CALL NOW  (${decision.episodeId})`
      : decision.reason === "unchanged-alarm"
        ? "already alerted for this episode"
        : decision.reason;

  const line = `${stamp()}  fsr=${String(reading.fsr).padStart(5)} (${held.padEnd(7)})  ${flags}  -> ${verdict}`;
  // Only print on change or on a trigger: at 2s intervals an unchanged line a
  // thousand times buries the one transition that matters.
  if (line !== lastLine || decision.action === "trigger") console.log(line);
  lastLine = line;
}

console.log(`Watching ${DEVICE_URL} every ${INTERVAL_MS / 1000}s`);
console.log(`Firmware alarms after the door has been held open for ${DEVICE_THRESHOLD_SECONDS}s.`);
console.log(`Open and close the door to see the transition. Ctrl-C to stop.\n`);

for (;;) {
  await sample();
  await new Promise((r) => setTimeout(r, INTERVAL_MS));
}
