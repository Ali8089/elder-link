// Verifies the phone page end to end THROUGH THE PUBLIC TUNNEL — the exact URL
// the user opens on a mobile device that cannot route to this laptop.
//
//   URL=https://xxxx.trycloudflare.com node scripts/check-tunnel.mjs
//
// This is the check that matters when the laptop and the phone are on a hotspot
// that blocks client-to-client traffic: the page, its assets, and the sensor
// proxy all have to work over the tunnel, not just over the LAN.

import { chromium } from "playwright";

const BASE = (process.env.URL ?? "").replace(/\/$/, "");
if (!BASE) {
  console.error("set URL=https://<tunnel-host>");
  process.exit(2);
}

let pass = 0;
let fail = 0;
const ok = (m) => { pass++; console.log(`  ok   ${m}`); };
const bad = (m) => { fail++; console.log(`  FAIL ${m}`); };
const check = (m, c) => (c ? ok(m) : bad(m));

console.log(`\n--- ${BASE} over the public tunnel`);

const browser = await chromium.launch();
// A phone-shaped, touch-enabled context, which is what the real device is.
const ctx = await browser.newContext({
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  isMobile: true,
  userAgent:
    "Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 " +
    "(KHTML, like Gecko) Chrome/120 Mobile Safari/537.36",
});
const page = await ctx.newPage();

const failed = [];
const consoleErrors = [];
page.on("requestfailed", (r) => failed.push(`${r.url()} — ${r.failure()?.errorText}`));
page.on("response", (r) => { if (r.status() >= 400) failed.push(`${r.url()} — HTTP ${r.status()}`); });
page.on("pageerror", (e) => consoleErrors.push(e.message));

// 1. the page itself
const t0 = Date.now();
const res = await page.goto(`${BASE}/phone-alert.html`, { waitUntil: "domcontentloaded", timeout: 45000 });
const loadMs = Date.now() - t0;
check("the alert page loads over the tunnel", !!res && res.status() === 200);
check("it loads in a reasonable time", loadMs < 30000);

// 2. it is the real page, not an error page
const heading = await page.innerText("h1").catch(() => "");
check("the real page rendered", /門|警報|監測|Elder|感應/.test(heading + (await page.innerText("body").catch(() => ""))));

// 3. the secret and the notify box came through the server injection
const injected = await page.evaluate(() => ({
  notify: document.querySelector("#notifyRunner")?.checked,
  secret: (document.querySelector("#runnerSecret")?.value ?? "").length,
}));
check("the app-notify box is pre-ticked", injected.notify === true);
check("the trigger secret was injected", injected.secret > 10);

// 4. the sensor proxy reaches the real ESP32 through the tunnel
const reading = await page.evaluate(async () => {
  const r = await fetch("/sensor/data", { cache: "no-store" });
  const t = await r.text();
  return { status: r.status, body: t };
});
check("the sensor proxy answers", reading.status === 200);
let parsed = null;
try { parsed = JSON.parse(reading.body); } catch {}
check("the reading parses", !!parsed);
check("the reading has an alarm field", parsed && typeof parsed.alarm === "boolean");
console.log(`       sensor: ${reading.body}`);

// 5. the page's own poller actually starts and reads the sensor.
//    If the sensor is genuinely alarming (door held open), the correct
//    behaviour is to jump straight to the call screen rather than sit on
//    the alert page — so either outcome counts as "monitoring started".
await page.click("#start");
await page.waitForTimeout(6000);
const sent = await page.evaluate(() => window.__elderLinkAlert?.events?.length ?? 0);
const bodyText = await page.innerText("body");
const onCallScreen = /Incoming call|來電中|接聽/.test(bodyText);
check(
  "the page started monitoring",
  /監測中|已開始|正在|ALARM|警報/.test(bodyText) || sent > 0 || onCallScreen,
);
if (onCallScreen) console.log("       sensor alarming → jumped to the call screen (expected)");

// 6. nothing broke along the way
check("no failed requests", failed.length === 0);
if (failed.length) console.log("       " + failed.slice(0, 5).join("\n       "));
check("no page errors", consoleErrors.length === 0);
if (consoleErrors.length) console.log("       " + consoleErrors.slice(0, 3).join("\n       "));

await browser.close();
console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
