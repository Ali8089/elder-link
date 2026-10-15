#!/usr/bin/env node
// Show, and optionally clear, the door-sensor state for one elder.
//
// Why this is needed: the "one call per open door" guarantee is enforced by an
// open `sensor_alerts` row. That is exactly what makes it trustworthy, and
// exactly what makes it confusing to test against a live database — if a
// previous run left an episode open, the next real alarm is correctly judged a
// duplicate and places no call, which looks like a bug when it is the feature
// working.
//
// So this prints what the app believes before you test, and can clear it so a
// test starts from a known state.
//
// Usage:
//   node scripts/sensor-state.mjs            # show
//   node scripts/sensor-state.mjs --clear    # close any open episodes
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

const ELDER =
  process.env["SENSOR_ELDER_ID"] ?? env["SENSOR_ELDER_ID"] ?? "0ec7a7ef-d938-45f1-b0dd-d741bcd84726";
const clear = process.argv.includes("--clear");

const db = createClient(env["SUPABASE_URL"], env["SUPABASE_SERVICE_ROLE_KEY"], {
  auth: { persistSession: false },
});

const { data: open, error: openErr } = await db
  .from("sensor_alerts")
  .select("id, external_id, status, received_at, closed_at, call_job_id")
  .eq("elder_id", ELDER)
  .eq("status", "open")
  .order("received_at", { ascending: false });

if (openErr) {
  console.error(`could not read sensor_alerts: ${openErr.message}`);
  process.exit(1);
}

const { count: total } = await db
  .from("sensor_alerts")
  .select("*", { count: "exact", head: true })
  .eq("elder_id", ELDER);

const { count: jobs } = await db
  .from("call_jobs")
  .select("*", { count: "exact", head: true })
  .eq("elder_id", ELDER)
  .eq("kind", "sensor");

console.log(`elder ${ELDER}`);
console.log(`  total sensor_alerts : ${total ?? 0}`);
console.log(`  sensor call jobs    : ${jobs ?? 0}`);
console.log(`  OPEN episodes       : ${open?.length ?? 0}`);

for (const row of open ?? []) {
  console.log(`    - ${row.external_id}`);
  console.log(`        received ${row.received_at}  job=${row.call_job_id ?? "(none)"}`);
}

if (!open?.length) {
  console.log("\nNothing open. A fresh door alarm will place a call.");
  process.exit(0);
}

if (!clear) {
  console.log(
    "\nWhile an episode is open, the next door alarm on this sensor is treated as a\n" +
      "duplicate and will NOT call. That is the dedup working as designed, not a fault.\n" +
      "Re-run with --clear to close these and test a first call.",
  );
  process.exit(0);
}

const { data: closed, error } = await db
  .from("sensor_alerts")
  .update({ status: "closed", closed_at: new Date().toISOString() })
  .eq("elder_id", ELDER)
  .eq("status", "open")
  .select("id");

if (error) {
  console.error(`could not clear: ${error.message}`);
  process.exit(1);
}
console.log(`\ncleared ${closed?.length ?? 0} open episode(s). A fresh alarm will now place a call.`);
