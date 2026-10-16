// Verifies the two fixes the user asked for:
//
//   1. an alarm goes STRAIGHT to the incoming-call screen — no red
//      "Answer the call" banner in between;
//   2. the call screen tries to fill the display (fullscreen / address-bar
//      collapse) rather than sitting under Chrome's toolbar.
//
//   node scripts/check-call-fixes.mjs
//
// Runs against the local demo server. The sensor is stubbed so this does not
// depend on the ESP32 being powered.

import { chromium } from "playwright";

const BASE = process.env.ALERT_BASE ?? "http://127.0.0.1:8000";
const PAGE = `${BASE}/phone-alert.html`;

let pass = 0;
let fail = 0;
const ok = (m) => { pass++; console.log(`  ok   ${m}`); };
const bad = (m) => { fail++; console.log(`  FAIL ${m}`); };
const check = (m, c) => (c ? ok(m) : bad(m));

// ---- 1. the banner is gone from the page entirely -------------------------
console.log("\n--- the answer-the-call banner is gone");

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  isMobile: true,
  userAgent:
    "Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 " +
    "(KHTML, like Gecko) Chrome/120 Mobile Safari/537.36",
});
const page = await ctx.newPage();

const errors = [];
page.on("pageerror", (e) => errors.push(e.message));

let door = { open: true, alarm: true };
await page.route("**/sensor/data", async (route) => {
  await route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ fsr: 3900, open: door.open, alarm: door.alarm }),
  });
});

await page.goto(PAGE, { waitUntil: "domcontentloaded" });

const bannerEl = await page.$("#banner");
check("no #banner element exists", bannerEl === null);
check("no #bannerCall button exists", (await page.$("#bannerCall")) === null);
// Only the rendered page matters; the string survives in source comments.
const visibleText = await page.evaluate(() => document.body.innerText);
check("no 'Answer the call' text is rendered", !/answer the call/i.test(visibleText));
check("no 接聽來電 button is rendered", !visibleText.includes("接聽來電"));

// the page must still be able to drive a call
check("openCall-style navigation still wired", (await page.$("#testCall")) !== null);

// ---- 2. an alarm navigates straight to the call screen --------------------
console.log("\n--- an alarm goes straight to the call");

let navigatedTo = null;
page.on("framenavigated", (f) => {
  if (f === page.mainFrame() && /phone-call\.html/.test(f.url())) navigatedTo = f.url();
});

await page.click("#start");
// fireAlarm waits 1.5s before navigating, and the poll itself is up to 2s.
await page.waitForTimeout(8000);

check("the alarm navigated to the call screen", navigatedTo !== null);
if (navigatedTo) {
  check("the navigation carries the sensor trigger", navigatedTo.includes("trigger=sensor"));
} else {
  const log = await page.innerText("#log").catch(() => "");
  console.log("       page log:\n         " + log.split("\n").slice(-6).join("\n         "));
}

// ---- 3. the call screen fills the display ---------------------------------
console.log("\n--- the call screen fills the display");

const call = await ctx.newPage();
await call.goto(`${BASE}/phone-call.html?trigger=sensor`, { waitUntil: "domcontentloaded" });
await call.waitForTimeout(1200);

const fs = await call.evaluate(() => ({
  apiPresent: typeof document.documentElement.requestFullscreen === "function" ||
              typeof document.documentElement.webkitRequestFullscreen === "function",
  isFull: !!(document.fullscreenElement || document.webkitFullscreenElement),
  // the collapse helper sets these
  htmlH: document.documentElement.style.height,
  bodyH: document.body.style.height,
  innerH: window.innerHeight,
  outerH: window.outerHeight,
  scrollY: window.scrollY,
}));
check("a fullscreen API is present", fs.apiPresent);
check("the call screen is laid out to the full viewport", fs.htmlH === "100%" && fs.bodyH === "100%");
console.log(`       innerHeight=${fs.innerH} outerHeight=${fs.outerH} fullscreen=${fs.isFull}`);

// tapping should attempt fullscreen (and must not throw)
await call.mouse.click(195, 400);
await call.waitForTimeout(800);
const afterTap = await call.evaluate(() => ({
  isFull: !!(document.fullscreenElement || document.webkitFullscreenElement),
  scrollY: window.scrollY,
}));
console.log(`       after tap: fullscreen=${afterTap.isFull} scrollY=${afterTap.scrollY}`);
check("tapping does not break the call screen", await call.isVisible("#acceptBtn"));
check("the accept button is still reachable", await call.isVisible("#declineBtn"));

check("no uncaught page errors on the alert page", errors.length === 0);
if (errors.length) console.log("       " + errors.slice(0, 3).join("\n       "));

await browser.close();
console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
