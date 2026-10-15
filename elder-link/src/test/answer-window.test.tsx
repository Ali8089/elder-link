/**
 * Regression tests for the answer-window / voice-answer race.
 *
 * The bug: the give-up timer was armed when the question was asked and fired
 * unconditionally at ANSWER_WINDOW_MS, never checking the current stage. An
 * elder who pressed "Answer by voice" late would still be recording or waiting
 * on transcription (RECORDING_MS + up to 32s of CPU recognition) when the timer
 * fired — it wrote no_answer and advanced the beat, and the transcript then
 * advanced the beat a second time. A real answer was discarded and a script line
 * was skipped.
 *
 * The window is now an *idle* window: it suspends while `stage === "listening"`
 * and only gives up while the call is genuinely awaiting a reply. These tests
 * pin both halves — that a slow answer survives (b), and that a genuinely
 * unanswered call still gives up (a). (b) fails against the old code; (a) guards
 * against "fixing" the race by disabling give-up entirely.
 *
 * Timers are faked. React effects only run at act() boundaries, so the scripted
 * beats are driven with a stepped helper rather than one large advance.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import {
  CantoneseDemoCall,
  ANSWER_WINDOW_MS,
  RECORDING_MS,
  type DemoCallResult,
} from "@/components/CantoneseDemoCall";
import type { Transcription, VoiceEngine } from "@/lib/voice";

/** A voice engine whose transcription resolves only when the test tells it to. */
function controlledVoiceEngine() {
  let resolve: ((t: Transcription) => void) | undefined;
  const engine: VoiceEngine = {
    name: "mock",
    async speak() {
      return null;
    },
    transcribe: () =>
      new Promise<Transcription>((res) => {
        resolve = res;
      }),
  };
  return { engine, resolve: (t: Transcription) => resolve?.(t) };
}

/**
 * Audio that reports "ended" the moment it plays.
 *
 * The component adds its `ended` listener *before* calling `play()`, so emitting
 * synchronously resolves `playLine` without relying on real playback or on
 * microtask scheduling that fake timers might interfere with.
 */
function installAudioMock() {
  class MockAudio {
    src: string;
    volume = 1;
    loop = false;
    paused = true;
    currentTime = 0;
    private listeners: Record<string, (() => void)[]> = {};
    constructor(src: string) {
      this.src = src;
    }
    addEventListener(type: string, cb: () => void) {
      (this.listeners[type] ??= []).push(cb);
    }
    play() {
      this.paused = false;
      (this.listeners["ended"] ?? []).forEach((cb) => cb());
      return Promise.resolve();
    }
    pause() {
      this.paused = true;
    }
  }
  vi.stubGlobal("Audio", MockAudio as unknown as typeof Audio);
}

/** Microphone + recorder so `startListening()` can run under jsdom. */
function installMediaMocks() {
  class MockMediaRecorder {
    state: "inactive" | "recording" = "inactive";
    mimeType = "audio/webm";
    private listeners: Record<string, ((e?: unknown) => void)[]> = {};
    constructor(_stream: unknown) {}
    addEventListener(type: string, cb: (e?: unknown) => void) {
      (this.listeners[type] ??= []).push(cb);
    }
    start() {
      this.state = "recording";
    }
    stop() {
      this.state = "inactive";
      (this.listeners["stop"] ?? []).forEach((cb) => cb());
    }
  }
  vi.stubGlobal("MediaRecorder", MockMediaRecorder as unknown as typeof MediaRecorder);
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: { getUserMedia: vi.fn(async () => ({ getTracks: () => [] })) },
  });
}

/** Advance fake time inside act, flushing the effects each step unlocks. */
async function step(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

/** Drive the call from "Start call" to the point where it is awaiting an answer. */
async function reachAwaiting() {
  screen.getByRole("button", { name: /start call/i }).click();
  await step(1_200); // dialling → speaking
  await step(1_600); // disclosure plays, then its pause → ask
  await step(0); // ask plays → awaiting
  expect(screen.getByRole("button", { name: /answer by voice/i })).toBeTruthy();
}

/** Let the remaining scripted beats play out to the end of the call. */
async function playOut() {
  for (let i = 0; i < 8; i += 1) await step(5_000);
}

function renderCall(onComplete: (r: DemoCallResult) => void, voiceEngine: VoiceEngine) {
  render(<CantoneseDemoCall elderName="陳婆婆" onComplete={onComplete} voiceEngine={voiceEngine} />);
}

describe("answer window vs. slow voice answers", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    installAudioMock();
    installMediaMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("still gives up on an elder who never answers", async () => {
    const onComplete = vi.fn();
    renderCall(onComplete, controlledVoiceEngine().engine);
    await reachAwaiting();

    // The idle window expires with no response…
    await step(ANSWER_WINDOW_MS + 1);
    // …then the no_answer line and the goodbye play out.
    await playOut();

    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(onComplete.mock.calls[0]?.[0]).toMatchObject({ outcome: "no_answer", answered: false });
  });

  it("keeps a slow voice answer that arrives after the idle window would have expired", async () => {
    const onComplete = vi.fn();
    const voice = controlledVoiceEngine();
    renderCall(onComplete, voice.engine);
    await reachAwaiting();

    // The elder starts answering just before the window would expire.
    await step(40_000);
    await act(async () => {
      screen.getByRole("button", { name: /answer by voice/i }).click();
    });
    await step(0);

    // Cross the original 45s deadline while still recording, then stop
    // recording; transcription is now in flight and slow.
    await step(6_000);
    await step(RECORDING_MS);

    // Let the whole idle window — and everything after it — elapse while the
    // answer is still being transcribed. On the buggy code the give-up fires
    // here, plays the no_answer line, and ends the call, recording the elder as
    // unanswered; on the fixed code the window is suspended and nothing happens.
    await playOut();

    // The answer finally lands — long after the idle window would have elapsed.
    await act(async () => {
      voice.resolve({ text: "我冇事" });
    });
    await step(0);
    await playOut();

    // The real answer is applied once, not overwritten by a no_answer give-up.
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(onComplete.mock.calls[0]?.[0]).toMatchObject({ outcome: "safe", answered: true });
  });
});
