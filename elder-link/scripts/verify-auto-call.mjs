#!/usr/bin/env node
// End-to-end proof of the automatic door-alarm call — the thing the user could
// not see happening. It drives the *deployed* app's real scheduler tick
// (POST /api/cron/tick) against the fake device and counts what the database
// did, so the assertion is on rows, not on log lines.
//
// What it proves, in order:
//   1. A door open past the device's own threshold calls the elder BY ITSELF,
//      with no browser involved.
//   2. Staying open for many ticks calls exactly ONCE. This is the regression
//      guard for the bug where each tick minted a fresh episode id.
//   3. An unreachable device does not end the episode, and does not double-call.
//   4. A door that closes and reopens is a genuinely new episode, so it calls
//      again — the dedup must not be so eager it swallows a real second alarm.
//
// Usage: node scripts/verify-auto-call.mjs
// Env: APP_URL (default http://127.0.0.1:5174), CRON_SECRET, SUPABASE_URL,
//      SUPABASE_SERVICE_ROLE_KEY (read from .env if not exported).
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const env = Object.fromEntries(
  readFileSync(".env", "utf8")
    .split("\n")
    .filter((l) => l.includes("=") && !l.trimStart().startsWith("#"))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    }),
);

const APP = process.env["APP_URL"] ?? "http://127.0.0.1:5174";
const SECRET = process.env["CRON_SECRET"] ?? env["CRON_SECRET"];
const ELDER = process.env["SENSOR_ELDER_ID"] ?? env["SENSOR_ELDER_ID"] ?? "0ec7a7ef-d938-45f1-b0dd-d741bcd84726";
const FAKE = process.env["FAKE_URL"] ?? "http://127.0.0.1:8081";

if (!SECRET) {
  console.error("CRON_SECRET not set (env or .env) — cannot tick the scheduler.");
  process.exit(2);
}

const db = createClient(env["SUPABASE_URL"], env["SUPABASE_SERVICE_ROLE_KEY"], {
  auth: { persistSession: false },
});

let failures = 0;
const check = (ok, label, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
};

/** Ask the fake device which state to serve. */
async function setMode(mode) {
  const res = await fetch(`${FAKE}/mode/${mode}`);
  if (!res.ok) throw new Error(`could not set fake sensor mode to ${mode}`);
  const body = await res.json();
  console.log(`  device -> ${body.mode}  ${JSON.stringify(body.reading)}`);
}

