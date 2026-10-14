// Cantonese check-in call — plays the scripted check-in call and captures the
// elder's reply on the keypad, exactly like the DTMF flow a live call uses
// (1 = safe, 2 = worrying, 3 = danger).
//
// Audio is spoken by the assistant over the line; when a Twilio provider is
// configured the real adapter places the call and this component is not used
// (see telephony.ts / selectProvider()).
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PhoneCall, PhoneOff, Volume2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { KEYPAD_PROMPT, scriptLine } from "@/lib/script";
import type { Outcome } from "@/lib/engine";

/** Where the call currently is. */
type Stage = "idle" | "dialling" | "speaking" | "awaiting" | "ended";

/** A scripted line, with optional pause after it (ms). */
type Beat = { lineId: string; pauseAfter?: number };

export type DemoCallResult = {
  outcome: Outcome;
  /** True when the elder pressed a key rather than letting the call time out. */
  answered: boolean;
};

export function CantoneseDemoCall({
  elderName,
  onComplete,
}: {
  elderName: string;
  onComplete: (result: DemoCallResult) => void;
}) {
  const [stage, setStage] = useState<Stage>("idle");
  const [beatIndex, setBeatIndex] = useState(0);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [pressLog, setPressLog] = useState<string | null>(null);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  /** The scripted conversation: disclosure → question → wait → reaction → close. */
  const beats = useMemo<Beat[]>(() => {
    const base: Beat[] = [
      { lineId: "disclosure", pauseAfter: 1600 },
      { lineId: "ask" },
    ];
    if (!outcome) return base;
    // After the answer, add the reaction line and the closing line.
    const reaction =
      outcome === "safe" ? "safe"
      : outcome === "worrying" ? "worry"
      : outcome === "danger" ? "danger"
      : outcome === "unclear" ? "unclear"
      : "no_answer";
    return [
      ...base,
      { lineId: reaction, pauseAfter: 2200 },
      { lineId: "close" },
    ];
  }, [outcome]);

  const clearTimers = useCallback(() => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
  }, []);

  // Clean up any pending timers when the component unmounts.
  useEffect(() => clearTimers, [clearTimers]);

  /** Start the call: short dialling beat, then speak the first line. */
  function start() {
    clearTimers();
    setOutcome(null);
    setPressLog(null);
    setBeatIndex(0);
    setStage("dialling");
    timers.current.push(setTimeout(() => setStage("speaking"), 1200));
  }

  /** Advance through the scripted lines; pause on the question for an answer. */
  useEffect(() => {
    if (stage !== "speaking") return;
    const beat = beats[beatIndex];
    if (!beat) {
      setStage("ended");
      return;
    }
    // The question line waits for the keypad instead of auto-advancing.
    if (beat.lineId === "ask" && !outcome) {
      setStage("awaiting");
      return;
    }
    const delay = beat.pauseAfter ?? 1400;
    const id = setTimeout(() => setBeatIndex((i) => i + 1), delay);
    timers.current.push(id);
    return () => clearTimeout(id);
  }, [stage, beatIndex, beats, outcome]);

  /** Elder presses a keypad digit — this is the answer to the check-in. */
  function press(digit: string) {
    if (stage !== "awaiting") return;
    const entry = KEYPAD_PROMPT.find((k) => k.digit === digit);
    if (!entry) return;
    setPressLog(digit);
    setOutcome(entry.outcome);
    setBeatIndex((i) => i + 1);
    setStage("speaking");
  }

  /** Nobody answered (keypad timeout). */
  function noAnswer() {
    if (stage !== "awaiting") return;
    setPressLog(null);
    setOutcome("no_answer");
    setBeatIndex((i) => i + 1);
    setStage("speaking");
  }

  /** Hang up at any point. */
  function hangUp() {
    clearTimers();
    setStage("ended");
    onComplete({ outcome: outcome ?? "no_answer", answered: outcome !== null && outcome !== "no_answer" });
  }

  // Report the result once the call ends.
  const reported = useRef(false);
  useEffect(() => {
    if (stage === "ended" && !reported.current) {
      reported.current = true;
      onComplete({ outcome: outcome ?? "no_answer", answered: outcome !== null && outcome !== "no_answer" });
    }
  }, [stage, outcome, onComplete]);

  const currentLine = stage === "dialling" ? null : scriptLine(beats[beatIndex]?.lineId ?? "close");

  return (
    <div className="space-y-4 rounded-lg border bg-card p-5">
      {/* Status bar */}
      <div className="flex items-center justify-between gap-3">
        <span className="flex items-center gap-2 font-semibold">
          {stage === "ended" ? (
            <PhoneOff className="size-4" aria-hidden />
          ) : (
            <PhoneCall className="size-4" aria-hidden />
          )}
          {stage === "idle" ? "Not connected"
            : stage === "dialling" ? `Calling ${elderName}…`
            : stage === "awaiting" ? "Waiting for an answer…"
            : stage === "ended" ? "Call ended"
            : `Speaking… (${elderName})`}
        </span>
        {stage !== "idle" && stage !== "ended" ? (
          <Button size="sm" variant="outline" className="min-h-10" onClick={hangUp}>
            <PhoneOff className="mr-1 size-4" aria-hidden /> Hang up
          </Button>
        ) : null}
      </div>

      {/* Live captions: the Cantonese line being spoken */}
      <div
        role="status"
        aria-live="polite"
        className="min-h-[5.5rem] rounded-md border bg-muted/40 p-4"
      >
        {stage === "idle" ? (
          <p className="text-sm text-muted-foreground">
            Press “Start call” to begin the Cantonese check-in.
          </p>
        ) : stage === "dialling" ? (
          <p className="text-sm text-muted-foreground">☎ Dialling…</p>
        ) : currentLine ? (
          <>
            <p className="flex items-start gap-2 text-lg leading-relaxed">
              <Volume2 className="mt-1 size-5 shrink-0 opacity-70" aria-hidden />
              <span lang="yue-Hant-HK">{currentLine.zh}</span>
            </p>
            <p className="mt-1 pl-7 text-xs text-muted-foreground">{currentLine.en}</p>
          </>
        ) : null}
      </div>

      {/* Keypad — only active while the assistant waits for an answer */}
      {stage === "awaiting" ? (
        <div className="space-y-3">
          <p className="text-sm font-semibold">Answer the call:</p>
          <div className="grid grid-cols-3 gap-2">
            {KEYPAD_PROMPT.map((k) => (
              <button
                key={k.digit}
                onClick={() => press(k.digit)}
                className="min-h-16 rounded-lg border-2 border-input bg-card p-2 transition hover:border-primary hover:bg-primary/5"
              >
                <span className="block text-2xl font-bold">{k.digit}</span>
                <span className="block text-xs" lang="yue-Hant-HK">{k.zh}</span>
                <span className="block text-[10px] text-muted-foreground">{k.en}</span>
              </button>
            ))}
          </div>
          <Button variant="outline" className="w-full" onClick={noAnswer}>
            No answer (timeout)
          </Button>
        </div>
      ) : null}

      {/* Result / controls */}
      {outcome && stage !== "awaiting" ? (
        <p className="text-sm">
          <span className="text-muted-foreground">Answered: </span>
          <span className="font-semibold">
            {pressLog ? `keypad ${pressLog} → ` : "no answer → "}
            {outcome}
          </span>
        </p>
      ) : null}

      {stage === "idle" || stage === "ended" ? (
        <Button className="h-12 w-full" onClick={start}>
          {stage === "ended" ? "Call again" : "Start call"}
        </Button>
      ) : null}
    </div>
  );
}
