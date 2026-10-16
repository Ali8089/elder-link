// Verifies when the door alarm should and should not fire, from the first poll.
//
//   node scripts/check-alarm-baseline.mjs
//
// There are two ways the page can be started while something is already
// happening at the door, and they must NOT be treated the same:
//
//   a) door open, sensor has NOT yet said "dangerous" (`alarm: false`).
//      The firmware's own 15-second timer is still running. Starting to watch
//      here must not fire — pressing 開始監測 seconds after someone walks
//      through the door should not ring them.
//
//   b) sensor is ALREADY asserting `alarm: true`.
//      That is a present emergency, not a missed edge. It must fire on the
//      first poll. Suppressing it leaves the screen reading 警報 forever and
//      never rings anyone — a real bug the user hit, because the ESP32 latches
//      `alarm` while the door stays open.
//
// The test drives the real page in a real browser and controls the sensor from
// the outside, so it exercises the real decideTrigger() rather than a copy.
//
// Firing is observed via the page's own log. Whether it also *navigates* to the
// call screen depends on the audio-unlock rule, which is asserted separately in
// the second half rather than conflated with the detector.

import { chromium } from "playwright";

const BASE = process.env.ALERT_BASE ?? "http://127.0.0.1:8000";
const PAGE = `${BASE}/phone-alert.html`;

let pass = 0;
let fail = 0;
const ok = (m) => { pass++; console.log(`  ok   ${m}`); };
const bad = (m) => { fail++; console.log(`  FAIL ${m}`); };
const check = (m, c) => (c ? ok(m) : bad(m));

// ---- the sensor we control --------------------------------------------------
//
// The page reads cfg().url, which defaults to the proxied "/sensor/data". We
// intercept that one path and serve whatever the test wants the door to be
// doing. Everything else passes through to the real demo server untouched.
//
// `alarm` is controlled independently of `open`, exactly as the firmware does:
// the door can be open without yet being an alarm.

let door = { open: false, alarm: false };
let reads = 0;

const browser = await chromium.launch();
// No touch emulation in this half.
//
// The page auto-unlocks Web Audio on the first `touchstart` so an elder never
// has to hunt for 啟用音效. Playwright's click() on a touch-enabled context
// therefore unlocks audio as a side effect, and once audio is live a genuine
// alarm deliberately rings straight through to the call screen — navigating
// away mid-session. This half is about the *detector*, and drives several door
// events in one session, so it runs in a plain context where the unlock stays
// manual and the alert screen stays put. The ring-through is asserted for real
// in the second half, with an explicit tap.
const ctx = await browser.newContext({
  viewport: { width: 390, height: 844 },
  hasTouch: false,
  isMobile: false,
});
const page = await ctx.newPage();

const errors = [];
page.on("pageerror", (e) => errors.push(e.message));

// Count alarms that tried to leave the page, and (while armed) keep the alert
// page put for the detector half.
//
// An alarm now ALWAYS navigates to the call screen — that is the fix the user
// asked for. The detector half still needs several door events in one live
// document, so while `holdPage` is true the navigation is intercepted and
// counted instead of being allowed through. The detector, the cooldown and the
// notify path all still run for real; only the departure is held.
//
// `holdPage` is switched off for the final half, where the real navigation to
// the call screen is the thing being asserted.
let alarmFires = 0;
let holdPage = true;

await page.route("**/phone-call.html*", async (route) => {
  alarmFires++;
  if (holdPage) return void (await route.fulfill({ status: 204, body: "" }));
  await route.continue();
});

await page.route("**/sensor/data", async (route) => {
  reads++;
  await route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      fsr: door.open ? (door.alarm ? 3900 : 2500) : 40,
      open: door.open,
      alarm: door.alarm,
      ts: new Date().toISOString(),
    }),
  });
});

/**
 * How many times the page raised an alarm in the current session.
 *
 * `alarmFires` is reset by session(), so each half starts from zero and a count
 * from an earlier half cannot leak in.
 */
async function alarmCount() {
  let fromLog = 0;
  try {
    const text = await page.innerText("#log");
    fromLog = (text.match(/🚨 警報/g) ?? []).length;
  } catch {
    // The document navigated away; the interception counter still holds.
  }
  return Math.max(fromLog, alarmFires);
}

/**
 * Starts a clean session with the given door state.
 *
 * `cooldown` is the page's own anti-repeat window — a separate rule from the
 * rising-edge detector, and it lives in localStorage. This test legitimately
 * re-arms a genuine *second* door event a few seconds after the first, so the
 * window must be shortened to its 10s floor or the cooldown — not the detector
 * — is what decides the outcome.
 *
 * The page calls loadCfg() at boot, which restores every field from
 * localStorage *after* the DOM is parsed, so writing the input directly is
 * clobbered. Seeding storage is both the reliable way and the faithful one:
 * it is exactly how a real operator's saved setting reaches the page.
 *
 * Every field the test depends on is written explicitly here, so no half of
 * the test can leak state into another through the saved config.
 *
 * `start` is deliberate rather than automatic: the ring-through case has to
 * unlock audio *before* monitoring begins, because the decision to ring is
 * taken during the very first poll.
 */
