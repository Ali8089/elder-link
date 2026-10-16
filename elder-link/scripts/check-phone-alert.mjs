// Live check: drives the detector extracted from public/phone-alert.html against
// the running fake door sensor, over real HTTP. Not shipped; run manually.
import fs from "node:fs";

const html = fs.readFileSync("public/phone-alert.html", "utf8");
const body = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].pop()[1];
const composed =
  body.match(/function parseReading\s*\(v\)\s*\{[\s\S]*?\n  \}/)[0] +
  "\n" +
  body.match(/function decideTrigger\s*\(reading\)\s*\{[\s\S]*?\n  \}/)[0];

// Same module-scope shape the page uses.
const S = { firedForEpisode: false, lastWasAlarming: false };
const dt = new Function("S", composed + "\nreturn {parseReading, decideTrigger};")(S);

const BASE = process.env.FAKE_BASE ?? "http://127.0.0.1:8081";

async function read() {
  try {
    const r = await fetch(`${BASE}/data`, { signal: AbortSignal.timeout(3000) });
    if (!r.ok) return null;
    return dt.parseReading(await r.json());
  } catch {
    return null;
  }
}
const step = async (label) => {
  const d = dt.decideTrigger(await read());
  console.log(`${d.action === "trigger" ? "CALL  " : "      "}${label.padEnd(34)}-> ${d.reason}`);
  return d.action;
};
const setMode = (m) => fetch(`${BASE}/mode/${m}`);

let fails = 0;
const expect = (got, want, label) => {
  const ok = got === want;
  if (!ok) fails++;
  console.log(`  ${ok ? "PASS" : "FAIL"} ${label}: want=${want} got=${got}`);
};

await setMode("closed");
expect(await step("closed"), "none", "closed = quiet");
await setMode("open");
expect(await step("open, under threshold"), "none", "open<15s = quiet");
await setMode("alarm");
expect(await step("alarm (rising edge)"), "trigger", "alarm = CALL");
expect(await step("alarm still open"), "none", "no repeat");
await setMode("offline");
expect(await step("board offline"), "none", "offline holds, no call");
await setMode("alarm");
expect(await step("board back, still alarming"), "none", "same episode, no call");
await setMode("closed");
expect(await step("door closed"), "none", "episode closes");
await setMode("alarm");
expect(await step("alarm again (new episode)"), "trigger", "second episode = CALL");

console.log(fails ? `\n${fails} FAILED` : "\nall live cases passed against the running fake sensor");
process.exit(fails ? 1 : 0);
