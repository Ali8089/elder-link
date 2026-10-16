// The definitive test: replicate exactly what the phone does, over the phone's
// own network path (port 8000 only), using the page's own extracted code.
//
//   GET  /sensor/data          -> real ESP32 reading
//   page detector              -> rising-edge decision + stable episode id
//   POST /app/api/sensors/door -> app places the call
//   read DB back               -> prove a call job exists
//
// If this passes, the phone will work; no part of the chain is stubbed.
import fs from "node:fs";

const env = {};
for (const l of fs.readFileSync(".env", "utf8").split(/\r?\n/)) {
  const m = /^([A-Z0-9_]+)=(.*)$/.exec(l);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}

const PHONE_BASE = process.env.PHONE_BASE ?? "http://10.245.139.46:8000";

// ---- extract the page's shipped detector ----------------------------------
const html = fs.readFileSync("public/phone-alert.html", "utf8");
const body = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].pop()[1];
const grab = (n) => {
  const m = body.match(new RegExp(`(async\\s+)?function ${n}\\s*\\([^)]*\\)\\s*\\{[\\s\\S]*?\\n  \\}`));
  if (!m) throw new Error(`cannot extract ${n}`);
  return m[0];
};
const S = { firedForEpisode: false, lastWasAlarming: false,
            episodeId: null, episodeStartedAt: null };
const api = new Function("S",
  [grab("parseReading"), grab("decideTrigger")].join("\n") +
  "\nreturn { parseReading, decideTrigger };"
)(S);

let failures = 0;
const check = (ok, label, detail = "") => {
  if (!ok) failures++;
  console.log(`  ${ok ? "PASS" : "FAIL"} ${label}${detail ? "  — " + detail : ""}`);
};

// ---- 1. the page itself loads ---------------------------------------------
console.log(`\n[1] page over the phone's path (${PHONE_BASE})`);
const pageRes = await fetch(`${PHONE_BASE}/phone-alert.html?v=e2e`);
const pageHtml = await pageRes.text();
check(pageRes.status === 200, "page loads", `HTTP ${pageRes.status}, ${pageHtml.length} bytes`);
check(pageHtml.includes("/sensor/data"), "defaults to the proxied sensor");
check(pageHtml.includes("/app/api/sensors/door"), "defaults to the proxied app endpoint");
check(/CFG_VERSION = 6/.test(pageHtml), "config version is current");

// ---- 2. the sensor is readable --------------------------------------------
console.log("\n[2] sensor reading");
let reading = null, rawBody = "";
try {
  const r = await fetch(`${PHONE_BASE}/sensor/data`, { signal: AbortSignal.timeout(6000) });
  rawBody = await r.text();
  reading = api.parseReading(JSON.parse(rawBody));
  check(r.status === 200, "sensor reachable", `HTTP ${r.status}`);
  check(!!reading, "reading parses", rawBody.trim());
} catch (e) {
  check(false, "sensor reachable", e.message);
}

// ---- 3. the detector fires on the real device ------------------------------
console.log("\n[3] detector against the real device");
const decision = api.decideTrigger(reading);
console.log(`      decision: ${decision.action} (${decision.reason})`);
if (decision.action !== "trigger") {
  console.log("      door is not alarming — open it and re-run for the call half\n");
  process.exit(failures ? 1 : 0);
}
check(true, "rising edge detected");
check(!!decision.episodeId, "episode id minted", decision.episodeId);

// A stable id is what stops repeat ringing; confirm the same episode reuses it.
const again = api.decideTrigger(reading);
check(again.action === "none", "second poll of the same alarm does not re-fire");

// ---- 4. the app places the call -------------------------------------------
console.log("\n[4] app call through the phone's port");
const t0 = Date.now();
let payload = null;
try {
  const r = await fetch(`${PHONE_BASE}/app/api/sensors/door`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-sensor-secret": env.SENSOR_TRIGGER_SECRET,
    },
    body: JSON.stringify({ elderId: env.SENSOR_ELDER_ID, externalId: decision.episodeId }),
    signal: AbortSignal.timeout(60000),
  });
  const text = await r.text();
  console.log(`      HTTP ${r.status} in ${Date.now() - t0}ms  ${text}`);
  payload = JSON.parse(text);
  check(r.status === 200 && payload.ok === true, "app accepted the alarm");
} catch (e) {
  check(false, "app accepted the alarm", e.message);
}

// ---- 5. a call job really exists ------------------------------------------
console.log("\n[5] call job in the database");
const H = { apikey: env.SUPABASE_SERVICE_ROLE_KEY,
            authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}` };
const rows = await (await fetch(
  `${env.SUPABASE_URL}/rest/v1/sensor_alerts?select=external_id,call_job_id&external_id=eq.${encodeURIComponent(decision.episodeId)}`,
  { headers: H })).json();
const alertRow = Array.isArray(rows) ? rows[0] : null;
check(!!alertRow?.call_job_id, "alert row linked to a call job", JSON.stringify(alertRow));

if (alertRow?.call_job_id) {
  const job = await (await fetch(
    `${env.SUPABASE_URL}/rest/v1/call_jobs?select=id,kind,attempt,status,outcome&id=eq.${alertRow.call_job_id}`,
    { headers: H })).json();
  console.log(`      job: ${JSON.stringify(job[0] ?? null)}`);
  check(Array.isArray(job) && job[0]?.kind === "sensor", "job is a sensor check-in call");
}

console.log(`\n${failures ? failures + " CHECK(S) FAILED" : "ALL CHECKS PASSED — the phone path works end to end"}\n`);
process.exit(failures ? 1 : 0);
