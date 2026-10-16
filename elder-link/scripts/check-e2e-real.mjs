// End-to-end proof that the whole chain works:
//
//   real ESP32 -> page detector -> POST /api/sensors/door -> runner -> call job
//
// Runs the page's OWN extracted detector against the live device, then posts the
// resulting episode to the live app, then reads the database back to confirm a
// call job really exists. Nothing here is simulated except the door itself.
import fs from "node:fs";

const env = {};
for (const l of fs.readFileSync(".env", "utf8").split(/\r?\n/)) {
  const m = /^([A-Z0-9_]+)=(.*)$/.exec(l);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}

const DEVICE = env.SENSOR_URL;
const APP = "http://127.0.0.1:3000";
const ELDER = env.SENSOR_ELDER_ID;

// ---- pull the page's detector so we test the shipped code, not a copy ------
const html = fs.readFileSync("public/phone-alert.html", "utf8");
const body = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].pop()[1];
const grab = (name) => {
  const re = new RegExp(`(async\\s+)?function ${name}\\s*\\([^)]*\\)\\s*\\{[\\s\\S]*?\\n  \\}`);
  const m = body.match(re);
  if (!m) throw new Error(`cannot extract ${name}`);
  return m[0];
};

const S = { firedForEpisode: false, lastWasAlarming: false,
            episodeId: null, episodeStartedAt: null };
const api = new Function("S",
  [grab("parseReading"), grab("decideTrigger")].join("\n") +
  "\nreturn { parseReading, decideTrigger };"
)(S);

// ---- 1. read the real device ----------------------------------------------
console.log(`[1] reading the real device: ${DEVICE}`);
let reading = null;
try {
  const r = await fetch(DEVICE, { signal: AbortSignal.timeout(5000) });
  reading = api.parseReading(await r.json());
  console.log(`    HTTP ${r.status} -> ${JSON.stringify(reading)}`);
} catch (e) {
  console.log(`    FAILED: ${e.message}`);
  process.exit(1);
}
if (!reading) { console.log("    device did not return a usable reading"); process.exit(1); }

// ---- 2. run the shipped detector -----------------------------------------
const d = api.decideTrigger(reading);
console.log(`[2] detector says: ${d.action} (${d.reason})`);
if (d.action !== "trigger") {
  console.log("    the door is not alarming right now — open it to run the full test");
  process.exit(0);
}
console.log(`    episode id: ${d.episodeId}`);

// ---- 3. post it to the app ------------------------------------------------
console.log(`[3] POST ${APP}/api/sensors/door`);
const t0 = Date.now();
let payload = null;
try {
  const r = await fetch(`${APP}/api/sensors/door`, {
    method: "POST",
    headers: { "content-type": "application/json",
               "x-sensor-secret": env.SENSOR_TRIGGER_SECRET },
    body: JSON.stringify({ elderId: ELDER, externalId: d.episodeId }),
    signal: AbortSignal.timeout(40000),
  });
  const text = await r.text();
  console.log(`    HTTP ${r.status} in ${Date.now() - t0}ms`);
  console.log(`    ${text}`);
  try { payload = JSON.parse(text); } catch { /* non-JSON */ }
} catch (e) {
  console.log(`    FAILED: ${e.message}`);
  process.exit(1);
}

// ---- 4. confirm a call job exists in the database -------------------------
const H = { apikey: env.SUPABASE_SERVICE_ROLE_KEY,
            authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}` };
const rows = await (await fetch(
  `${env.SUPABASE_URL}/rest/v1/sensor_alerts?select=external_id,status,call_job_id&external_id=eq.${encodeURIComponent(d.episodeId)}`,
  { headers: H })).json();

console.log("[4] database check");
console.log(`    sensor_alerts row: ${JSON.stringify(rows)}`);

const alertRow = Array.isArray(rows) ? rows[0] : null;
const passed = payload?.ok === true && alertRow?.call_job_id;

if (alertRow?.call_job_id) {
  const job = await (await fetch(
    `${env.SUPABASE_URL}/rest/v1/call_jobs?select=id,kind,attempt,status,outcome&id=eq.${alertRow.call_job_id}`,
    { headers: H })).json();
  console.log(`    call_jobs row: ${JSON.stringify(job)}`);
}

console.log(`\n${passed ? "PASS — real alarm produced a real call job" : "FAIL — no call job was created"}`);
process.exit(passed ? 0 : 1);
