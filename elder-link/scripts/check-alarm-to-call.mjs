// Verifies the alert page rings through to the call screen.
//
//   node scripts/check-alarm-to-call.mjs
//
// The alert page used to jump to the phone's own dialler when the door alarm
// fired. That was wrong for this product: the elder is the person being
// called, so the call has to arrive *at* the phone. This checks the replacement
// wiring — the banner and the auto-ring both navigate to phone-call.html with
// the sensor trigger and the elder id attached.
//
// It loads the real page from the demo server and drives it in a browser, so a
// broken selector or a stale localStorage config is caught here.

import { chromium } from "playwright";

const BASE = process.env.ALERT_BASE ?? "http://127.0.0.1:8000";
const PAGE = `${BASE}/phone-alert.html`;

let pass = 0;
let fail = 0;
const ok = (m) => { pass++; console.log(`  ok   ${m}`); };
const bad = (m) => { fail++; console.log(`  FAIL ${m}`); };
const check = (m, c) => (c ? ok(m) : bad(m));

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await ctx.newPage();

const errors = [];
page.on("pageerror", (e) => errors.push(e.message));

await page.goto(PAGE, { waitUntil: "domcontentloaded" });

/* ----------------------------------------------------------- configuration */

check("the auto-call toggle exists", await page.isVisible("#autoCall"));
check("auto-call is on by default", await page.isChecked("#autoCall"));
check("a test-call button exists", await page.isVisible("#testCall"));

// The config version must have been bumped, or an older saved config would keep
// the old behaviour and the new fields would never appear.
const cfgVersion = await page.evaluate(() => {
  // Force a stale entry, then reload logic by reading what the page wrote.
  localStorage.setItem("doorAlert.cfg", JSON.stringify({ v: 4, url: "http://10.0.0.9/data" }));
  return true;
});
check("a stale config can be planted", cfgVersion);

await page.goto(PAGE, { waitUntil: "domcontentloaded" });
const afterReload = await page.evaluate(() => localStorage.getItem("doorAlert.cfg"));
check("a v4 config is discarded on load", afterReload === null);

/* ------------------------------------------------- the banner opens the call */

// Trigger the banner the same way an alarm does.
await page.click("#testAlert");
await page.waitForSelector("#banner.on", { timeout: 5000 });
check("the alarm banner appears", true);

const bannerText = await page.innerText("#banner");
check("the banner names the care team", bannerText.includes("Elderly care team"));
check("the banner offers to answer the call", bannerText.includes("接聽"));
check("the old tel: dialler wording is gone", !bannerText.includes("立即打電話"));

/* ------------------------------------------- the call button navigates there */

const [nav] = await Promise.all([
  page.waitForURL(/phone-call\.html/, { timeout: 8000 }).catch(() => null),
  page.click("#bannerCall"),
]);
check("the banner button opens the call screen", nav !== null);
check("the call is triggered as a sensor alert",
  page.url().includes("trigger=sensor"), );
check("the elder id is carried across",
  /elder=[0-9a-f-]{8,}/i.test(page.url()));
check("the call screen actually renders", await page.isVisible("#acceptBtn"));
check("the caller is 'Elderly care team'",
  (await page.textContent("#callerName")).trim() === "Elderly care team");

/* --------------------------------------------- the test-call button as well */

await page.goto(PAGE, { waitUntil: "domcontentloaded" });
const [nav2] = await Promise.all([
  page.waitForURL(/phone-call\.html/, { timeout: 8000 }).catch(() => null),
  page.click("#testCall"),
]);
check("the test-call button opens the call screen", nav2 !== null);

check("no uncaught page errors", errors.length === 0);
if (errors.length) console.log("       " + errors.slice(0, 3).join("\n       "));

await browser.close();
console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
