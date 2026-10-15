// Walkthrough capture: drives the app in Chromium and screenshots each step so
// the sensor -> call path can be seen rather than described.
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const BASE = process.env["APP_URL"] ?? "http://127.0.0.1:5173";
const OUT = "artifacts/walkthrough";
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

page.on("console", (m) => {
  if (m.type() === "error") console.log(`  [console error] ${m.text().slice(0, 140)}`);
});

const step = async (name, action) => {
  await action();
  await page.waitForTimeout(1200);
  const file = `${OUT}/${name}.png`;
  await page.screenshot({ path: file, fullPage: true });
  console.log(`captured ${file}  <- ${page.url()}`);
};

await step("01-home", async () => {
  await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
});
console.log("  title:", await page.title());

await step("02-test-controls", async () => {
  await page.goto(`${BASE}/test-controls`, { waitUntil: "domcontentloaded" });
});

await step("03-elders", async () => {
  await page.goto(`${BASE}/elders`, { waitUntil: "domcontentloaded" });
});

await browser.close();
console.log("done");
