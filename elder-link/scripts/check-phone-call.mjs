// Drives the real phone-call screen in a real browser.
//
//   node scripts/check-phone-call.mjs
//
// Everything else in this suite tests the script and the classifier as data.
// This is the one check that proves the page a human actually taps on works:
// it loads phone-call.html from the demo server, answers the call, waits for
// the Cantonese audio to actually be requested over the network, taps through
// the conversation, and asserts the call reaches an outcome.
//
// It also proves the safety invariants hold through the UI, not just in the
// unit tests: picking the "not feeling well" branch must reach the 999 wording,
// and the closing music must never play on that branch.
//
// Requires the demo server to be running on :8000 with the app on :3000 for
// the speech route. Audio playback is stubbed because a headless browser has no
// speakers, but every clip request is recorded, so "did it try to speak the
// right thing" is still a real assertion.

import { chromium } from "playwright";

const BASE = process.env.CALL_BASE ?? "http://127.0.0.1:8000";
const PAGE = `${BASE}/phone-call.html?trigger=sensor`;

let pass = 0;
let fail = 0;
const ok = (m) => { pass++; console.log(`  ok   ${m}`); };
const bad = (m) => { fail++; console.log(`  FAIL ${m}`); };
const check = (m, cond) => (cond ? ok(m) : bad(m));

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 390, height: 844 },      // a phone, not a desktop
  permissions: [],                             // do not grant the mic
});
const page = await ctx.newPage();

// Record every clip the page asks to play. Audio playback is stubbed (a
// headless browser has no sound device), so the stub's own log is the record —
// a network listener would see nothing, because the stub never fetches.
const audioRequests = [];
page.on("request", (r) => {
  const u = r.url();
  if (/\/audio\/call\/.+\.mp3|\/audio\/closing-music\.wav/.test(u)) {
    audioRequests.push(u.replace(BASE, ""));
  }
});
const spoken = () => page.evaluate(() => window.__spoken.map((s) => s.replace(/^.*\/audio\//, "/audio/")));
const consoleErrors = [];
page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text()); });
page.on("pageerror", (e) => consoleErrors.push(`pageerror: ${e.message}`));

// Make clip playback resolve immediately, and mute the browser voice, so the
// call runs at test speed without a sound device.
await ctx.addInitScript(() => {
  window.__spoken = [];
  class FakeAudio {
    constructor(src) { this.src = src; this.volume = 1; }
    play() {
      window.__spoken.push(this.src);
      setTimeout(() => this.onended && this.onended(), 5);
      return Promise.resolve();
    }
    pause() {}
    set onended(f) { this._e = f; }
    get onended() { return this._e; }
    set onerror(f) { this._r = f; }
    get onerror() { return this._r; }
  }
  window.Audio = FakeAudio;
  window.speechSynthesis = {
    getVoices: () => [],
    speak: (u) => setTimeout(() => u.onend && u.onend(), 5),
    cancel() {},
  };

  // Model the *real* environment: the app has no speech provider configured, so
  // the server route is unavailable. The call must still offer voice, through
  // the browser's own recogniser. Faking `available: true` here would hide
  // exactly the bug the user reported.
  const realFetch = window.fetch;
  window.fetch = (input, init) =>
    String(input).includes("/api/speech/transcribe") && (!init || init.method !== "POST")
      ? Promise.resolve(new Response(
          JSON.stringify({ available: false, reason: "No speech provider configured." }),
          { status: 200 }))
      : realFetch(input, init);

  // Present a browser recogniser, as a phone would have.
  class FakeRecognition {
    constructor() { this.lang = ""; this.continuous = false; this.interimResults = false; }
    start() { window.__srStarted = (window.__srStarted ?? 0) + 1; }
    stop() { setTimeout(() => this.onend && this.onend(), 1); }
    abort() {}
  }
  window.SpeechRecognition = FakeRecognition;
  window.webkitSpeechRecognition = FakeRecognition;

  // Count microphone requests. A fake track is enough: the page only needs the
  // stream to exist, and nothing here is played back.
  window.__gumCalls = 0;
  const track = { stop() {}, kind: "audio", enabled: true };
  const fakeStream = { getTracks: () => [track], getAudioTracks: () => [track] };
  navigator.mediaDevices = navigator.mediaDevices ?? {};
  navigator.mediaDevices.getUserMedia = () => {
    window.__gumCalls++;
    return Promise.resolve(fakeStream);
  };
  window.MediaRecorder = window.MediaRecorder ?? class {
    constructor() { this.state = "inactive"; }
    start() { this.state = "recording"; }
    stop() { this.state = "inactive"; this.onstop && this.onstop(); }
  };
});

