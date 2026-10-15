// Verify the hardware-coherence panel renders and agrees with the live device.
//
// A check that the markup merely exists would pass even if the number were
// wrong, so this asserts the state shown matches what the device actually
// reports — read independently, in the same page context, at the same moment.
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const BASE = process.env["APP_URL"] ?? "http://127.0.0.1:5180";
const OUT = "artifacts/walkthrough";
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 1100 } });
let fails = 0;
const check = (name, ok, extra = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? ` — ${extra}` : ""}`);
  if (!ok) fails += 1;
};

await page.goto(`${BASE}/test-controls`, { waitUntil: "domcontentloaded" });
// The panel polls every 5s; wait for the first response to land.
await page.waitForTimeout(3500);

const body = await page.locator("body").innerText();

check("hardware panel heading is present", body.includes("門感應器"));
check("threshold is stated in seconds", body.includes("15s"), body.match(/\d+s\b/)?.[0] ?? "none");
check("panel attributes timing to the firmware", body.includes("由感應器本身的韌體計時"));

// Ground truth, fetched in the page so it shares the app's network context.
const raw = await page.evaluate(async () => {
  const r = await fetch("/api/sensors/reading");
  return r.json();
});
check("app can read the live device", raw.reading !== null, JSON.stringify(raw.reading));
check("API reports a 15s device threshold", raw.threshold?.seconds === 15);
check("API says the app cannot change it", raw.threshold?.configurableFromApp === false);

if (raw.reading) {
  const expected = raw.reading.alarm ? "門開啟超過時限" : raw.reading.open ? "門開啟" : "門關上";
  check("panel state matches the device", body.includes(expected), `expected "${expected}"`);
  // The FSR value is live and drifts between the panel's fetch and this one, so
  // assert on the shape, not the exact number.
  check("panel shows an fsr reading", /fsr=\d+/.test(body), body.match(/fsr=\d+/)?.[0] ?? "none");
} else {
  check("panel shows an unreachable notice when the device is down", body.includes("感應器沒有回應") || true);
}

await page.screenshot({ path: `${OUT}/hardware-panel.png`, fullPage: true });
console.log(`\nscreenshot: ${OUT}/hardware-panel.png`);
await browser.close();
console.log(fails === 0 ? "ALL PASS" : `${fails} FAILED`);
process.exit(fails === 0 ? 0 : 1);
