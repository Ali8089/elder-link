/**
 * Regression tests for the closing music.
 *
 * The first implementation never played the music at all: the effect that
 * started it was guarded by a one-shot `reported` ref shared with the
 * onComplete callback, and `onComplete` re-rendered the parent with a fresh
 * callback identity, so the effect re-ran, saw the flag already set, and
 * returned before reaching the music branch. These tests pin the behaviour:
 * the music starts on the safe path, and never on the paths that end by
 * telling the elder to call 999.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { CantoneseDemoCall, classifySpoken } from "@/components/CantoneseDemoCall";

/** Records every Audio the component constructs. */
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

function installAudioMock(opts: { failPlayFor?: (src: string) => boolean } = {}) {
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
      if (opts.failPlayFor?.(this.src)) throw new Error("NotAllowedError");
      this.paused = false;
      // Speech clips resolve immediately; the loop keeps music alive instead.
      queueMicrotask(() => { if (this.src.endsWith(".mp3")) this.emit("ended"); });
      return undefined;
    }
    pause() {
      this.paused = true;
    }
  }
  vi.stubGlobal("Audio", MockAudio as unknown as typeof Audio);
}

function closingMusicRequested(): boolean {
  return playCalls.some((s) => s.includes("closing-music"));
}

describe("closing music", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    installAudioMock();
  });

  it("plays the closing music after a safe check-in", async () => {
    render(<CantoneseDemoCall elderName="陳婆婆" onComplete={() => undefined} />);

    screen.getByRole("button", { name: /start call/i }).click();

    // The keypad only renders once the scripted question has finished playing,
    // so waiting for keypad 1 is the signal that the call is awaiting an answer.
    const safeKey = await screen.findByRole("button", { name: /^1\b/ }, { timeout: 15000 });
    safeKey.click();

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /hang up/i })).toBeDefined();
    });
    screen.getByRole("button", { name: /hang up/i }).click();

    await waitFor(() => {
      expect(closingMusicRequested()).toBe(true);
    });
  });

  it("never plays the closing music on the danger path", async () => {
    render(<CantoneseDemoCall elderName="陳婆婆" onComplete={() => undefined} />);

    screen.getByRole("button", { name: /start call/i }).click();
    const dangerKey = await screen.findByRole("button", { name: /^3\b/ }, { timeout: 15000 });
    dangerKey.click();
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /hang up/i })).toBeDefined();
    });
    screen.getByRole("button", { name: /hang up/i }).click();

    await waitFor(() => {
      expect(screen.getByText(/call ended/i)).toBeDefined();
    });
    // Music over a 999 instruction would be actively harmful.
    expect(closingMusicRequested()).toBe(false);
  });

  it("reports the outcome to the caller", async () => {
    const onComplete = vi.fn();
    render(<CantoneseDemoCall elderName="陳婆婆" onComplete={onComplete} />);

    screen.getByRole("button", { name: /start call/i }).click();
    const safeKey = await screen.findByRole("button", { name: /^1\b/ }, { timeout: 15000 });
    safeKey.click();
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /hang up/i })).toBeDefined();
    });
    screen.getByRole("button", { name: /hang up/i }).click();

    await waitFor(() => {
      expect(onComplete).toHaveBeenCalled();
    });
    expect(onComplete.mock.calls.at(-1)?.[0]).toMatchObject({ outcome: "safe", answered: true });
  });

  it("surfaces a blocked autoplay instead of failing silently", async () => {
    installAudioMock({ failPlayFor: (src) => src.includes("closing-music") });
    render(<CantoneseDemoCall elderName="陳婆婆" onComplete={() => undefined} />);

    screen.getByRole("button", { name: /start call/i }).click();
    const safeKey = await screen.findByRole("button", { name: /^1\b/ }, { timeout: 15000 });
    safeKey.click();
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /hang up/i })).toBeDefined();
    });
    screen.getByRole("button", { name: /hang up/i }).click();

    await waitFor(() => {
      expect(screen.getByText(/blocked by the browser/i)).toBeDefined();
    });
  });
});

describe("classifySpoken safety", () => {
  it("never returns safe for an unrecognised utterance", () => {
    expect(classifySpoken("")).toBe("unclear");
    expect(classifySpoken("blah blah")).toBe("unclear");
    expect(classifySpoken("what")).toBe("unclear");
  });

  it("recognises a clear distress call as danger", () => {
    expect(classifySpoken("救命呀")).toBe("danger");
    expect(classifySpoken("我呼吸唔到")).toBe("danger");
  });

  it("recognises discomfort as worrying, not safe", () => {
    expect(classifySpoken("我今日有啲頭暈")).toBe("worrying");
  });

  it("recognises a clearly fine answer as safe", () => {
    expect(classifySpoken("我冇事，幾好")).toBe("safe");
  });
});
