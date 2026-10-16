#!/usr/bin/env node
// Door-sensor poller — the process that actually watches the device.
//
//   node scripts/sensor-poller.mjs                 # poll the configured device
//   node scripts/sensor-poller.mjs --once          # one pass, then exit
//   node scripts/sensor-poller.mjs --interval 2000 # poll every 2s
//   node scripts/sensor-poller.mjs --simulate-alarm  # fake an alarming device
//
// What it does per poll:
//   1. GET the device's /data endpoint.
//   2. Feed the reading to the same edge detector the tests cover
//      (src/lib/sensor.ts, logic mirrored below — see the note).
//   3. On the rising edge of `alarm`, start a sensor-triggered check-in call for
//      the mapped elder through the shared runner.
//
// Why the detector is mirrored here rather than imported:
// this script runs under plain Node with no bundler or TypeScript transform, so
// it cannot import the .ts module. The logic is a deliberate copy of
// decideTrigger(); src/lib/sensor.test.ts is the specification, and
// scripts/verify-sensor.mjs asserts the two agree on a table of cases so the
// copy cannot silently drift.

import { setTimeout as sleep } from "node:timers/promises";
import { readFileSync } from "node:fs";

// Load .env before reading any config.
//
// Without this the script silently used its placeholder defaults — the wrong
// elder id and no trigger URL — so an alarm was detected and then never turned
// into a call, with nothing in the output saying why. Real environment
// variables still win, so `SENSOR_URL=... node scripts/sensor-poller.mjs`
// keeps working.
function loadDotEnv(file = ".env") {
  let text;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    return; // no .env is fine: CI and explicit env vars are both legitimate
  }
  for (const line of text.split(/\r?\n/)) {
    if (!line || line.startsWith("#")) continue;
    const m = /^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    const key = m[1];
    if (process.env[key] !== undefined) continue; // real env wins
    process.env[key] = m[2].trim().replace(/^["']|["']$/g, "");
  }
}
loadDotEnv();

const DEVICE_URL = process.env["SENSOR_URL"] ?? "http://10.129.230.175/data";
const DEVICE_ID = process.env["SENSOR_DEVICE_ID"] ?? "10.129.230.175";
const ELDER_ID = process.env["SENSOR_ELDER_ID"] ?? "55555555-5555-4555-8555-555555555555";
const ELDER_LABEL = process.env["SENSOR_ELDER_LABEL"] ?? "周伯";
const INTERVAL_MS = Number(process.env["SENSOR_POLL_MS"] ?? 2000);
const TIMEOUT_MS = Number(process.env["SENSOR_TIMEOUT_MS"] ?? 4000);
/** Where to POST a confirmed alarm so the app places the call. */
const TRIGGER_URL = process.env["SENSOR_TRIGGER_URL"];
/** The device's web page, which reports its status as text. Derived from SENSOR_URL. */
const PAGE_URL = process.env["SENSOR_PAGE_URL"] ?? DEVICE_URL.replace(/\/data\/?$/, "/");

const args = new Set(process.argv.slice(2));
const once = args.has("--once");
const simulateAlarm = args.has("--simulate-alarm");
/** Take the alarm verdict from the device's own status sentence. */
const usePageText = args.has("--check-page");

const log = (msg) => console.log(`${new Date().toISOString()} ${msg}`);

// ---------------------------------------------------------------------------
// Reading the device's own status text.
//
// The device's web page reports its state as a sentence, not just the JSON
// /data endpoint:
//
//   'ALERT: Door Open > 15s!'  -> the firmware has alarmed
//   'Door Open'                -> open, but not past the threshold yet
//   'Door Closed'              -> closed
//
// Those strings are the firmware's own words, so reading them is the most
// direct possible statement of "what the hardware thinks". This mode exists so
// the trigger condition can be inspected as the device states it, which is what
// you want when checking that the app and the board agree.
//
// The status text lives in a tiny script on the page rendered by the device, so
// we parse it out of the served HTML rather than executing anything.
// ---------------------------------------------------------------------------
const PAGE_ALERT_TEXT = "ALERT: Door Open";
const PAGE_OPEN_TEXT = "Door Open";
const PAGE_CLOSED_TEXT = "Door Closed";

/** Extract the firmware's status sentence from the device's page HTML. */
function parseStatusText(html) {
  // The page sets st.innerText to one of three literals; take the first that
  // appears. Order matters: 'ALERT: Door Open' contains 'Door Open'.
  if (html.includes(PAGE_ALERT_TEXT)) return PAGE_ALERT_TEXT;
  if (html.includes(PAGE_OPEN_TEXT)) return PAGE_OPEN_TEXT;
  if (html.includes(PAGE_CLOSED_TEXT)) return PAGE_CLOSED_TEXT;
  return null;
}

/** True when the firmware's own text says the door is past its threshold. */
function statusSaysAlarm(statusText) {
  return statusText === PAGE_ALERT_TEXT;
}

/**
 * Fetch the device's page and read its status sentence.
 *
 * Returns null when the page could not be read; a caller must not treat that as
 * "door closed".
 */
async function fetchStatusText(pageUrl) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(pageUrl, { signal: controller.signal });
    if (!res.ok) return null;
    return parseStatusText(await res.text());
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// Mirrors decideTrigger() in src/lib/sensor.ts. Keep the two in step; the
// parity check in scripts/verify-sensor.mjs fails if they diverge.
// ---------------------------------------------------------------------------
const state = { firedForEpisode: false, lastWasAlarming: false };

function parseReading(value) {
  if (typeof value !== "object" || value === null) return null;
  const { fsr, open, alarm } = value;
  if (typeof fsr !== "number" || !Number.isFinite(fsr)) return null;
  if (typeof open !== "boolean") return null;
  if (typeof alarm !== "boolean") return null;
  return { fsr, open, alarm };
}

function decideTrigger(reading, now) {
  if (reading === null) return { action: "none", reason: "unreachable" };
  if (!reading.alarm) {
    state.firedForEpisode = false;
    state.lastWasAlarming = false;
    return { action: "none", reason: "no-alarm" };
  }
  if (state.firedForEpisode) {
    state.lastWasAlarming = true;
    return { action: "none", reason: "unchanged-alarm" };
  }
  state.firedForEpisode = true;
  state.lastWasAlarming = true;
  return {
    action: "trigger",
    reason: "alarm-rising",
    episodeId: `door:${DEVICE_ID}:${now.toISOString()}`,
  };
}

async function fetchReading() {
  if (simulateAlarm) return { fsr: 30, open: true, alarm: true };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(DEVICE_URL, { signal: controller.signal });
    if (!res.ok) return null;
    return parseReading(await res.json());
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Start the check-in call for one door-open episode.
 *
 * The call itself is placed by the app, not by this script: the poller POSTs
 * the episode to the app's sensor endpoint, which runs it through
 * createCallJob -> runCallJob, so consent checks, rate limiting, the alert row
 * and the escalation rules all live in the one place that already owns them.
 */
async function startCall(episodeId) {
  if (!TRIGGER_URL) {
    log(`[would call] ${ELDER_LABEL} (${ELDER_ID}) episode=${episodeId}`);
    log("           set SENSOR_TRIGGER_URL to actually place the call");
    return;
  }
  try {
    const res = await fetch(TRIGGER_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(process.env["SENSOR_TRIGGER_SECRET"]
          ? { "x-sensor-secret": process.env["SENSOR_TRIGGER_SECRET"] }
          : {}),
      },
      body: JSON.stringify({ elderId: ELDER_ID, externalId: episodeId }),
    });
    const body = await res.text();
    log(`[triggered] ${ELDER_LABEL} -> ${res.status} ${body.slice(0, 200)}`);
  } catch (e) {
    log(`[trigger failed] ${e.message}`);
  }
}

