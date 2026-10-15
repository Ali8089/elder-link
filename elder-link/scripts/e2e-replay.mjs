/**
 * Real-browser test of the call replay.
 *
 * Written for the same reason as e2e-call.mjs: a mocked component test can pass
 * while the real thing is silent. This drives a real Chromium against the real
 * dev server and asserts on what the browser actually did — specifically, that
 * the <audio> element's currentTime advances, which is the only proof that
 * sound is coming out rather than merely that a button exists.
 *
 * Run with the dev server up:
 *   NO_PROXY="127.0.0.1,localhost" node scripts/e2e-replay.mjs
 */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const BASE = (process.env["E2E_BASE"] ?? "http://127.0.0.1:5173").replace(/\/+$/, "");
/**
 * Elder path. Defaults to 周伯's seeded demo-store id. Git Bash mangles a
 * leading-slash env value into a Windows path, so tolerate a value that has
 * been prefixed with a drive/dir path by taking everything from the last
 * "/elders/" onward.
 */
const RAW_PATH = process.env["ELDER_PATH"] ?? "/elders/55555555-5555-4555-8555-555555555555";
const ELDER_PATH = (() => {
  const idx = RAW_PATH.lastIndexOf("/elders/");
  const tail = idx >= 0 ? RAW_PATH.slice(idx) : RAW_PATH;
  return tail.startsWith("/") ? tail : `/${tail}`;
})();
const OUT = "e2e-shots";
mkdirSync(OUT, { recursive: true });

const out = [];
const log = (ok, msg) => {
  out.push({ ok, msg });
  console.log(`${ok ? "PASS" : "FAIL"}  ${msg}`);
};

/** Polls a condition so the test never depends on a fixed sleep. */
async function until(fn, { timeout = 20000, interval = 200 } = {}) {
  const start = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - start > timeout) return null;
    await new Promise((r) => setTimeout(r, interval));
  }
}

const browser = await chromium.launch({
  headless: process.env["HEADED"] !== "1",
  // The replay is a genuine user gesture, but allow autoplay regardless so a
  // headless run is never flaky about it.
  args: ["--autoplay-policy=no-user-gesture-required"],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

const consoleErrors = [];
const pageErrors = [];
const failedRequests = [];
page.on("console", (m) => {
  if (m.type() === "error") consoleErrors.push(m.text());
});
page.on("pageerror", (e) => pageErrors.push(e.message));
page.on("requestfailed", (r) => {
  // Streaming media aborts once enough is buffered; HEAD probes are ours.
  if (r.method() === "HEAD") return;
  if (r.failure()?.errorText === "net::ERR_ABORTED") return;
  failedRequests.push(`${r.url()} :: ${r.failure()?.errorText}`);
});

// Record every Audio the page constructs, exactly like e2e-call.mjs.
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
});

console.log(`\n=== E2E replay: ${BASE}${ELDER_PATH} ===\n`);

// --- Load the elder page ----------------------------------------------------
await page.goto(`${BASE}${ELDER_PATH}`, { waitUntil: "domcontentloaded" });
const loaded = await until(async () => (await page.locator("body").innerText()).length > 100);
log(!!loaded, "elder page loads and renders content");
console.log(`  title: ${await page.title()}  url: ${page.url()}`);
await page.screenshot({ path: `${OUT}/replay-history.png`, fullPage: true });
console.log(`  captured ${OUT}/replay-history.png`);

// --- The history table offers a replay control ------------------------------
const openBtns = page.locator('[data-testid^="replay-open-"]');
const anyOpen = await until(async () => (await openBtns.count()) > 0, { timeout: 15000 });
if (!anyOpen) {
  log(false, "a replay control is present in the call history");
  console.log("\nBody was:\n" + (await page.locator("body").innerText()).slice(0, 1200));
  await browser.close();
  process.exit(1);
}
const rows = await openBtns.count();
log(rows > 0, `call history offers replay for ${rows} recorded call(s)`);

// --- The queued job must offer NO playback ---------------------------------
// The seeded retry that never connected shows a disabled "no audio" button.
const noAudioBtn = page.locator("button", { hasText: /無錄音|no audio/i });
const noAudioShown = (await noAudioBtn.count()) > 0;
log(noAudioShown, "a job with no call shows a disabled 'no audio' control instead of playback");
if (noAudioShown) {
  const disabled = await noAudioBtn.first().isDisabled();
  log(disabled, "that 'no audio' control is disabled (cannot be pressed)");
  await page.screenshot({ path: `${OUT}/replay-queued.png`, fullPage: true });
  console.log(`  captured ${OUT}/replay-queued.png`);
} else {
  log(false, "expected a disabled 'no audio' control for the queued retry");
}

// --- Open the first recorded call ------------------------------------------
// Prefer the seeded SAFE job so the closing-music rule can be checked, since
// only the safe path earns the music. Fall back to whatever is first.
const SAFE_JOB_ID = "e5job0000-0000-4000-8000-000000000001";
const safeBtn = page.locator(`[data-testid="replay-open-${SAFE_JOB_ID}"]`);
const target = (await safeBtn.count()) > 0 ? safeBtn : openBtns;
if ((await safeBtn.count()) > 0) console.log("  replaying the seeded SAFE call (for the music rule)");
await target.first().click();
const dialog = page.getByRole("dialog");
const opened = await until(async () => (await dialog.count()) > 0, { timeout: 5000 });
log(!!opened, "clicking the replay control opens the replay dialog");

if (!opened) {
  console.log("\nBody was:\n" + (await page.locator("body").innerText()).slice(0, 1200));
  await browser.close();
  process.exit(1);
}

