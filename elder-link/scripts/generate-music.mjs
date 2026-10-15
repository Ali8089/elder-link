// Renders the closing music for the check-in call.
//
//   node scripts/generate-music.mjs           # write if missing
//   node scripts/generate-music.mjs --force   # overwrite
//
// Produces public/audio/closing-music.wav — a short, gentle Cantonese-style
// phrase in the 五聲音階 (five-tone pentatonic scale) that traditional Cantonese
// music uses. Rendered offline from sine/plucked-string synthesis, so:
//
//   - There is no third-party recording and therefore no licence to clear.
//     The melody and the rendering are both original to this project.
//   - The output ships with the code, so nothing is fetched at runtime.
//   - It can be regenerated or retuned by editing the notes below.
//
// Deliberately restrained: low volume, slow attack, and it resolves upward so it
// reads as "all is well" rather than as a funeral dirge. It is only ever played
// after a SAFE check-in — see MUSIC_OUTCOMES in src/lib/voice.ts.

import { writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const outFile = join(root, "public", "audio", "closing-music.wav");
const FORCE = process.argv.includes("--force");

if (existsSync(outFile) && !FORCE) {
  console.log("closing-music.wav exists — use --force to regenerate.");
  process.exit(0);
}

const SAMPLE_RATE = 44100;

// 五聲音階 (pentatonic) on D — the scale traditional Cantonese melodies favour.
// Cents offsets relative to the tonic, then the tonic pitch in Hz.
// D4 = 293.66 Hz. The phrase rises and settles, which sounds reassuring.
const D4 = 293.66;
const SEMITONE = 2 ** (1 / 12);

/** note name -> semitones above D4. */
const P = { D: 0, E: 2, G: 5, A: 7, C: 10, D5: 12, E5: 14, G5: 17 };

/**
 * A shortphrase: gentle climb, small pause, warm landing on the tonic.
 * [semitones above D4, start beat, length in beats]
 */
const MELODY = [
  [P.G, 0.0, 1.0],
  [P.A, 1.0, 0.5],
  [P.C, 1.5, 0.5],
  [P.D5, 2.0, 1.5],
  [P.C, 3.5, 0.5],
  [P.A, 4.0, 1.0],
  [P.G, 5.0, 0.5],
  [P.A, 5.5, 0.5],
  [P.D5, 6.0, 2.0],
];

/** A slow drone a fifth below, which is idiomatic and softens the tone. */
const DRONE = [P.D - 12, P.A - 12];
const BEAT = 0.62; // seconds per beat
const TOTAL = 8.4; // beats, with room for the final note to decay

function pluck(freq, t, dur) {
  // Additive approximation of a plucked string: fundamental plus a few
  // harmonics that die away faster than the fundamental.
  const env = Math.exp(-t * 3.1) * (1 - Math.exp(-t * 220)); // slow attack, long tail
  if (t > dur) return 0;
  let s = 0;
  s += 1.0 * Math.sin(2 * Math.PI * freq * t);
  s += 0.34 * Math.sin(2 * Math.PI * freq * 2 * t) * Math.exp(-t * 4.2);
  s += 0.14 * Math.sin(2 * Math.PI * freq * 3 * t) * Math.exp(-t * 6.0);
  s += 0.07 * Math.sin(2 * Math.PI * freq * 4 * t) * Math.exp(-t * 8.5);
  return s * env;
}

function drone(freq, t) {
  // Quiet sustained bed with a slow tremolo, so it breathes rather than hums.
  const trem = 0.82 + 0.18 * Math.sin(2 * Math.PI * 0.28 * t);
  return (
    (0.5 * Math.sin(2 * Math.PI * freq * t) + 0.12 * Math.sin(2 * Math.PI * freq * 2 * t)) *
    trem *
    0.5
  );
}

const totalSamples = Math.ceil(TOTAL * BEAT * SAMPLE_RATE);
const samples = new Float64Array(totalSamples);

for (let i = 0; i < totalSamples; i++) {
  const t = i / SAMPLE_RATE;
  let v = 0;
  for (const [st, startBeat, lenBeats] of MELODY) {
    const freq = D4 * SEMITONE ** st;
    v += pluck(freq, t - startBeat * BEAT, lenBeats * BEAT) * 0.42;
  }
  for (const st of DRONE) {
    v += drone(D4 * SEMITONE ** st, t) * 0.14;
  }
  samples[i] = v;
}

// Normalise to a comfortable ceiling, then apply a long fade-out so the track
// never ends abruptly.
let peak = 0;
for (const s of samples) peak = Math.max(peak, Math.abs(s));
const gain = peak > 0 ? 0.72 / peak : 1;

const FADE_OUT = 2.2 * SAMPLE_RATE;
const FADE_IN = 0.5 * SAMPLE_RATE;
const out = Buffer.alloc(44 + totalSamples * 2);

for (let i = 0; i < totalSamples; i++) {
  let v = samples[i] * gain;
  if (i < FADE_IN) v *= i / FADE_IN;
  const fromEnd = totalSamples - i;
  if (fromEnd < FADE_OUT) v *= fromEnd / FADE_OUT;
  v = Math.max(-1, Math.min(1, v));
  out.writeInt16LE(Math.round(v * 32767), 44 + i * 2);
}

// Minimal 16-bit mono PCM WAV header.
const dataBytes = totalSamples * 2;
out.write("RIFF", 0, "ascii");
out.writeUInt32LE(36 + dataBytes, 4);
out.write("WAVE", 8, "ascii");
out.write("fmt ", 12, "ascii");
out.writeUInt32LE(16, 16);
out.writeUInt16LE(1, 20); // PCM
out.writeUInt16LE(1, 22); // mono
out.writeUInt32LE(SAMPLE_RATE, 24);
out.writeUInt32LE(SAMPLE_RATE * 2, 28); // byte rate
out.writeUInt16LE(2, 32); // block align
out.writeUInt16LE(16, 34); // bits per sample
out.write("data", 36, "ascii");
out.writeUInt32LE(dataBytes, 40);

mkdirSync(dirname(outFile), { recursive: true });
writeFileSync(outFile, out);

const secs = (totalSamples / SAMPLE_RATE).toFixed(1);
console.log(`Wrote closing-music.wav — ${secs}s, ${(out.length / 1024).toFixed(0)} kB`);
console.log("Original composition, no third-party rights. Safe to ship.");
