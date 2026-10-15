/**
 * Tests for the transcribe route's upstream timeout.
 *
 * The property worth guarding is a regression property, not a feature: the
 * default must stay large enough for CPU Whisper inference. QA measured a
 * single clip at 18–32s on CPU, so the old 25s cloud-era ceiling aborted healthy
 * local transcriptions and the elder's call failed with a 502. These tests pin
 * the default high enough that a working local server is never cut off, and pin
 * the override so it stays a deliberate opt-in.
 */
import { describe, expect, it } from "vitest";
import { resolveTimeoutMs } from "@/routes/api/speech/transcribe";

/** QA's measured worst case for one clip on CPU, in milliseconds. */
const MEASURED_WORST_CASE_MS = 32_000;

describe("transcribe upstream timeout", () => {
  it("defaults to a value generous enough for CPU inference", () => {
    // Must clear the measured worst case with real headroom, not merely equal it.
    expect(resolveTimeoutMs({})).toBeGreaterThanOrEqual(120_000);
    expect(resolveTimeoutMs({})).toBeGreaterThan(MEASURED_WORST_CASE_MS);
  });

  it("honours SPEECH_TO_TEXT_TIMEOUT_MS when it is a sane positive number", () => {
    expect(resolveTimeoutMs({ SPEECH_TO_TEXT_TIMEOUT_MS: "30000" })).toBe(30_000);
    expect(resolveTimeoutMs({ SPEECH_TO_TEXT_TIMEOUT_MS: "120000" })).toBe(120_000);
  });

  it("falls back to the generous default for a malformed or non-positive override", () => {
    // A NaN/0/negative timeout would abort every request instantly — worse than
    // ignoring the typo — so each of these must resolve to the safe default.
    for (const bad of ["", "abc", "0", "-5", "NaN"]) {
      expect(resolveTimeoutMs({ SPEECH_TO_TEXT_TIMEOUT_MS: bad })).toBeGreaterThanOrEqual(120_000);
    }
  });
});