// The dialog must be honest about the elder's side.
const dialogText = await dialog.innerText();
const markedReconstruction = /重建|reconstructed/i.test(dialogText);
const saysNeverRecorded = /從未被錄音|never recorded/i.test(dialogText);
log(markedReconstruction, "the elder's reply is labelled as a reconstruction");
log(saysNeverRecorded, "the dialog states the elder's words were never recorded");

// The outcome badge and metadata are present.
const hasBadge = (await dialog.locator("text=/安全|安全|需關注|無人接聽|Safe|Worrying|No answer/i").count()) > 0;
log(hasBadge, "the outcome badge is shown");

await page.screenshot({ path: `${OUT}/replay-open.png`, fullPage: true });
console.log(`  captured ${OUT}/replay-open.png`);

// --- Press play and prove the audio advances --------------------------------
const playBtn = dialog.getByRole("button", { name: /播放通話|play call/i });
const hasPlay = (await playBtn.count()) > 0;
log(hasPlay, "a play control is offered for a recorded call");

if (hasPlay) {
  await playBtn.first().click();

  // The live call plays the disclosure clip first, from the same URL.
  const firstClipPlayed = await until(
    async () =>
      page.evaluate(() => window.__audio.some((a) => a.src.includes("/audio/") && a.played)),
    { timeout: 8000 },
  );
  log(!!firstClipPlayed, "pressing play starts an /audio/*.mp3 clip");

  // Read the real <audio> element and prove the track is advancing.
  const readAudio = () =>
    page.evaluate(() => {
      const el = document.querySelector('[data-testid="replay-audio"]');
      const rec = window.__audio.find((a) => a.src.includes("/audio/") && a.played && !a.el.paused);
      const target = rec?.el ?? el;
      if (!target) return null;
      return { src: target.src || "", paused: target.paused, currentTime: target.currentTime };
    });

  const a0 = await readAudio();
  await page.waitForTimeout(2500);
  const a1 = await readAudio();

  const advanced = a0 && a1 && a1.currentTime > a0.currentTime;
  log(
    !!advanced,
    `audio is audibly advancing (${a0?.src.split("/").pop()} t=${a0?.currentTime?.toFixed(2)}s → ` +
      `${a1?.currentTime?.toFixed(2)}s, paused=${a1?.paused})`,
  );
  log(!!a1 && a1.paused === false, "the audio element is not paused while playing");

  // --- Let the whole SAFE call run to completion and prove closing music ----
  // The first seeded job is the safe check-in. The assistant's side is
  // disclosure → ask → safe → close, then the closing music (safe path only).
  // The pre-generated clips are each ~10 s long and each line is followed by
  // its pause, so a full call takes ~45 s — budget generously for that.
  const musicPlayed = await until(
    async () => page.evaluate(() => window.__audio.some((a) => a.src.includes("closing-music") && a.played)),
    { timeout: 90000, interval: 500 },
  );
  log(!!musicPlayed, "closing music PLAYS once a full safe call finishes (safe-path rule)");

  if (musicPlayed) {
    const m0 = await page.evaluate(() => {
      const r = window.__audio.find((a) => a.src.includes("closing-music"));
      return r ? { currentTime: r.el.currentTime, volume: r.el.volume, paused: r.el.paused } : null;
    });
    await page.waitForTimeout(1500);
    const m1 = await page.evaluate(() => {
      const r = window.__audio.find((a) => a.src.includes("closing-music"));
      return r ? { currentTime: r.el.currentTime, volume: r.el.volume, paused: r.el.paused } : null;
    });
    const musicAdvanced = !!m0 && !!m1 && m1.currentTime > m0.currentTime;
    log(
      musicAdvanced,
      `closing music is audibly advancing (t=${m0?.currentTime?.toFixed(2)}s → ${m1?.currentTime?.toFixed(2)}s, vol=${m1?.volume?.toFixed(2)})`,
    );
  }

  await page.screenshot({ path: `${OUT}/replay-playing.png`, fullPage: true });
  console.log(`  captured ${OUT}/replay-playing.png`);

  // --- Step through and confirm the whole call is reconstructed ------------
  // Done AFTER the full play-through, so it cannot truncate the music check.
  const nextBtn = dialog.getByRole("button", { name: /下一句|next line/i });
  if ((await nextBtn.count()) > 0) {
    await dialog.getByRole("button", { name: /重新播放|restart/i }).first().click();
    await page.waitForTimeout(500);
    const before = await readAudio();
    await nextBtn.first().click();
    await page.waitForTimeout(1500);
    const after = await readAudio();
    const changed = !!before && !!after && before.src !== after.src;
    log(
      changed,
      `stepping to the next line plays a different clip (${before?.src.split("/").pop()} → ${after?.src.split("/").pop()})`,
    );
  }
}

// --- Report which clips were used -------------------------------------------
const playedClips = await page.evaluate(() => window.__audio.map((a) => a.src.split("/").pop()));
console.log(`  clips used: ${JSON.stringify(playedClips)}`);

// --- Diagnostics ------------------------------------------------------------
console.log("\n--- browser diagnostics ---");
console.log(`console errors : ${consoleErrors.length}`);
consoleErrors.slice(0, 10).forEach((e) => console.log(`   ${e}`));
console.log(`page errors    : ${pageErrors.length}`);
pageErrors.slice(0, 10).forEach((e) => console.log(`   ${e}`));
console.log(`failed requests: ${failedRequests.length}`);
failedRequests.slice(0, 10).forEach((e) => console.log(`   ${e}`));

const realProblems = failedRequests.filter((f) => f.includes("/audio/") || f.includes("/api/"));
log(realProblems.length === 0, `no failed audio/api requests (${realProblems.length})`);

await browser.close();

const failed = out.filter((r) => !r.ok);
console.log(`\n=== ${out.length - failed.length}/${out.length} checks passed ===\n`);
process.exit(failed.length === 0 ? 0 : 1);
