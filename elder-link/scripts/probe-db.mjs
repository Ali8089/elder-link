// Read-only probe of the live Supabase project: does the configured elder
// exist, and is it consented? Prints what it finds; changes nothing.
import fs from "node:fs";

const env = {};
for (const line of fs.readFileSync(".env", "utf8").split(/\r?\n/)) {
  const m = /^([A-Z0-9_]+)=(.*)$/.exec(line);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}

const url = env.SUPABASE_URL;
const key = env.SUPABASE_SERVICE_ROLE_KEY;
const H = { apikey: key, authorization: `Bearer ${key}` };

console.log("supabase:", url);
console.log("configured elder:", env.SENSOR_ELDER_ID);
console.log("");

async function q(label, path) {
  const r = await fetch(`${url}/rest/v1/${path}`, { headers: H });
  const t = await r.text();
  console.log(`${label}: ${r.status} ${t.slice(0, 400)}`);
  return t;
}

await q("elders (all)", "elders?select=*&limit=5");
console.log("");
await q("configured elder by id", `elders?select=*&id=eq.${env.SENSOR_ELDER_ID}`);
console.log("");
await q("sensor_alerts", "sensor_alerts?select=*&limit=3");
