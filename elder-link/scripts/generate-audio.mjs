// Build-time audio generation for the Elder Link check-in script.
//
// Reads the Cantonese lines from src/lib/script.ts and synthesises one MP3 per
// line, then writes them to public/audio/. The result is committed alongside
// the code, so a fresh clone plays real audio without running this step.
//
//   node scripts/generate-audio.mjs            # generate anything missing
//   node scripts/generate-audio.mjs --force    # regenerate everything
//
// Re-run this whenever a line's wording changes. Filenames derive from the
// script ids, so a renamed line gains a new file; stale files are reported.
//
// Provider: Google Translate's speech endpoint (client=tw-ob).
//   - Genuinely free, no API key, no account, no quota.
//   - `tl=yue` produces real Cantonese, not Mandarin read aloud.
//   - Needs no WebSocket, so it works where Edge-TTS's synthesis socket is
//     blocked (Edge-TTS returns 403 on the handshake in some networks).
// The trade-off is a slight mechanical quality versus a premium neural voice.
// To swap in a better voice later, keep the same output filenames and replace
// only this script — nothing in src/ needs to change.

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const outDir = join(root, "public", "audio");

/** Cantonese. `yue` is the ISO 639-3 code Google's endpoint accepts. */
const LANG = "yue";
/** tw-ob is the client id the public endpoint expects; no key required. */
const CLIENT = "tw-ob";
const ENDPOINT = "https://translate.google.com/translate_tts";

const FORCE = process.argv.includes("--force");

// The endpoint rejects very long single requests, and a whole script line in
// one breath sounds rushed. Split on sentence punctuation, synthesise each
// fragment, then concatenate — MP3 frames join cleanly with no container fixup.
const MAX_CHARS = 180;

/** Pulls the Cantonese strings out of the CALL_SCRIPT literal in script.ts. */
function readScriptLines() {
  const src = readFileSync(join(root, "src", "lib", "script.ts"), "utf8");
  const start = src.indexOf("export const CALL_SCRIPT");
  if (start === -1) throw new Error("CALL_SCRIPT not found in src/lib/script.ts");
  const end = src.indexOf("\n];", start);
  const block = src.slice(start, end === -1 ? src.length : end);
  const re = /\{\s*id:\s*"([^"]+)",\s*zh:\s*"((?:[^"\\]|\\.)*)"/g;
  const lines = [];
  for (const m of block.matchAll(re)) {
    lines.push({ id: m[1], zh: m[2].replace(/\\"/g, '"').replace(/\\\\/g, "\\") });
  }
  if (lines.length === 0) throw new Error("No lines parsed from CALL_SCRIPT");
  return lines;
}

/** Splits a line into speakable fragments that stay under the endpoint's cap. */
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

async function synthesize(text) {
  const url =
    `${ENDPOINT}?ie=UTF-8&client=${CLIENT}&tl=${LANG}` +
    `&q=${encodeURIComponent(text)}`;
  const res = await fetch(url, {
    headers: {
      // The endpoint rejects requests without a browser-like UA.
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
      Referer: "https://translate.google.com/",
    },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length === 0) throw new Error("empty response body");
  return buf;
}

const lines = readScriptLines();
mkdirSync(outDir, { recursive: true });

console.log(`Provider: Google Translate TTS (free, no key)`);
console.log(`Language: ${LANG} (Cantonese)`);
console.log(`Output:   ${outDir}\n`);

let made = 0;
let skipped = 0;
const failures = [];

for (const { id, zh } of lines) {
  const file = join(outDir, `${id}.mp3`);
  if (existsSync(file) && !FORCE) {
    console.log(`  skip    ${id}.mp3 (exists — use --force to regenerate)`);
    skipped++;
    continue;
  }
  try {
    const pieces = [];
    for (const frag of fragment(zh)) pieces.push(await synthesize(frag));
    const audio = Buffer.concat(pieces);
    writeFileSync(file, audio);
    console.log(
      `  write   ${id}.mp3  (${(audio.length / 1024).toFixed(0)} kB, ${pieces.length} part(s))  «${zh.slice(0, 20)}…»`,
    );
    made++;
  } catch (e) {
    console.log(`  FAIL    ${id}.mp3  ${e.message}`);
    failures.push(id);
  }
}

// Warn about orphans so renamed lines don't leave dead audio behind.
const known = new Set([...lines.map((l) => `${l.id}.mp3`), "closing-music.mp3"]);
const stale = readdirSync(outDir).filter((f) => f.endsWith(".mp3") && !known.has(f));
if (stale.length) console.log(`\nStale files no longer used by the script: ${stale.join(", ")}`);

console.log(`\nDone — ${made} written, ${skipped} skipped, ${failures.length} failed.`);
if (failures.length) {
  console.error(`Failed: ${failures.join(", ")}`);
  process.exitCode = 1;
}