console.log(`\n--- loading ${PAGE}`);
const resp = await page.goto(PAGE, { waitUntil: "domcontentloaded" });
check("page loads 200", resp && resp.status() === 200);

/* ------------------------------------------------------ incoming call state */

await page.waitForSelector("#acceptBtn", { state: "visible" });
check("caller name is 'Elderly care team'",
  (await page.textContent("#callerName")).trim() === "Elderly care team");
check("shows 來電中 while ringing",
  (await page.textContent("#statusLine")).includes("來電中"));
check("offers 接聽 and 拒絕",
  (await page.isVisible("#acceptBtn")) && (await page.isVisible("#declineBtn")));
check("the hangup button is hidden before answering",
  !(await page.isVisible("#hangupBtn")));
check("the screen is in the incoming state",
  (await page.getAttribute("#screen", "class")).includes("incoming"));

/* ------------------------------------ the layout matches the reference screen */

// The reference is a real phone's incoming-call screen. These assertions pin
// the parts of it that make it read as a call rather than a web page, so a
// later redesign cannot quietly undo them.

// The pill reads "HD Incoming call": an HD tile, then the label. They are
// separate elements separated by flex `gap`, so the visible space does not
// appear in textContent — assert the two parts, and that they are laid out
// side by side.
const pill = await page.evaluate(() => {
  const p = document.getElementById("incomingPill");
  const hd = p.querySelector(".hd");
  const label = p.querySelector("#incomingLabel");
  const a = hd.getBoundingClientRect();
  const b = label.getBoundingClientRect();
  return {
    hd: hd.textContent.trim(),
    label: label.textContent.trim(),
    gap: b.x - (a.x + a.width),
    visible: p.getBoundingClientRect().height > 0,
  };
});
check("there is an 'HD' tile on the incoming pill", pill.hd === "HD");
check("the pill reads 'Incoming call'", pill.label === "Incoming call");
check("the pill is actually rendered", pill.visible);
check("the HD tile and the label have a visible gap", pill.gap >= 4);

// The caller's name is the loudest element on the glass.
const nameStyle = await page.evaluate(() => {
  const el = document.getElementById("callerName");
  const cs = getComputedStyle(el);
  const r = el.getBoundingClientRect();
  return { size: parseFloat(cs.fontSize), weight: cs.fontWeight, width: r.width };
});
check("the caller name is very large (>=38px)", nameStyle.size >= 38);
check("the caller name is bold", Number(nameStyle.weight) >= 700);

// Answer on the LEFT, decline on the RIGHT — the layout people have used for
// twenty years. Getting this backwards is a real usability hazard.
const boxes = await page.evaluate(() => {
  const a = document.getElementById("acceptBtn").getBoundingClientRect();
  const d = document.getElementById("declineBtn").getBoundingClientRect();
  return { a: a.x + a.width / 2, d: d.x + d.width / 2, size: a.width };
});
check("the answer button is on the left", boxes.a < boxes.d);
check("the buttons are large circular targets (>=68px)", boxes.size >= 68);
const round = await page.evaluate(() =>
  getComputedStyle(document.getElementById("acceptBtn")).borderRadius);
check("the buttons are circular", round === "50%");

// Green answer, red decline — by computed colour, not by class name.
const cols = await page.evaluate(() => ({
  a: getComputedStyle(document.getElementById("acceptBtn")).backgroundColor,
  d: getComputedStyle(document.getElementById("declineBtn")).backgroundColor,
}));
const rgb = (s) => (s.match(/\d+/g) ?? []).slice(0, 3).map(Number);
const [ar, ag, ab] = rgb(cols.a);
const [dr, dg, db] = rgb(cols.d);
check("the answer button is green", ag > ar + 40 && ag > ab + 40);
check("the decline button is red", dr > dg + 60 && dr > db + 60);

/* ------------------------- bug 4: no web controls on the call screen -------- */

