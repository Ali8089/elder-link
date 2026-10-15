/**
 * Real-browser end-to-end test of the Cantonese check-in call.
 *
 * Written because mocked component tests gave false confidence: the closing
 * music "passed" while being silent in the real app, because the mock did not
 * reproduce the Hang-up handler calling stopMusic(). This drives an actual
 * Chromium against the actual dev server, with the real audio elements, and
 * asserts on what the browser actually did.
 *
 * Run with the dev server up:
 *   node scripts/e2e-call.mjs
 */
import { chromium } from "playwright";

const BASE = process.env.E2E_BASE ?? "http://127.0.0.1:5173";
const out = [];
const log = (ok, msg) => {
  out.push({ ok, msg });
  console.log(`${ok ? "PASS" : "FAIL"}  ${msg}`);
};

/** Waits for a condition, polling, so the test does not depend on fixed sleeps. */
async function until(fn, { timeout = 20000, interval = 200 } = {}) {
  const start = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - start > timeout) return null;
    await new Promise((r) => setTimeout(r, interval));
  }
}

const browser = await chromium.launch();
const page = await browser.newPage();

// Capture everything the browser reports, so a silent failure is visible.
const consoleErrors = [];
const pageErrors = [];
const failedRequests = [];
const abortedMedia = [];
page.on("console", (m) => {
  if (m.type() === "error") consoleErrors.push(m.text());
});
page.on("pageerror", (e) => pageErrors.push(e.message));
page.on("requestfailed", (r) => {
  // A ranged/streamed media request is routinely cancelled by the browser once
  // enough of the file has been buffered, and the HEAD probes below are issued
  // by this test itself. Neither is a defect, so they must not be counted as
  // failed requests or the check cries wolf every run.
  if (r.method() === "HEAD") return;
  if (r.failure()?.errorText === "net::ERR_ABORTED") {
    abortedMedia.push(r.url());
    return;
  }
  failedRequests.push(`${r.url()} :: ${r.failure()?.errorText}`);
});

// Record every Audio element the page constructs, and whether it was played.
await page.addInitScript(() => {
  window.__audio = [];
  const RealAudio = window.Audio;
  window.Audio = function (src) {
    const el = new RealAudio(src);
    window.__audio.push({ src: String(src), played: false, el });
    const realPlay = el.play.bind(el);
    el.play = () => {
      const rec = window.__audio.find((a) => a.el === el);
      if (rec) rec.played = true;
      return realPlay();
    };
    return el;
  };
  window.Audio.prototype = RealAudio.prototype;
  window.__synth = { spoken: [] };
  const realSpeak = window.speechSynthesis?.speak?.bind(window.speechSynthesis);
  if (realSpeak) {
    window.speechSynthesis.speak = (u) => {
      window.__synth.spoken.push(u.text);
      return realSpeak(u);
    };
  }
});

console.log(`\n=== E2E: ${BASE} ===\n`);

// --- Load -------------------------------------------------------------------
await page.goto(`${BASE}/test-controls`, { waitUntil: "domcontentloaded" });
const loaded = await until(async () => (await page.locator("body").innerText()).length > 100);
log(!!loaded, "page loads and renders content");

// --- The call is present ---------------------------------------------------
const startBtn = page.getByRole("button", { name: /start call/i });
const hasStart = await until(async () => (await startBtn.count()) > 0);
log(!!hasStart, "Start call button is present");

if (!hasStart) {
  console.log("\nCannot continue without the call component. Body was:\n");
  console.log((await page.locator("body").innerText()).slice(0, 1200));
  await browser.close();
  process.exit(1);
}

// --- Check whether voice input is on offer ---------------------------------
await startBtn.click();

// --- Answer safe, on the keypad --------------------------------------------
const key1 = page.getByRole("button", { name: /^1\b/ });
const keyAppeared = await until(async () => (await key1.count()) > 0, { timeout: 40000 });
log(!!keyAppeared, "keypad appears and the call waits for an answer");

// --- Is voice on offer, once the call is actually at the answer stage? ------
// The voice control belongs to the answer stage, so it can only be judged
// here. Checking earlier measured the dialling/speaking beats and reported a
// missing button that had simply not been reached yet.
const voiceBtn = page.getByRole("button", { name: /answer by voice/i });
const voiceOffNote = page.locator("text=/Voice answers are off/i");
const voiceOffered = (await voiceBtn.count()) > 0;
const voiceExplained = !voiceOffered && (await voiceOffNote.count()) > 0;
log(
  voiceOffered || voiceExplained,
  voiceOffered
    ? "voice input is offered at the answer stage (recogniser configured)"
    : voiceExplained
      ? "voice input is off and EXPLAINED on screen"
      : "voice state unresolved: neither a working button nor an explanation",
);

