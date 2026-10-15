/**
 * Tests for the call replay.
 *
 * Two concerns are pinned here:
 *   1. the reconstruction itself — the assistant's side of a past call is a
 *      pure function of its outcome, so the sequence can be asserted directly;
 *   2. the honesty guard — a job that never connected must offer no playback,
 *      and the elder's side must be labelled as a reconstruction.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { I18nProvider } from "@/lib/i18n";
import { CallReplay, type ReplayJob } from "@/components/CallReplay";
import {
  buildCallSequence,
  isRecordedOutcome,
  reactionLineId,
  CALL_AUDIO,
  CLOSING_MUSIC_URL,
} from "@/lib/script";

// --- Audio harness ---------------------------------------------------------
// Mirrors src/test/closing-music.test.tsx: capture every Audio the component
// constructs and the URLs it was asked to play.

type FakeAudio = {
  src: string;
  volume: number;
  loop: boolean;
  paused: boolean;
  play: () => Promise<void>;
  pause: () => void;
  addEventListener: (type: string, cb: () => void, opts?: unknown) => void;
};

let created: FakeAudio[] = [];
let playCalls: string[] = [];

function installAudioMock() {
  created = [];
  playCalls = [];
  class MockAudio {
    src: string;
    volume = 1;
    loop = false;
    paused = true;
    private listeners: Record<string, (() => void)[]> = {};
    constructor(src: string) {
      this.src = src;
      const self = this;
      const fake: FakeAudio = {
        get src() { return self.src; },
        get volume() { return self.volume; },
        set volume(v: number) { self.volume = v; },
        get loop() { return self.loop; },
        set loop(v: boolean) { self.loop = v; },
        get paused() { return self.paused; },
        play: () => self.play(),
        pause: () => self.pause(),
        addEventListener: (t, cb) => self.addEventListener(t, cb),
      };
      created.push(fake);
    }
    addEventListener(type: string, cb: () => void) {
      (this.listeners[type] ??= []).push(cb);
    }
    private emit(type: string) {
      (this.listeners[type] ?? []).forEach((cb) => cb());
    }
    async play() {
      playCalls.push(this.src);
      this.paused = false;
      // Speech clips resolve immediately so the transcript advances.
      queueMicrotask(() => {
        if (this.src.endsWith(".mp3") || this.src.endsWith(".wav")) this.emit("ended");
      });
      return undefined;
    }
    pause() {
      this.paused = true;
    }
  }
  vi.stubGlobal("Audio", MockAudio as unknown as typeof Audio);
}

function playedClip(name: string): boolean {
  return playCalls.some((s) => s.includes(name));
}

const BASE_JOB: ReplayJob = {
  id: "job-1",
  kind: "scheduled",
  attempt: 1,
  status: "completed",
  outcome: "safe",
  activity_suggestion: null,
  due_at: new Date().toISOString(),
  started_at: new Date().toISOString(),
  completed_at: new Date().toISOString(),
  created_at: new Date().toISOString(),
};

function renderReplay(job: Partial<ReplayJob>, onClose = () => undefined) {
  return render(
    <I18nProvider>
      <CallReplay elderName="周伯" job={{ ...BASE_JOB, ...job }} onClose={onClose} />
    </I18nProvider>,
  );
}

describe("call sequence reconstruction", () => {
  it("reconstructs the assistant's side from the outcome alone", () => {
    expect(buildCallSequence("safe").map((s) => s.lineId)).toEqual([
      "disclosure",
      "ask",
      "safe",
      "close",
    ]);
    expect(buildCallSequence("no_answer").map((s) => s.lineId)).toEqual([
      "disclosure",
      "ask",
      "no_answer",
      "close",
    ]);
  });

  it("maps worrying to the `worry` clip, not `worrying`", () => {
    expect(reactionLineId("worrying")).toBe("worry");
    expect(buildCallSequence("worrying").map((s) => s.lineId)).toContain("worry");
    // The worry clip must exist, or the replay would go silent on that path.
    expect(CALL_AUDIO["worry"]).toBe("/audio/worry.mp3");
  });

  it("treats only recorded outcomes as replayable", () => {
    expect(isRecordedOutcome("safe")).toBe(true);
    expect(isRecordedOutcome("worrying")).toBe(true);
    expect(isRecordedOutcome("no_answer")).toBe(true);
    expect(isRecordedOutcome(null)).toBe(false);
    expect(isRecordedOutcome(undefined)).toBe(false);
    expect(isRecordedOutcome("queued")).toBe(false);
  });
});

describe("CallReplay", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    installAudioMock();
  });

  it("shows the reconstructed transcript and labels the elder's reply as a reconstruction", () => {
    renderReplay({ outcome: "worrying" });

    // The assistant's Cantonese lines come from the shared script.
    expect(screen.getByText(/長者連線嘅自動電話助手/)).toBeDefined();
    expect(screen.getByText(/請你留喺屋企等電話/)).toBeDefined();

    // The elder's side is present but explicitly marked as reconstructed.
    // (Two elements carry the marker — the badge and the explanatory note —
    // so assert on both rather than on an ambiguous single match.)
    expect(screen.getAllByText(/根據記錄結果重建|reconstructed/i).length).toBeGreaterThan(1);
    expect(screen.getByText(/從未被錄音|never recorded/i)).toBeDefined();
  });

  it("plays the same audio clips as the live call, in order", async () => {
    renderReplay({ outcome: "safe" });

    screen.getByRole("button", { name: /播放通話|play call/i }).click();

    await waitFor(() => {
      expect(playedClip("disclosure.mp3")).toBe(true);
    });
    // The first clip is the disclosure, exactly as in the live call.
    expect(playCalls[0]).toBe("/audio/disclosure.mp3");
  });

  it("plays the closing music only on the safe path", async () => {
    // The sequence has real inter-line pauses (1.6 s, 0.7 s, 2.2 s), so fake
    // timers are used to drive it to completion deterministically instead of
    // waiting ~5 s of wall clock. The Audio mock still resolves each clip.
    vi.useFakeTimers();
    try {
      const { unmount } = renderReplay({ outcome: "danger" });
      screen.getByRole("button", { name: /播放通話|play call/i }).click();
      // Run the whole script: disclosure → ask → danger → close.
      await vi.advanceTimersByTimeAsync(20_000);
      expect(playedClip("danger.mp3")).toBe(true);
      // Never over a 999 instruction.
      expect(playedClip(CLOSING_MUSIC_URL)).toBe(false);
      unmount();

      vi.clearAllMocks();
      installAudioMock();
      renderReplay({ outcome: "safe" });
      screen.getByRole("button", { name: /播放通話|play call/i }).click();
      await vi.advanceTimersByTimeAsync(20_000);
      expect(playedClip("safe.mp3")).toBe(true);
      expect(playedClip(CLOSING_MUSIC_URL)).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("offers no playback for a queued job that never connected", () => {
    renderReplay({ outcome: null, status: "queued", kind: "retry", attempt: 2 });

    // The explanation is shown...
    expect(screen.getByText(/未曾接通|never connected/i)).toBeDefined();
    expect(screen.getByText(/排隊至|queued until/i)).toBeDefined();
    // ...and there is no play control to press.
    expect(screen.queryByRole("button", { name: /播放通話|play call/i })).toBeNull();
  });

  it("closes on Escape", async () => {
    const onClose = vi.fn();
    renderReplay({ outcome: "safe" }, onClose);

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));

    await waitFor(() => {
      expect(onClose).toHaveBeenCalled();
    });
  });
});
