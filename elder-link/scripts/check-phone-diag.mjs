// Drives the diagnostic fetchReading() from public/phone-alert.html against the
// live proxy, so the phone's own code path is exercised over real HTTP.
// Not shipped; run manually while demo-server.mjs is up.
import fs from "node:fs";

const html = fs.readFileSync("public/phone-alert.html", "utf8");
const body = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].pop()[1];

function grab(name) {
  // Keep the `async` keyword — fetchReading is async and dropping it makes the
  // extracted snippet a syntax error.
  const re = new RegExp(`(async\\s+)?function ${name}\\s*\\([^)]*\\)\\s*\\{[\\s\\S]*?\\n  \\}`);
  const m = body.match(re);
  if (!m) throw new Error(`could not extract ${name}`);
  return m[0];
}

const composed = [grab("parseReading"), grab("safeJson"), grab("fetchReading")].join("\n");
const api = new Function(composed + "\nreturn { parseReading, fetchReading };" )();

const BASE = process.env.BASE ?? "http://127.0.0.1:8000";

async function tryUrl(url, label) {
  const { reading, diag } = await api.fetchReading({ url, timeoutMs: 4000 });
  console.log(`\n${label}  (${url})`);
  console.log(`  status : ${diag.status}`);
  console.log(`  body   : ${diag.body}`);
  console.log(`  parsed : ${JSON.stringify(diag.parsed)}`);
  console.log(`  error  : ${diag.err}`);
  console.log(`  -> reading ${reading ? "OK" : "NULL"}`);
  return !!reading;
}

let bad = 0;
if (!(await tryUrl(`${BASE}/sensor/data`, "proxied relative path"))) bad++;

// A relative URL is what the page actually uses; confirm it resolves too.
const rel = await api.fetchReading({ url: `${BASE}/sensor/data`, timeoutMs: 4000 });
if (!rel.reading) bad++;

// Deliberately unreachable host: the diagnostic must report a real reason, not null-silence.
if (await tryUrl("http://127.0.0.1:59999/nope", "unreachable port")) bad++;

console.log(bad ? `\n${bad} unexpected failures` : "\ndtune diagnostic path behaves correctly");
process.exit(bad ? 1 : 0);