// --- The answer window is long --------------------------------------------
// Confirm the call is still open several seconds later, rather than having
// ended on its own. This is the "ends too quickly" regression.
if (keyAppeared) {
  await page.waitForTimeout(6000);
  const stillOpen = (await page.getByRole("button", { name: /^1\b/ }).count()) > 0;
  log(stillOpen, "call is still waiting 6s after the question (does not end early)");

  const countdownShown = (await page.locator("text=/line held open for/i").count()) > 0;
  log(countdownShown, "a countdown is shown while waiting");
  await page.screenshot({ path: "e2e-shots/waiting.png" });
}

// --- Answer "safe", then hang up, and check the music actually plays --------
// The music is deliberately limited to the safe path, so the test has to
// actually answer safely — hanging up while still unanswered is a no_answer
// call and must NOT play music. (Getting this wrong is what made an earlier
// version of this test assert on a path that can never play music.)
if (keyAppeared) {
  await page.getByRole("button", { name: /^1\b/ }).click();
  const answered = await until(
    async () => (await page.locator("text=/Answered/i").count()) > 0,
    { timeout: 10000 },
  );
  log(!!answered, "pressing 1 records a safe answer");
}

// Let the closing lines speak, then hang up.
await page.waitForTimeout(2500);
const hangBtn = page.getByRole("button", { name: /hang up/i });
if (await hangBtn.count()) {
  await hangBtn.first().click();
}

const musicPlayed = await until(async () =>
  page.evaluate(() => window.__audio.some((a) => a.src.includes("closing-music") && a.played)),
  { timeout: 15000 },
);
log(!!musicPlayed, "closing music PLAYS after a safe call");

const musicAnnounced = await until(
  async () => (await page.locator("text=/Closing music playing/i").count()) > 0,
  { timeout: 5000 },
);
log(!!musicAnnounced, "music is announced in the UI");

// Is the music element actually progressing through the track?
const musicProgress = await page.evaluate(() => {
  const rec = window.__audio.find((a) => a.src.includes("closing-music"));
  if (!rec) return null;
  return { paused: rec.el.paused, currentTime: rec.el.currentTime, volume: rec.el.volume };
});
await page.waitForTimeout(1500);
const musicProgress2 = await page.evaluate(() => {
  const rec = window.__audio.find((a) => a.src.includes("closing-music"));
  if (!rec) return null;
  return { paused: rec.el.paused, currentTime: rec.el.currentTime, volume: rec.el.volume };
});
const advanced = (musicProgress2?.currentTime ?? 0) > (musicProgress?.currentTime ?? 0);
log(
  advanced,
  `music is audibly advancing (t=${musicProgress?.currentTime?.toFixed(2)}s → ${musicProgress2?.currentTime?.toFixed(2)}s, vol=${musicProgress2?.volume?.toFixed(2)}, paused=${musicProgress2?.paused})`,
);

await page.screenshot({ path: "e2e-shots/ended.png" });

// --- Speech clips actually load --------------------------------------------
const clipStatus = await page.evaluate(async () => {
  const files = ["disclosure", "ask", "safe", "worry", "danger", "unclear", "no_answer", "close"];
  const res = {};
  for (const f of files) {
    try {
      const r = await fetch(`/audio/${f}.mp3`, { method: "HEAD" });
      res[f] = r.status;
    } catch (e) {
      res[f] = `err:${e.message}`;
    }
  }
  return res;
});
const badClips = Object.entries(clipStatus).filter(([, s]) => s !== 200);
log(badClips.length === 0, `all 8 speech clips load (${JSON.stringify(clipStatus)})`);

// --- Speech route availability ---------------------------------------------
const speechRoute = await page.evaluate(async () => {
  const r = await fetch("/api/speech/transcribe");
  return { status: r.status, body: await r.json().catch(() => null) };
});
log(
  speechRoute.status === 200,
  `speech route answers: ${speechRoute.status} ${JSON.stringify(speechRoute.body)}`,
);

// --- Report errors ----------------------------------------------------------
console.log("\n--- browser diagnostics ---");
console.log(`console errors : ${consoleErrors.length}`);
consoleErrors.slice(0, 10).forEach((e) => console.log(`   ${e}`));
console.log(`page errors    : ${pageErrors.length}`);
pageErrors.slice(0, 10).forEach((e) => console.log(`   ${e}`));
console.log(`failed requests: ${failedRequests.length}`);
failedRequests.slice(0, 10).forEach((e) => console.log(`   ${e}`));
console.log(`aborted media  : ${abortedMedia.length} (expected: streaming aborts)`);

// A missing audio file or a broken route shows up here.
const realProblems = failedRequests.filter((f) => f.includes("/audio/") || f.includes("/api/"));
log(realProblems.length === 0, `no failed audio/api requests (${realProblems.length})`);

await browser.close();

const failed = out.filter((r) => !r.ok);
console.log(`\n=== ${out.length - failed.length}/${out.length} checks passed ===\n`);
process.exit(failed.length === 0 ? 0 : 1);