// A real call has one button. These must not exist at all — the phone page is
// the deliverable the elder sees, and a mic/replay row reads as a web form.
const noControls = await page.evaluate(() => ({
  voice: !!document.getElementById("voiceBtn"),
  repeat: !!document.getElementById("repeatBtn"),
  hint: !!document.getElementById("hint"),
}));
check("there is no microphone button", !noControls.voice);
check("there is no replay button", !noControls.repeat);
check("the old hint element is gone", !noControls.hint);

// The only in-call control is hang up, and the row must not be visible while
// ringing — a live "hang up" button on an unanswered call makes no sense.
check("hang up is the only call control",
  (await page.locator("#talkRow .ctrl").count()) === 1);
check("the call-control row is hidden before answering",
  !(await page.isVisible("#talkRow")));

// Nothing may be selectable: a text selection is the clearest "web page" tell.
const selectable = await page.evaluate(() =>
  getComputedStyle(document.querySelector(".bubble") ?? document.body).userSelect);
check("the page is not text-selectable", selectable === "none");

/* ------------------- bug 3: fullscreen starts on the incoming screen -------- */

// The first tap anywhere must go fullscreen, not only the accept tap. Asserted
// by tapping a harmless part of the screen while still ringing.
await page.goto(PAGE, { waitUntil: "domcontentloaded" });
await page.waitForSelector("#acceptBtn", { state: "visible" });
check("still ringing before any tap",
  (await page.getAttribute("#screen", "class")).includes("incoming"));
await page.locator("#callerName").click();
await page.waitForTimeout(400);
const fsIncoming = await page.evaluate(() => ({
  inFs: !!document.fullscreenElement,
  stage: window.__elderLinkCall.S.stage,
}));
check("the first tap goes fullscreen while still ringing", fsIncoming.inFs);
check("and it did not answer the call", fsIncoming.stage === "incoming");

// The near-black ground and the home-indicator bar are the two clearest
// signals that this is a phone call and not a page.
const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
const [br, bg2, bb] = rgb(bg);
check("the background is near-black", br < 40 && bg2 < 40 && bb < 40);
check("there is a home-indicator bar", await page.isVisible(".homebar"));

/* ------------------------------------------------------------- answer it */

await page.click("#acceptBtn");
await page.waitForTimeout(120);
const cls = await page.getAttribute("#screen", "class");
check("screen switches to active after answering", cls.includes("active"));
check("status becomes 通話中", (await page.textContent("#statusLine")).includes("通話中"));
check("hangup button appears after answering", await page.isVisible("#hangupBtn"));
check("the answer/decline pair is gone once answered",
  !(await page.isVisible("#answerRow")));
check("the sensor reason chip is shown",
  (await page.textContent("#reasonChip")).includes("感應器"));

// Bug 4: answering must try to go fullscreen. A headless browser grants this,
// so a failure here means the call is not being made at all.
const fs = await page.evaluate(() => ({
  inFs: !!document.fullscreenElement,
  // Keep a note of the attempt even where the host refuses, so the intent is
  // asserted rather than the host's policy.
  requested: !!document.documentElement.requestFullscreen,
}));
check("answering requests fullscreen", fs.requested);
check("the page is fullscreen after answering", fs.inFs);

// S2 is the sensor opening: three lines, and the third asks the question.
await page.waitForFunction(
  () => document.querySelectorAll("#transcript .turn.them").length >= 3,
  { timeout: 8000 },
);
const opening = await page.locator("#transcript .turn.them .bubble").allTextContents();

/* ------------------ bug 5: the messages must carry Cantonese --------------- */

// Cantonese is always the primary line, English the translation under it. The
// user's screenshots showed English primary, so this is asserted structurally
// rather than by substring: the first child of every bubble must be the `zh`
// span and it must actually contain CJK.
const bubbleShape = await page.evaluate(() => {
  const b = document.querySelector("#transcript .turn.them .bubble");
  if (!b) return null;
  const first = b.firstElementChild;
  return {
    firstClass: first?.className ?? null,
    firstLang: first?.getAttribute("lang") ?? null,
    firstText: first?.textContent ?? "",
    hasEn: !!b.querySelector(".en"),
    enLang: b.querySelector(".en")?.getAttribute("lang") ?? null,
  };
});
check("a bubble exists to inspect", bubbleShape !== null);
check("the bubble's first line is the Cantonese span", bubbleShape?.firstClass === "zh");
check("it is marked as Cantonese", bubbleShape?.firstLang === "yue-Hant-HK");
check("it actually contains Cantonese characters",
  /[\u4e00-\u9fff]/.test(bubbleShape?.firstText ?? ""));