async function pollOnce() {
  // When --check-page is set, take the verdict from the device's own status
  // sentence instead of the JSON endpoint. Both describe the same firmware
  // state; this path exists to demonstrate that the alarm we act on is the same
  // one the device announces on its page.
  let reading;
  if (usePageText && !simulateAlarm) {
    const statusText = await fetchStatusText(PAGE_URL);
    if (statusText === null) {
      reading = null;
      log("[poll] page unreachable — holding state");
    } else {
      reading = { fsr: -1, open: statusText !== PAGE_CLOSED_TEXT, alarm: statusSaysAlarm(statusText) };
      log(`[page] "${statusText}" -> alarm=${reading.alarm}`);
    }
  } else {
    reading = await fetchReading();
  }
  const decision = decideTrigger(reading, new Date());

  if (reading === null && !usePageText) {
    log(`[poll] unreachable — holding state (doorOpen=${state.lastWasAlarming})`);
  } else if (!usePageText) {
    log(`[poll] fsr=${reading.fsr} open=${reading.open} alarm=${reading.alarm} -> ${decision.reason}`);
  } else if (reading !== null) {
    log(`[poll] -> ${decision.reason}`);
  }

  if (decision.action === "trigger") {
    log(`[alarm] door open past threshold for ${ELDER_LABEL} — starting call`);
    await startCall(decision.episodeId);
  }
  return decision;
}

log(`watching ${simulateAlarm ? "(simulated alarm)" : DEVICE_URL} every ${INTERVAL_MS}ms`);
log(`mapped to ${ELDER_LABEL} (${ELDER_ID})`);
// Print the resolved call target, not just the sensor: a poller that detects an
// alarm but has nowhere to send it looks identical to a working one until the
// moment it silently does nothing.
log(TRIGGER_URL ? `calls will be placed via ${TRIGGER_URL}` : "SENSOR_TRIGGER_URL not set — alarms will NOT place calls");
if (usePageText) log(`reading the device's own status text from ${PAGE_URL}`);

if (once) {
  await pollOnce();
  process.exit(0);
}

// Steady-state loop. A poll must never throw: the outer catch keeps the
// watcher alive across a device reboot, which is a routine event.
for (;;) {
  try {
    await pollOnce();
  } catch (e) {
    log(`[error] ${e.message}`);
  }
  await sleep(INTERVAL_MS);
}