/** One real scheduler tick, through the app's own authenticated endpoint. */
async function tick() {
  const res = await fetch(`${APP}/api/cron/tick`, {
    method: "POST",
    headers: { "x-cron-secret": SECRET, "content-type": "application/json" },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`tick failed ${res.status}: ${JSON.stringify(body)}`);
  return body;
}

async function counts() {
  const { count: alerts } = await db
    .from("sensor_alerts")
    .select("*", { count: "exact", head: true })
    .eq("elder_id", ELDER);
  const { count: jobs } = await db
    .from("call_jobs")
    .select("*", { count: "exact", head: true })
    .eq("elder_id", ELDER)
    .eq("kind", "sensor");
  return { alerts: alerts ?? 0, sensorJobs: jobs ?? 0 };
}

const sensorsOf = (t) => (Array.isArray(t.sensors) ? t.sensors : []);

console.log(`\nVerifying the automatic door-alarm call against ${APP}\n`);

// --- 0. clean slate --------------------------------------------------------
// Any episode left open by an earlier run would make tick #1 look like a
// duplicate, so close them and let the run observe only its own behaviour.
const { data: stale } = await db
  .from("sensor_alerts")
  .select("external_id")
  .eq("elder_id", ELDER)
  .eq("status", "open");
if (stale?.length) {
  await db
    .from("sensor_alerts")
    .update({ status: "closed", closed_at: new Date().toISOString() })
    .in("external_id", stale.map((s) => s["external_id"]));
  console.log(`  cleared ${stale.length} episode(s) left open by a previous run\n`);
}

const before = await counts();
console.log(`baseline  alerts=${before.alerts}  sensor jobs=${before.sensorJobs}\n`);

// --- 1. the door alarms: it must call by itself -----------------------------
console.log("[1] door open past threshold — the app must call with nobody watching");
await setMode("alarm");
const t1 = await tick();
const s1 = sensorsOf(t1);
console.log(`  sensors: ${JSON.stringify(s1)}`);
check(s1[0]?.action === "called", "one automatic call placed", `action=${s1[0]?.action}`);
const calledEpisode = s1[0]?.episodeId;
const after1 = await counts();
check(after1.alerts === before.alerts + 1, "one new alert row", `${before.alerts} -> ${after1.alerts}`);
check(after1.sensorJobs === before.sensorJobs + 1, "one new sensor call job", `${before.sensorJobs} -> ${after1.sensorJobs}`);

// --- 2. the door STAYS open: it must not call again -------------------------
console.log("\n[2] door stays open across further ticks — must call exactly ONCE in total (the bug this fixes)");
const repeatActions = [];
for (let i = 0; i < 3; i++) {
  const t = await tick();
  const s = sensorsOf(t);
  repeatActions.push(s[0]?.action);
  console.log(`  tick #${i + 2}: ${JSON.stringify(s)}`);
}
check(
  repeatActions.every((a) => a === "already-called"),
  "every repeat tick is already-called",
  repeatActions.join(", "),
);
const after2 = await counts();
check(after2.alerts === after1.alerts, "no extra alert rows", `${after1.alerts} -> ${after2.alerts}`);
check(after2.sensorJobs === after1.sensorJobs, "no extra calls", `${after1.sensorJobs} -> ${after2.sensorJobs}`);
check(
  s1[0]?.episodeId === undefined || after2.alerts === before.alerts + 1,
  "exactly one episode for one open door",
  `episode=${calledEpisode}`,
);

// --- 3. the device goes quiet mid-alarm ------------------------------------
console.log("\n[3] device unreachable mid-alarm — must hold the episode, not end it, not double-call");
await setMode("offline");
const t3 = await tick();
const s3 = sensorsOf(t3);
console.log(`  sensors: ${JSON.stringify(s3)}`);
check(s3[0]?.action === "none" && s3[0]?.reason === "unreachable", "reported unreachable, no call", `action=${s3[0]?.action}`);
const mid = await counts();
check(mid.sensorJobs === after1.sensorJobs, "still no extra call while offline", `${after1.sensorJobs} -> ${mid.sensorJobs}`);

// --- 4. device comes back, still alarming ----------------------------------
console.log("\n[4] device returns, door still open — must recognise the SAME episode, not call again");
await setMode("alarm");
const t4 = await tick();
const s4 = sensorsOf(t4);
console.log(`  sensors: ${JSON.stringify(s4)}`);
check(s4[0]?.action === "already-called", "recognised as the same episode", `action=${s4[0]?.action}`);
check(s4[0]?.episodeId === calledEpisode, "same episode id as the original call", `${s4[0]?.episodeId} vs ${calledEpisode}`);
const after4 = await counts();
check(after4.sensorJobs === after1.sensorJobs, "still exactly one call for this door-open", `${after4.sensorJobs}`);

// --- 5. the door closes and reopens ----------------------------------------
console.log("\n[5] door closes, then opens again — this is a NEW episode and must call again");
await setMode("closed");
await tick();
await setMode("alarm");
const t5 = await tick();
const s5 = sensorsOf(t5);
console.log(`  sensors: ${JSON.stringify(s5)}`);
check(s5[0]?.action === "called", "second, genuinely-new episode called", `action=${s5[0]?.action}`);
check(s5[0]?.episodeId !== calledEpisode, "new episode id", `${s5[0]?.episodeId}`);
const after5 = await counts();
check(after5.sensorJobs === after1.sensorJobs + 1, "exactly two calls in total", `${after5.sensorJobs}`);

console.log(
  `\n${failures === 0 ? "ALL PASS" : `${failures} FAILURE(S)`} — alerts ${before.alerts} -> ${after5.alerts}, sensor jobs ${before.sensorJobs} -> ${after5.sensorJobs}\n`,
);
process.exit(failures === 0 ? 0 : 1);