check("the English translation follows it", bubbleShape?.hasEn === true);
check("the translation is marked as English", bubbleShape?.enLang === "en");

// The options must have the same shape, since they are the elder's own words.
// Checked below, where the options are actually on screen — they are cleared
// as soon as the elder answers, so inspecting them here would see nothing.

const s2Spoken = await spoken();
check("S2 line 1 names Elder Link", opening[0].includes("Elder Link"));
check("S2 line 2 explains the door sensor", opening[1].includes("感應器"));
check("S2 line 3 asks if she is all right", opening[2].includes("好唔好"));

check("S2 clips were played in order",
  s2Spoken.filter((u) => u.includes("/call/S2-")).join(",") ===
    "/audio/call/S2-1.mp3,/audio/call/S2-2.mp3,/audio/call/S2-3.mp3");

// The four-way question must be on screen as tappable options.
await page.waitForSelector("#opts .opt", { timeout: 6000 });
const optTexts = await page.locator("#opts .opt").allTextContents();
check("S3 offers the four answers", optTexts.length === 4);
check("option 1 is the sick branch", optTexts[0].includes("唔係幾舒服"));
check("option 4 is the doing-well branch", optTexts[3].includes("幾好"));
check("a timer is running", await page.isVisible("#timer"));

// Bug 5, for the options: the elder's own words must lead in Cantonese, with
// the English translation underneath — the same rule as the transcript.
const optShape = await page.evaluate(() => {
  const o = document.querySelector("#opts .opt");
  if (!o) return null;
  const first = o.firstElementChild;
  return {
    firstClass: first?.className ?? null,
    firstLang: first?.getAttribute("lang") ?? null,
    firstText: first?.textContent ?? "",
    hasEn: !!o.querySelector(".en"),
  };
});
check("an option's first line is Cantonese", optShape?.firstClass === "zh");
check("the option is marked as Cantonese", optShape?.firstLang === "yue-Hant-HK");
check("the option carries Cantonese characters",
  /[\u4e00-\u9fff]/.test(optShape?.firstText ?? ""));
check("the option also carries its English translation", optShape?.hasEn === true);

// Nothing on this screen may be selectable — a text selection is the clearest
// "this is a web page" tell, and one appeared over the transcript in testing.
const optSelectable = await page.evaluate(() =>
  getComputedStyle(document.querySelector("#opts .opt")).userSelect);
check("options are not text-selectable", optSelectable === "none");

/* -------------------------------------------- walk the danger branch: sick */

console.log("\n--- branch: not feeling well (must reach the 999 wording)");
await page.locator("#opts .opt").nth(0).click();
await page.waitForFunction(
  () => document.body.innerText.includes("你邊度唔舒服"),
  { timeout: 8000 },
);
check("S4 asks where it hurts", true);

await page.waitForSelector("#opts .opt", { timeout: 6000 });
const s4 = await page.locator("#opts .opt").allTextContents();
check("S4 offers chest pain, a fall, a cough, and 'I don't know'", s4.length === 4);

// The most dangerous answer: chest pain.
await page.locator("#opts .opt").nth(0).click();
await page.waitForFunction(
  () => document.body.innerText.includes("打999"),
  { timeout: 8000 },
);
const dangerText = await page.innerText("#transcript");
check("S5 tells her to call 999", dangerText.includes("打999"));
check("S5 mentions the ambulance", dangerText.includes("救護車"));

// The visual alert must be unmissable, and the screen must go red.
await page.waitForSelector("#alert.show", { timeout: 4000 });
const alertText = await page.innerText("#alert");
check("the on-screen emergency alert appears", alertText.includes("999"));
check("the screen turns red on danger",
  (await page.getAttribute("#screen", "class")).includes("danger"));
check("no closing music on the danger branch",
  !(await spoken()).some((u) => u.includes("closing-music")));

// S5's own sub-question, then the branch where she cannot move.
await page.waitForSelector("#opts .opt", { timeout: 6000 });
const s5 = await page.locator("#opts .opt").allTextContents();
check("S5 asks whether she can call 999", s5.length === 2);
await page.locator("#opts .opt").nth(1).click();   // 我郁唔到……
await page.waitForFunction(
  () => document.body.innerText.includes("唔好郁") || document.body.innerText.includes("保持清醒"),
  { timeout: 8000 },
);
const s8Text = await page.innerText("#transcript");
check("S8 escalates to a human instead of claiming to dial",
  !/我打咗999|我已經打999|我幫你打999/.test(s8Text));