async function session(initial, { cooldown = 10, autoCall = false, start = true } = {}) {
  await page.goto(PAGE, { waitUntil: "domcontentloaded" });
  await page.evaluate(
    ({ cd, ac }) => {
      const raw = localStorage.getItem("doorAlert.cfg");
      const o = raw ? JSON.parse(raw) : {};
      // Must match CFG_VERSION in public/phone-alert.html. loadCfg() discards
      // a config whose version differs outright, so a stale value here makes the
      // seeding below a no-op and the page silently falls back to its HTML
      // defaults — the test then passes by coincidence rather than by design.
      o.v = 6;
      o.cooldown = String(cd);
      o.autoCall = ac;
      localStorage.setItem("doorAlert.cfg", JSON.stringify(o));
    },
    { cd: cooldown, ac: autoCall },
  );
  await page.reload({ waitUntil: "domcontentloaded" });
  door = { ...initial };
  alarmFires = 0; // each session counts its own alarms
  if (start) await page.click("#start");
}

/**
 * Starts a detector session that survives navigation.
 *
 * An alarm now ALWAYS navigates to the call screen — that is the behaviour the
 * user asked for. The detector half of this test still needs to watch several
 * door events without the page being torn down mid-episode, so it taps the
 * sensor the page reads and asserts on the *decision*, not on where the page
 * went. To make that possible the test stubs navigation away: `openCall` is
 * left alone in the product, and this harness simply keeps the alert page put.
 *
 * The real navigation is asserted for real further down.
 */
async function sessionNoCall(initial) {
  await session(initial, { autoCall: false });
}

// The page polls every 2s in the demo config. This is a generous multiple.
const POLL_WAIT = 2600;

// The page's anti-repeat cooldown, pinned to its 10s floor by session(). A
// second genuine door event has to outlast it, not just the poll interval.
const COOLDOWN_WAIT = 11_000;

/* ---------------- (a) door open, sensor not alarming yet: must WAIT --------- */

// No 啟用音效 tap in this half. Without a user gesture the browser forbids
// autoplay, so the page cannot ring through and it stays on the alert screen —
// which is precisely what lets us drive several door events in one session and
// watch the detector on its own, without a navigation in the middle.

console.log("\n--- door open but the sensor has not tripped its 15s timer");
await sessionNoCall({ open: true, alarm: false });
await page.waitForTimeout(POLL_WAIT);

check("the page did poll the sensor", reads > 0);
check("starting with the door merely open does NOT fire", (await alarmCount()) === 0);

// Staying open must still not fire, since the sensor has not called it.
await page.waitForTimeout(POLL_WAIT);
check("the door staying open (not alarming) does not fire", (await alarmCount()) === 0);

// Now the firmware's own 15-second timer trips. That must fire.
door = { open: true, alarm: true };
await page.waitForTimeout(POLL_WAIT);
check("when the sensor finally asserts alarm, it DOES fire", (await alarmCount()) === 1);

// And it must not fire again while the same alarm persists.
await page.waitForTimeout(POLL_WAIT);
check("the same persisting alarm fires only once", (await alarmCount()) === 1);

/* ---------- (a2) closing the door ends the episode ------------------------- */

door = { open: false, alarm: false };
await page.waitForTimeout(POLL_WAIT);
check("closing the door does not fire", (await alarmCount()) === 1);

/* ------- (b) sensor ALREADY alarming at start: must fire on the first poll -- */

// This is the regression the user reported: the ESP32 latches `alarm`, so
// every session started while the door was open saw `alarm: true` immediately
// and the old baseline sweep suppressed it forever.
console.log("\n--- sensor already alarming when monitoring starts");
await sessionNoCall({ open: true, alarm: true });
await page.waitForTimeout(POLL_WAIT);
const firedAtStart = await alarmCount();
if (firedAtStart === 0) {
  const log = await page.innerText("#log");
  console.log("       page log:\n         " + log.split("\n").slice(-8).join("\n         "));
}
check("an already-alarming sensor fires on the first poll", firedAtStart === 1);

await page.waitForTimeout(POLL_WAIT);
check("and does not fire repeatedly for the same alarm", (await alarmCount()) === 1);

/* ------------------- and it reaches the call screen when audio is on ------- */

/*
 * ------- (c) with audio unlocked, a fire rings through to the call ----------
 *
 * This is the end-to-end path the user actually cares about: the sensor says
 * the door is dangerous, and the phone rings the elder. It needs the config a
 * real device has — 自動彈出關懷來電 on — plus the 啟用音效 tap, because a
 * browser will not let a background timer start audio without a gesture.
 */

console.log("\n--- with audio unlocked, a fire rings through to the call");

// The real navigation is what is being asserted from here on, so stop holding
// the page: an alarm must now genuinely reach the call screen.
holdPage = false;

await session({ open: true, alarm: true }, { autoCall: true, start: false });

// Unlock audio first. The decision to ring through is taken during the first
// poll, so monitoring must not have started yet.
await page.click("#enableAudio");
await page.waitForTimeout(300);
check("audio is unlocked", await page.evaluate(() => window.__elderLinkAlert.S.audioReady));

let rangTo = null;
page.on("framenavigated", (f) => {
  if (f === page.mainFrame() && /phone-call\.html/.test(f.url())) rangTo = f.url();
});

await page.click("#start");
await page.waitForTimeout(POLL_WAIT * 2); // fireAlarm waits 2.5s before ringing

check("an already-alarming sensor rings through to the call screen", rangTo !== null);
if (rangTo) {
  check("the ring carries the sensor trigger", rangTo.includes("trigger=sensor"));
  check("the ring carries the elder id", /elder=[0-9a-f-]{8,}/i.test(rangTo));
  check("the call screen renders", await page.isVisible("#acceptBtn"));
} else {
  const log = await page.innerText("#log").catch(() => "");
  console.log("       page log:\n         " + log.split("\n").slice(-8).join("\n         "));
}

/* ---------------------------------------------------- the page stayed clean */

check("no uncaught page errors", errors.length === 0);
if (errors.length) console.log("       " + errors.slice(0, 3).join("\n       "));

await browser.close();
console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
