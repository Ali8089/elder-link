// Health probe for the staff app served through the demo proxy on :8000.
//
//   node scripts/check-app-proxy.mjs
//
// Loads /app/ in a real browser and asserts the three things that were broken
// in turn: the page styles itself, no asset 404s, and no module errors — in
// particular the "does not provide an export named 'default'" failure that a
// stripped Vite `?url` query string used to cause.

import { chromium } from "playwright";

const BASE = process.env.ALERT_BASE ?? "http://127.0.0.1:8000";
// The app lives at the ROOT now, not /app/. TanStack Router matches on
// window.location and has no basepath, so serving the app under /app/ makes
// the client router see an unmounted path and replace the page with its
// NotFound route the moment hydration runs — the SSR form shows for ~1s
// and then vanishes. Keep this at "/".
const APP_PATH = process.env.APP_PATH ?? "/";
const APP = `${BASE}${APP_PATH}`;

let pass = 0;
let fail = 0;
const ok = (m) => { pass++; console.log(`  ok   ${m}`); };
const bad = (m) => { fail++; console.log(`  FAIL ${m}`); };
const check = (m, c) => (c ? ok(m) : bad(m));

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

const failed = [];
const consoleErrors = [];
page.on("requestfailed", (r) => failed.push(`${r.url()} — ${r.failure()?.errorText}`));
page.on("response", (r) => { if (r.status() >= 400) failed.push(`${r.url()} — HTTP ${r.status()}`); });
page.on("pageerror", (e) => consoleErrors.push(e.message));
page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text()); });

await page.goto(APP, { waitUntil: "domcontentloaded" });
// let client-side hydration finish before asserting anything — the router only
// stops re-rendering once React takes over
await page.waitForTimeout(3000);

// 1. the document actually rendered
check("the app page loaded", page.url().replace(/\/$/, "") === APP.replace(/\/$/, ""));
check("a root element exists", await page.isVisible("#root, #app, main, body"));

// 2. it is styled, not a bare HTML skeleton
const styles = await page.evaluate(() => {
  const body = getComputedStyle(document.body);
  const h = document.querySelector("h1, h2, h3");
  const hs = h ? getComputedStyle(h) : null;
  return {
    bodyBg: body.backgroundColor,
    bodyFont: body.fontFamily,
    headingFont: hs ? hs.fontFamily : null,
    headingSize: hs ? hs.fontSize : null,
    stylesheetCount: document.styleSheets.length,
  };
});
check("the page has stylesheets", styles.stylesheetCount > 0);
check("the body is not the default white", styles.bodyBg !== "rgba(0, 0, 0, 0)" && styles.bodyBg !== "rgb(255, 255, 255)");
check("a heading uses a real font size", !!styles.headingSize && parseFloat(styles.headingSize) > 20);

// 3. no asset 404s (the unstyled-app regression)
check("no failed or 4xx/5xx requests", failed.length === 0);
if (failed.length) console.log("       " + failed.slice(0, 5).join("\n       "));

// 4. no module errors (the ?url stripping regression)
const moduleErrors = consoleErrors.filter((t) => /does not provide an export|Failed to fetch dynamically imported module|MIME type/i.test(t));
check("no module import errors", moduleErrors.length === 0);
if (moduleErrors.length) console.log("       " + moduleErrors.slice(0, 3).join("\n       "));
check("no uncaught page errors", consoleErrors.length === 0);
if (consoleErrors.length) console.log("       " + consoleErrors.slice(0, 3).join("\n       "));

// 5. the login form is present and posts to a live endpoint (the 404 regression)
const hasLogin = await page.evaluate(
  () => document.body.innerText.includes("登入") ||
        document.body.innerText.includes("登錄") ||
        !!document.querySelector('input[type="password"]'));
check("a login form is rendered", hasLogin);

// 6. submitting it actually reaches the app through this proxy. The password is
// deliberately wrong, so a correct outcome is the app's own rejection message —
// which proves the POST to /api/auth/login was forwarded and answered rather
// than 404'd or dropped.
//
// Two things make this timing-sensitive:
//  - React must hydrate before the click, or the button is inert and no
//    request fires at all.
//  - The login endpoint is RATE LIMITED (returns 429 after a few rapid
//    attempts). A 429 is still proof the POST reached the app and was
//    answered, so it counts as success — otherwise a busy test box produces
//    a false failure.
// (Do NOT wait for "networkidle" — Vite's HMR websocket keeps it open forever.)
const apiCalls = [];
page.on("response", (r) => { if (/\/api\/auth\//.test(r.url())) apiCalls.push(`${r.status()} ${new URL(r.url()).pathname}`); });
await page.waitForSelector('button[type="submit"]:not([disabled])', { timeout: 20000 }).catch(() => {});
await page.waitForTimeout(2500); // let hydration settle
// Use a UNIQUE throwaway address per run. This probe deliberately fails auth,
// and repeated failures trip the app's 15-minute brute-force lockout for that
// email+IP — so a fixed address would lock itself out after a few runs and
// fail spuriously. Never probe a real account either; that would lock a real
// user out.
const probeEmail = `proxy-probe-${Date.now()}-${Math.random().toString(36).slice(2)}@example.invalid`;
await page.fill('input[type="email"]', probeEmail).catch(() => {});
await page.fill('input[type="password"]', "definitely-not-the-password").catch(() => {});
await page.waitForTimeout(300);
await page.click('button[type="submit"]').catch(() => {});
// the POST plus the app's own re-render can take a beat through the proxy
for (let i = 0; i < 24 && apiCalls.length === 0; i++) await page.waitForTimeout(250);
check("the sign-in POST reached the app", apiCalls.length >= 1);
if (apiCalls.length) console.log("       " + apiCalls.join("\n       "));
const rateLimited = apiCalls.some((c) => c.startsWith("429"));
let rejected = rateLimited;
for (let i = 0; i < 20 && !rejected; i++) {
  rejected = await page.evaluate(() => {
    const s = document.querySelector("#form-status");
    return !!s && /失敗|failed|Sign-in|登入|Invalid email|Invalid|too many|rate/i.test(s.textContent ?? "");
  });
  if (!rejected) await page.waitForTimeout(250);
}
if (rateLimited) console.log("       login endpoint rate-limited the probe (429) — still reached the app");
check("the app rendered its own sign-in failure", rejected);

await browser.close();
console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
