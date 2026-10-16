// Generates Cantonese audio for the 44-section care-call script.
//
// Companion to scripts/generate-audio.mjs. That one reads the eight flat lines
// in src/lib/script.ts; this one reads the branching tree in
// public/call-script.js and writes one MP3 per *spoken line*, not per section —
// a section like S5 has four lines and they must play in order with a gap
// between them, exactly as a person would speak them.
//
//   node scripts/generate-call-audio.mjs            # fill in what's missing
//   node scripts/generate-call-audio.mjs --force    # regenerate everything
//   node scripts/generate-call-audio.mjs --only S2,S3   # just these sections
//
// Output: public/audio/call/<sectionId>-<n>.mp3   e.g. call/S5-2.mp3
//
// Same provider as the rest of the project: Google Translate's speech endpoint
// with tl=yue. Free, no key, real Cantonese. Lines over the endpoint's ~200
// character cap are split on punctuation and the MP3 frames concatenated.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const outDir = join(root, "public", "audio", "call");

const LANG = "yue";
const CLIENT = "tw-ob";
const ENDPOINT = "https://translate.google.com/translate_tts";
const MAX_CHARS = 180;

const FORCE = process.argv.includes("--force");
const onlyArg = process.argv.find((a) => a.startsWith("--only"));
const ONLY = onlyArg
  ? new Set(
      (onlyArg.includes("=") ? onlyArg.split("=")[1] : process.argv[process.argv.indexOf(onlyArg) + 1] ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    )
  : null;

/** Reads the SCRIPT object out of public/call-script.js by importing it. */
async function readScript() {
  const mod = await import(new URL("../public/call-script.js", import.meta.url).href);
  if (!mod.SCRIPT) throw new Error("SCRIPT not exported from public/call-script.js");
  return mod.SCRIPT;
}

function fragment(text) {
  if (text.length <= MAX_CHARS) return [text];
  const parts = text.split(/(?<=[。，！？；、])/u);
  const out = [];
  let buf = "";
  for (const p of parts) {
    if ((buf + p).length > MAX_CHARS && buf) {
      out.push(buf);
      buf = p;
    } else {
      buf += p;
    }
  }
  if (buf) out.push(buf);
  return out;
}

async function synthesize(text, attempt = 1) {
  const url =
    `${ENDPOINT}?ie=UTF-8&client=${CLIENT}&tl=${LANG}` +
    `&q=${encodeURIComponent(text)}`;
  const res = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
      Referer: "https://translate.google.com/",
    },
  });
  // The endpoint rate-limits bursts with 429; a short backoff clears it.
  if (res.status === 429 && attempt <= 3) {
    await new Promise((r) => setTimeout(r, 1200 * attempt));
    return synthesize(text, attempt + 1);
  }
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length === 0) throw new Error("empty response body");
  return buf;
}

const SCRIPT = await readScript();
mkdirSync(outDir, { recursive: true });

console.log("Provider: Google Translate TTS (free, no key)");
console.log(`Language: ${LANG} (Cantonese)`);
console.log(`Output:   ${outDir}`);
if (ONLY) console.log(`Only:     ${[...ONLY].join(", ")}`);
console.log("");

let made = 0;
let skipped = 0;
let failed = 0;
const manifest = {};

// Sections in numeric order so progress reads naturally (S1, S2, … S44).
const ids = Object.keys(SCRIPT).sort(
  (a, b) => parseInt(a.slice(1), 10) - parseInt(b.slice(1), 10),
);

for (const id of ids) {
  if (ONLY && !ONLY.has(id)) continue;
  const node = SCRIPT[id];
  const lines = node.say ?? [];
  manifest[id] = lines.map((_, n) => `call/${id}-${n + 1}.mp3`);
  for (let n = 0; n < lines.length; n++) {
    const file = join(outDir, `${id}-${n + 1}.mp3`);
    const zh = lines[n].zh;
    if (existsSync(file) && !FORCE) {
      skipped++;
      continue;
    }
    try {
      const pieces = [];
      for (const frag of fragment(zh)) pieces.push(await synthesize(frag));
      const audio = Buffer.concat(pieces);
      writeFileSync(file, audio);
      console.log(
        `  write   ${id}-${n + 1}.mp3  (${(audio.length / 1024).toFixed(0)} kB)  «${zh.slice(0, 18)}…»`,
      );
      made++;
      // Be a polite client; the endpoint is free and unauthenticated.
      await new Promise((r) => setTimeout(r, 350));
    } catch (e) {
      console.log(`  FAIL    ${id}-${n + 1}.mp3  ${e.message}`);
      failed++;
    }
  }
}

// A manifest lets the phone page know which clips exist without guessing. It is
// also the honest record of what has actually been recorded: the page reads it
// and speaks via the browser voice for any line with no clip, so a partially
// generated script still runs instead of falling into silence.
writeFileSync(
  join(outDir, "manifest.json"),
  JSON.stringify(manifest, null, 2) + "\n",
  "utf8",
);

console.log(`\nDone — ${made} written, ${skipped} skipped, ${failed} failed.`);
console.log(`Manifest: ${join(outDir, "manifest.json")}`);
if (failed) process.exitCode = 1;