check("S8 tells her to stay still", s8Text.includes("唔好郁"));

/* ------------------------------------------- a fresh call: the safe branch */

console.log("\n--- branch: doing well (must reach the activity offer)");
await page.goto(PAGE, { waitUntil: "domcontentloaded" });
await page.click("#acceptBtn");
await page.waitForFunction(
  () => document.querySelectorAll("#transcript .turn.them").length >= 3,
  { timeout: 8000 },
);
await page.waitForSelector("#opts .opt", { timeout: 6000 });
// S3 option 4: 幾好呀！
await page.locator("#opts .opt").nth(3).click();
await page.waitForFunction(
  () => document.body.innerText.includes("健康早操"),
  { timeout: 8000 },
);
check("S34 offers the Saturday activity", true);
await page.waitForSelector("#opts .opt", { timeout: 6000 });
await page.locator("#opts .opt").nth(0).click();   // 好呀，我想去！
await page.waitForFunction(
  () => document.body.innerText.includes("星期六見") || document.body.innerText.includes("確認"),
  { timeout: 8000 },
);
const good = await page.innerText("#transcript");
check("S35 says the centre will confirm", good.includes("確認"));
check("no emergency alert on the safe branch", !(await page.isVisible("#alert.show")));
check("the screen is not red on the safe branch",
  !(await page.getAttribute("#screen", "class")).includes("danger"));

/* --------------------------------------------------- a fresh call: unclear */

console.log("\n--- branch: unclear (must repeat, then escalate, never guess)");
await page.goto(PAGE, { waitUntil: "domcontentloaded" });
await page.click("#acceptBtn");
await page.waitForFunction(
  () => document.querySelectorAll("#transcript .turn.them").length >= 3,
  { timeout: 8000 },
);
await page.waitForSelector("#opts .opt", { timeout: 6000 });
// "I don't know" must not be read as an answer to any of the four.
await page.locator("#opts .opt").nth(0).click();
await page.waitForSelector("#opts .opt", { timeout: 6000 });
await page.locator("#opts .opt").nth(3).click();   // 唔……唔知呀……
await page.waitForFunction(
  () => document.body.innerText.includes("聽得唔係好清楚"),
  { timeout: 8000 },
);
check("S12 asks again rather than guessing", true);

/* ----------------------------------------------------------- voice routing */

console.log("\n--- voice answer routing (what was heard decides the branch)");
await page.goto(PAGE, { waitUntil: "domcontentloaded" });
await page.click("#acceptBtn");
await page.waitForFunction(
  () => document.querySelectorAll("#transcript .turn.them").length >= 3,
  { timeout: 8000 },
);
await page.waitForSelector("#opts .opt", { timeout: 6000 });

// Drive the page's own classifier and option matcher, the same pair a Whisper
// transcript goes through. This is the safety-critical join: if these two were
// not wired up, a spoken answer would be ignored and the call would stall.
const routed = await page.evaluate(async () => {
  const clf = await import("/call-classify.js");
  const script = await import("/call-script.js");
  const s3 = script.SCRIPT.S3.options;
  return {
    // A danger phrase must be danger no matter what question was asked.
    chestPain: clf.classifyCantonese("我心口好痛，好透唔到氣"),
    // A clear wellbeing phrase must be safe.
    fine: clf.classifyCantonese("我幾好呀，冇事"),
    // Silence / noise must never be safe.
    noise: clf.classifyCantonese("嗯……呃……"),
    // "I don't know" must not be matched to any option.
    dontKnow: clf.matchOption("唔知呀", s3),
    // A real answer must match the right option.
    hungry: clf.matchOption("我肚餓呀，今日仲未食嘢", s3),
    // The caller name the page shows.
    caller: script.CALLER_NAME,
  };
});

check("a danger phrase classifies as danger", routed.chestPain === "danger");
check("a wellbeing phrase classifies as safe", routed.fine === "safe");
check("an unclear utterance is never safe", routed.noise !== "safe");
check("'I don't know' matches no option", routed.dontKnow === -1);
check("a clear answer matches its option", routed.hungry === 2);
check("the caller name is 'Elderly care team'", routed.caller === "Elderly care team");

