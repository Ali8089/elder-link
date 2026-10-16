// Checks that the app's CARE_SCRIPT and the phone page's SCRIPT have not drifted.
//
// The 44-section tree exists twice on purpose: src/lib/script.ts is what the
// React app and its tests read, public/call-script.js is what the standalone
// phone page reads without a bundler. Two copies can silently diverge, and a
// divergence here is a safety bug — the app would escalate on a section the
// phone page never reaches, or the phone page would speak wording that was
// changed for a reason.
//
// This test fails on any difference in section ids, spoken lines, options, or
// graph edges.

import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");

const plain = await import(new URL("../public/call-script.js", import.meta.url).href);

/**
 * Extracts CARE_SCRIPT from script.ts.
 *
 * Read as text and evaluated in a sandbox-ish way rather than imported, because
 * script.ts is TypeScript and this script is plain Node. The object literal is
 * pure data (no imports, no calls), so slicing it out and evaluating it is safe
 * and keeps this check runnable without a build step.
 */
function loadAppScript() {
  const src = readFileSync(join(root, "src", "lib", "script.ts"), "utf8");
  const start = src.indexOf("export const CARE_SCRIPT");
  if (start === -1) throw new Error("CARE_SCRIPT not found in src/lib/script.ts");
  const open = src.indexOf("{", start);
  // Walk braces to find the matching close, so a nested object cannot cut it short.
  let depth = 0;
  let end = -1;
  for (let i = open; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") {
      depth--;
      if (depth === 0) { end = i + 1; break; }
    }
  }
  if (end === -1) throw new Error("CARE_SCRIPT object braces unbalanced");
  const literal = src.slice(open, end);
  // `s` and `o` are defined just above the object in script.ts.
  const fn = new Function("s", "o", `return ${literal};`);
  const s = (zh, en) => ({ zh, en });
  const o = (zh, en, go) => ({ zh, en, go });
  return fn(s, o);
}

const app = loadAppScript();
const plainJs = plain.SCRIPT;

let fail = 0;
const report = (msg) => { console.log(`  FAIL ${msg}`); fail++; };
const ok = (msg) => console.log(`  ok   ${msg}`);

console.log("\nCARE_SCRIPT vs public/call-script.js");

// 1. Same sections, same order.
const appIds = Object.keys(app);
const plainIds = Object.keys(plainJs);
if (appIds.join(",") !== plainIds.join(",")) {
  const onlyApp = appIds.filter((i) => !plainIds.includes(i));
  const onlyPlain = plainIds.filter((i) => !appIds.includes(i));
  report(`section list differs — only in app: [${onlyApp}], only in plain: [${onlyPlain}]`);
} else {
  ok(`same ${appIds.length} sections in the same order`);
}

// 2. Per-section deep comparison.
let lineCount = 0;
let optCount = 0;
for (const id of appIds) {
  const a = app[id];
  const p = plainJs[id];
  if (!p) continue;

  const aSay = JSON.stringify(a.say ?? []);
  const pSay = JSON.stringify(p.say ?? []);
  if (aSay !== pSay) {
    report(`${id}: spoken lines differ\n         app:   ${aSay}\n         plain: ${pSay}`);
  } else {
    lineCount += (a.say ?? []).length;
  }

  const aOpts = JSON.stringify((a.options ?? []).map((x) => [x.zh, x.go]));
  const pOpts = JSON.stringify((p.options ?? []).map((x) => [x.zh, x.go]));
  if (aOpts !== pOpts) {
    report(`${id}: options differ\n         app:   ${aOpts}\n         plain: ${pOpts}`);
  } else {
    optCount += (a.options ?? []).length;
  }

  if ((a.next ?? null) !== (p.next ?? null)) {
    report(`${id}: next differs (app=${a.next} plain=${p.next})`);
  }
  if (!!a.end !== !!p.end) {
    report(`${id}: end differs (app=${!!a.end} plain=${!!p.end})`);
  }
  if (!!a.danger !== !!p.danger) report(`${id}: danger flag differs`);
  if (!!a.unsafe !== !!p.unsafe) report(`${id}: unsafe flag differs`);
  if (!!a.activity !== !!p.activity) report(`${id}: activity flag differs`);
  if ((a.ask ?? null) !== (p.ask ?? null)) report(`${id}: ask wording differs`);
}

if (fail === 0) ok(`all spoken lines match (${lineCount} lines)`);
if (fail === 0) ok(`all options match (${optCount} options)`);

// 3. The escalation set must be identical too.
const appEsc = readFileSync(join(root, "src", "lib", "script.ts"), "utf8");
const escMatch = appEsc.match(/export const ESCALATE = new Set\(\[([\s\S]*?)\]\)/);
const appEscIds = [...escMatch[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]).sort();
const plainEscIds = [...plain.ESCALATE].sort();
if (appEscIds.join(",") !== plainEscIds.join(",")) {
  report(`ESCALATE differs — app: [${appEscIds}], plain: [${plainEscIds}]`);
} else {
  ok(`escalation sets match (${appEscIds.length} sections)`);
}

// 4. Opening map.
if (plain.OPENING_FOR.sensor !== "S2" || plain.OPENING_FOR.scheduled !== "S1") {
  report("OPENING_FOR is not {sensor: S2, scheduled: S1}");
} else {
  ok("opening map is S2 (sensor) / S1 (scheduled)");
}

console.log(fail === 0 ? "\nScripts are in sync.\n" : `\n${fail} difference(s) found.\n`);
process.exit(fail === 0 ? 0 : 1);
