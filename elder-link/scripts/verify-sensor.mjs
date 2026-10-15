#!/usr/bin/env node
// Parity check: the poller's edge detector must agree with the tested one.
//
// scripts/sensor-poller.mjs runs under plain Node and cannot import the
// TypeScript module, so it carries a copy of decideTrigger(). A copy that
// silently drifts is exactly the kind of bug that shows up as a duplicate phone
// call at 3am, so this script replays the same scenario table through both
// implementations and fails if they ever disagree.
//
//   node scripts/verify-sensor.mjs
//
// Exit code 0 = identical, 1 = divergence (with the differing case printed).

// --- implementation A: the copy inside the poller --------------------------
function makePollerDetector(deviceId) {
  const state = { firedForEpisode: false, lastWasAlarming: false };
  return function decide(reading, now) {
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
      episodeId: `door:${deviceId}:${now.toISOString()}`,
    };
  };
}

// --- implementation B: the TS module, compiled with esbuild ----------------
// A hand-rolled regex "type stripper" was tried first and broke on the first
// interface it met. esbuild is already a dependency (Vite uses it), so use its
// JS API rather than shelling out — the CLI shim is a .cmd on Windows and spawn
// semantics differ per platform.
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(here, "..");
const sensorTs = join(projectRoot, "src", "lib", "sensor.ts");

let implementB;
let tempDir;
try {
  // esbuild is CJS; load it through require so `.default` handling is explicit.
  const require = createRequire(import.meta.url);
  const esbuild = require(join(projectRoot, "node_modules", "esbuild"));
  const result = await esbuild.build({
    entryPoints: [sensorTs],
    format: "esm",
    platform: "node",
    bundle: false,
    write: false,
  });
  const out = result.outputFiles?.[0];
  if (!out) throw new Error("esbuild produced no output");
  tempDir = mkdtempSync(join(tmpdir(), "sensor-parity-"));
  const outFile = join(tempDir, "sensor.mjs");
  writeFileSync(outFile, out.text);
  const mod = await import(pathToFileURL(outFile).href);
  implementB = (deviceId) => {
    const state = mod.initialTriggerState();
    return (reading, now) => mod.decideTrigger(state, reading, now, deviceId);
  };
} catch (e) {
  console.error(`FAILED to load/compile src/lib/sensor.ts (${e.message})`);
  console.error("The parity check cannot run, which is itself a failure.");
  process.exit(1);
} finally {
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
}

// --- the scenario table ----------------------------------------------------
const DEVICE = "10.129.230.175";
const R = (alarm) => ({ fsr: alarm ? 30 : 200, open: alarm, alarm });

// The device distinguishes three states, and the middle one is the easily-missed
// case: a door held open but NOT yet past the firmware's threshold. The JSON
// endpoint reports it as `alarm:false`; the page reports 'Door Open'. Neither
// may trigger a call, and a regression that fired on `open` alone would show up
// here. O = open but not alarmed.
const O = { fsr: 30, open: true, alarm: false };

const SCENARIOS = [
  { name: "closed, then stays closed", seq: [R(false), R(false), R(false)] },
  { name: "single sustained alarm", seq: [R(true), R(true), R(true), R(true)] },
  { name: "alarm, close, alarm again", seq: [R(true), R(false), R(true)] },
  { name: "unreachable mid-alarm", seq: [R(true), null, null, R(true)] },
  { name: "unreachable while closed", seq: [null, null] },
  { name: "unreachable between episodes", seq: [R(true), R(false), null, R(true)] },
  { name: "flapping door", seq: [R(true), R(false), R(true), R(false), R(true)] },
  { name: "open but under threshold never triggers", seq: [O, O, O, O] },
  { name: "open under threshold, then crosses it", seq: [O, O, R(true), R(true)] },
  { name: "crosses threshold, closes, crosses again", seq: [O, R(true), R(false), O, R(true)] },
  { name: "unreachable while open under threshold", seq: [R(false), O, null, null, O] },
];

let failures = 0;
for (const scenario of SCENARIOS) {
  const a = makePollerDetector(DEVICE);
  const b = implementB(DEVICE);

  scenario.seq.forEach((reading, i) => {
    const now = new Date(Date.UTC(2026, 9, 15, 0, 0, i * 2));
    const ra = a(reading, now);
    const rb = b(reading, now);
    const sa = JSON.stringify(ra);
    const sb = JSON.stringify(rb);
    if (sa !== sb) {
      failures += 1;
      console.error(`DIVERGENCE in "${scenario.name}" at step ${i}`);
      console.error(`  poller copy : ${sa}`);
      console.error(`  sensor.ts   : ${sb}`);
    }
  });
}

if (failures === 0) {
  console.log(`OK — poller copy matches src/lib/sensor.ts across ${SCENARIOS.length} scenarios`);
  process.exit(0);
}
console.error(`\n${failures} divergence(s) found.`);
process.exit(1);