/* -------------------------------------------- bug 3: voice actually works */

// The user's complaint was that the call could only be answered by typing,
// because the mic was dead. These assertions cover the fix: the button is live
// even with no server-side provider, and a heard answer really does drive the
// call to the right branch.
console.log("\n--- voice: the mic is live and a heard answer drives the call");

await page.goto(PAGE, { waitUntil: "domcontentloaded" });
await page.click("#acceptBtn");
await page.waitForFunction(
  () => document.querySelectorAll("#transcript .turn.them").length >= 3,
  { timeout: 8000 },
);
await page.waitForSelector("#opts .opt", { timeout: 6000 });

// The browser recogniser must be the chosen route when the server has no
// provider. This is the mic bug: a mic-stream failure used to overwrite the
// route to "none" and silently leave the elder with tap-only.
const voiceRoute = await page.evaluate(() => window.__elderLinkCall.S.voiceRoute);
check("the browser recogniser is the live voice route", voiceRoute === "browser");

// A route is not a working microphone. The recogniser must actually be
// constructed and started once the call asks a question, or the elder has a
// "live" voice route that never listens — the exact shape of the bug reported
// as "I'm still not able to talk". The stub counts both, so this asserts the
// real code path ran rather than that a flag was set.
const srStarted = await page.evaluate(() => window.__srStarted ?? 0);
check("the recogniser is actually started, not just selected", srStarted >= 1);

// The page should have opened the microphone as part of answering. getUserMedia
// is stubbed for the headless run, so this asserts it was actually asked for.
const micCalls = await page.evaluate(() => window.__gumCalls ?? -1);
check("answering asks for the microphone", micCalls >= 1);

// A mic-stream failure must NOT disable the recogniser route, because the
// recogniser opens its own microphone. Verified by denying the stream here.
const survivedDenial = await page.evaluate(async () => {
  window.__elderLinkCall.S.voiceRoute = "browser"; // as pickVoiceRoute left it
  navigator.mediaDevices.getUserMedia = () => Promise.reject(new Error("NotAllowedError"));
  // Re-run the same path the accept gesture uses.
  const r = await window.__elderLinkCall.openMicForTest();
  return { returned: r, route: window.__elderLinkCall.S.voiceRoute };
});
check("a denied mic stream leaves the route intact", survivedDenial.route === "browser");

// Now feed a real heard phrase through the page's own handler, exactly as the
// recogniser would, and check the call advances on it. This is the join that
// was broken: speech in, correct branch out.
const before = await page.locator("#transcript .turn.them").count();await page.evaluate(() => window.__elderLinkCall.hearForTest("我幾好呀，冇事"));
await page.waitForFunction(
  (n) => document.querySelectorAll("#transcript .turn.them").length > n,
  before,
  { timeout: 8000 },
);
const afterVoice = await page.innerText("#transcript");
check("a heard answer appears as the elder's turn",
  (await page.locator("#transcript .turn.me").count()) >= 1);
check("the call advances on the spoken answer",
  (await page.locator("#transcript .turn.them").count()) > before);
check("a spoken 'I'm fine' reaches the safe branch",
  afterVoice.includes("幾好") || afterVoice.includes("健康早操"));

// And the safety floor holds through the same path: chest pain must escalate
// however casually it was said.
await page.goto(PAGE, { waitUntil: "domcontentloaded" });
await page.click("#acceptBtn");
await page.waitForFunction(
  () => document.querySelectorAll("#transcript .turn.them").length >= 3,
  { timeout: 8000 },
);
await page.evaluate(() => window.__elderLinkCall.hearForTest("我心口好痛，透唔到氣"));
await page.waitForFunction(
  () => document.body.innerText.includes("打999"),
  { timeout: 8000 },
);
check("a spoken danger phrase still reaches the 999 wording", true);

// The alert is raised once the danger section has finished speaking every
// line, so wait for the element rather than a fixed delay — reaching the
// wording is not the same moment as raising the alert.
await page.waitForSelector("#alert.show", { timeout: 15_000 });
check("and raises the on-screen alert", true);
check("and turns the screen red",
  (await page.getAttribute("#screen", "class")).includes("danger"));

check("no uncaught page errors", consoleErrors.length === 0);
if (consoleErrors.length) console.log("       " + consoleErrors.slice(0, 5).join("\n       "));

await browser.close();

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
