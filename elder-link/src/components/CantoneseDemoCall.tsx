// Cantonese check-in call — plays the real spoken Cantonese for each line and
// captures the elder's reply, either on the keypad or by voice.
//
// Audio is generated ahead of time into public/audio/ (see
// scripts/generate-audio.mjs) and played back here. Nothing is synthesised at
// runtime, so a call cannot fail because a TTS provider is down or over quota.
//
// When a Twilio provider is configured the real adapter places the call
// instead and this component is not used (see telephony.ts / selectProvider()).

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Mic, PhoneCall, PhoneOff, Volume2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  CALL_AUDIO as AUDIO,
  CLOSING_MUSIC_URL as CLOSING_MUSIC,
  KEYPAD_PROMPT,
  reactionLineId,
  scriptLine,
} from "@/lib/script";
import type { Outcome } from "@/lib/engine";
import {
  CLOSING_MUSIC_FADE_MS,
  CLOSING_MUSIC_VOLUME,
  mayPlayClosingMusic,
  type VoiceEngine,
} from "@/lib/voice";
import { classifyCantonese, type ConversationEngine } from "@/lib/conversation";

/** Where the call currently is. */
type Stage = "idle" | "dialling" | "speaking" | "awaiting" | "listening" | "ended";

/** A scripted line, with optional pause after it (ms). */
type Beat = { lineId: string; pauseAfter?: number };

export type DemoCallResult = {
  outcome: Outcome;
  /** True when the elder answered (keypad or voice) rather than timing out. */
  answered: boolean;
};

/**
 * How long to keep the line open after the assistant asks its question.
 *
 * An elderly person may need to put the phone down, find their words, or
 * simply take a while to answer. Cutting the call short reads as the system
 * having given up on them, which is precisely the wrong signal for someone
 * living alone — so this is generous. It is a timer, not a silence detector:
 * the elder can take up to this long and still be heard.
 */
export const ANSWER_WINDOW_MS = 45_000;

/**
 * A second, shorter prompt if they have not answered yet. Reassures them the
 * call is still there rather than leaving dead air.
 */
export const ANSWER_NUDGE_MS = 20_000;

/**
 * Held pause after the final goodbye, before the call screen closes. Gives the
 * goodbye room to land and the closing music a chance to start.
 */
export const END_OF_CALL_HOLD_MS = 3_500;

/** How long a single voice recording runs before it is sent for recognition. */
export const RECORDING_MS = 12_000;

/**
 * Speak arbitrary Cantonese text using the platform's own voice.
 *
 * Needed because a generated line cannot have been pre-recorded. Browsers ship
 * Cantonese voices on most platforms (macOS and iOS reliably; Chrome on Windows
 * depends on installed language packs), so this is treated as an enhancement:
 * when no `yue` voice exists the line still appears as a caption and the
 * pre-recorded clip has already been played, so the call never goes silent.
 *
 * Returns the text it managed to speak, or null.
 */
function speakWithBrowser(text: string): string | null {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return null;
  try {
    const synth = window.speechSynthesis;
    const utter = new SpeechSynthesisUtterance(text);
    // Prefer an explicit Cantonese voice. `yue` is the ISO code browsers use;
    // zh-HK is the closest fallback and is what most systems label it.
    const voices = synth.getVoices();
    const voice =
      voices.find((v) => /^yue/i.test(v.lang)) ??
      voices.find((v) => /zh[-_]HK/i.test(v.lang));
    if (voice) utter.voice = voice;
    utter.lang = voice?.lang ?? "zh-HK";
    utter.rate = 0.9; // Slightly slow: the audience is elderly.
    utter.pitch = 1;
    synth.speak(utter);
    return text;
  } catch {
    return null;
  }
}

/**
 * Is a Cantonese voice available on this device? Used to tell the user why a
 * generated line is silent, rather than leaving them to guess.
 */
export function hasCantoneseVoice(): boolean {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return false;
  const voices = window.speechSynthesis.getVoices();
  return voices.some((v) => /^yue/i.test(v.lang) || /zh[-_]HK/i.test(v.lang));
}

export function CantoneseDemoCall({
  elderName,
  onComplete,
  voiceEngine,
  conversationEngine,
  speechUnavailableReason,
}: {
  elderName: string;
  onComplete: (result: DemoCallResult) => void;
  /** Optional speech-recognition engine. Omitted → keypad only. */
  voiceEngine?: VoiceEngine | undefined;
  /**
   * Optional conversational layer. When present the assistant's reaction line
   * is generated from what the elder actually said, instead of the fixed
   * script. Classification still goes through the safety floor either way.
   */
  conversationEngine?: ConversationEngine | undefined;
  /**
   * Why voice input is unavailable, when it is. Shown on screen so a missing
   * configuration is visible rather than silently removing the button — the
   * failure mode that hid this feature the first time round.
   */
  speechUnavailableReason?: string | undefined;
}) {
  const [stage, setStage] = useState<Stage>("idle");
  const [beatIndex, setBeatIndex] = useState(0);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [pressLog, setPressLog] = useState<string | null>(null);
  const [spoken, setSpoken] = useState<string | null>(null);
  const [musicOn, setMusicOn] = useState(false);
  const [musicBlocked, setMusicBlocked] = useState(false);
  const [audioBlocked, setAudioBlocked] = useState(false);
  /** Set when the recogniser failed for a reason worth showing. */
  const [transcribeError, setTranscribeError] = useState<string | null>(null);
  /** True once the elder has been waiting long enough to warrant a nudge. */
  const [nudged, setNudged] = useState(false);
  /** Seconds left in the answer window, for the on-screen countdown. */
  const [secondsLeft, setSecondsLeft] = useState(0);
  /** The assistant's generated line, when it differs from the script. */
  const [generatedLine, setGeneratedLine] = useState<string | null>(null);
  /** Turns so far, handed to the conversation engine for context. */
  const historyRef = useRef<{ role: "assistant" | "elder"; text: string }[]>([]);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const musicRef = useRef<HTMLAudioElement | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  /**
   * Mirror of `stage` for the answer-window timer.
   *
   * The give-up timer is created once, when the question is asked, and fires
   * long afterwards. A closure over `stage` would see the value captured at that
   * render — not the live one — so the callback reads this ref instead to know
   * whether the elder is currently answering.
   */
  const stageRef = useRef<Stage>("idle");

  /** The scripted conversation: disclosure → question → wait → reaction → close. */
  const beats = useMemo<Beat[]>(() => {
    const base: Beat[] = [
      { lineId: "disclosure", pauseAfter: 1600 },
      { lineId: "ask" },
    ];
    if (!outcome) return base;
    // The reaction clip is a pure function of the outcome — shared with the
    // replay view so the two can never disagree about what was played.
    return [...base, { lineId: reactionLineId(outcome), pauseAfter: 2200 }, { lineId: "close" }];
  }, [outcome]);

  const clearTimers = useCallback(() => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
  }, []);

  const stopMusic = useCallback(() => {
    const m = musicRef.current;
    if (!m) return;
    m.pause();
    m.currentTime = 0;
    musicRef.current = null;
    setMusicOn(false);
  }, []);

  const stopAudio = useCallback(() => {
    audioRef.current?.pause();
    audioRef.current = null;
  }, []);

  /**
   * Stop only the *speech* currently playing, not the closing music.
   *
   * Hanging up used to call stopMusic() as well, which killed the music in the
   * same tick it started: the elder always ends the call by pressing Hang up,
   * so the closing music was unconditionally silenced. Speech and music need
   * separate lifetimes — ending the call stops one and starts the other.
   */
  const stopSpeech = useCallback(() => {
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }
    stopAudio();
  }, [stopAudio]);

  /** Speak one line and resolve when it finishes (or immediately if it cannot). */
  const playLine = useCallback(
    async (lineId: string) => {
      const src = AUDIO[lineId];
      if (!src) return;
      try {
        const el = new Audio(src);
        audioRef.current = el;
        await new Promise<void>((resolve) => {
          const done = () => resolve();
          el.addEventListener("ended", done, { once: true });
          // A failed load must not stall the call: the caption still shows.
          el.addEventListener("error", () => { setAudioBlocked(true); done(); }, { once: true });
          el.play().catch(() => { setAudioBlocked(true); done(); });
        });
      } catch {
        setAudioBlocked(true);
      }
    },
    [],
  );

  useEffect(() => () => { clearTimers(); stopSpeech(); stopMusic(); }, [clearTimers, stopSpeech, stopMusic]);

  /**
   * Countdown while waiting for an answer.
   *
   * Shown on screen so the person operating the dashboard can see the line is
   * deliberately being held open, rather than assuming it has hung.
   */
  useEffect(() => {
    if (stage !== "awaiting" && stage !== "listening") {
      setSecondsLeft(0);
      return;
    }
    setSecondsLeft(Math.round(ANSWER_WINDOW_MS / 1000));
    const id = setInterval(() => {
      setSecondsLeft((s) => (s <= 1 ? 0 : s - 1));
    }, 1000);
    return () => clearInterval(id);
  }, [stage]);

  /** Start the call: short dialling beat, then speak the first line. */
  function start() {
    clearTimers();
    stopSpeech();
    stopMusic();
    setOutcome(null);
    setPressLog(null);
    setSpoken(null);
    setAudioBlocked(false);
    setMusicBlocked(false);
    setTranscribeError(null);
    setGeneratedLine(null);
    setNudged(false);
    historyRef.current = [];
    setBeatIndex(0);
    setStage("dialling");
    timers.current.push(setTimeout(() => setStage("speaking"), 1200));
  }

  /** Keep `stageRef` current so the answer-window timer sees the live stage. */
  useEffect(() => {
    stageRef.current = stage;
  }, [stage]);

  /** Advance through the scripted lines, speaking each one. */
  useEffect(() => {
    if (stage !== "speaking") return;
    const beat = beats[beatIndex];
    if (!beat) {
      // The script finished on its own. Wait out the goodbye so the last line
      // is actually heard and the music has room to start, instead of cutting
      // straight to a hung-up screen.
      const id = setTimeout(() => setStage("ended"), END_OF_CALL_HOLD_MS);
      timers.current.push(id);
      return;
    }
    // The question line waits for the elder instead of auto-advancing.
    if (beat.lineId === "ask" && !outcome) {
      let cancelled = false;
      void playLine("ask").then(() => {
        if (cancelled) return;
        setStage("awaiting");
        // Give them a long time to answer. Only after the full window with no
        // response does the call treat it as unanswered — a short timeout is
        // the single most likely way for this system to feel like it does not
        // care.
        const nudge = setTimeout(() => setNudged(true), ANSWER_NUDGE_MS);
        // The answer window is an *idle* window: it must not run down while the
        // elder is actually responding. Recording (RECORDING_MS) plus CPU
        // transcription (measured up to 32s) can outlast ANSWER_WINDOW_MS, so
        // without this the give-up would fire mid-transcription: it would write
        // no_answer and advance the beat, and the transcript would then advance
        // the beat a second time — discarding a real answer and skipping a line.
        //
        // Gate on the live stage instead. While listening, suspend by re-arming a
        // fresh full window; the result, when it lands, moves the call on and a
        // later fire sees a non-awaiting stage and does nothing. `stageRef`, not
        // the closed-over `stage`, because this runs long after that render.
        const giveUp = () => {
          if (stageRef.current === "listening") {
            timers.current.push(setTimeout(giveUp, ANSWER_WINDOW_MS));
            return;
          }
          // Answered (keypad or voice) or hung up: nothing left to give up on.
          if (stageRef.current !== "awaiting") return;
          setNudged(false);
          setOutcome("no_answer");
          setBeatIndex((i) => i + 1);
          setStage("speaking");
        };
        timers.current.push(nudge, setTimeout(giveUp, ANSWER_WINDOW_MS));
      });
      return () => { cancelled = true; };
    }
    let cancelled = false;
    void playLine(beat.lineId).then(() => {
      if (cancelled) return;
      const id = setTimeout(() => setBeatIndex((i) => i + 1), beat.pauseAfter ?? 700);
      timers.current.push(id);
    });
    return () => { cancelled = true; };
  }, [stage, beatIndex, beats, outcome, playLine]);

  /**
   * Generate the assistant's reaction line from what was actually said.
   *
   * Runs once the elder's answer has been classified, and only when a
   * conversational engine is configured. The generated text is *spoken via the
   * caption and the browser's own voice* rather than a pre-recorded clip,
   * because the wording cannot be known ahead of time — the fixed clips remain
   * the fallback, and the script's own reaction line is shown if the model
   * returns nothing.
   */
  useEffect(() => {
    if (!conversationEngine) return;
    if (stage !== "speaking") return;
    if (!outcome) return;
    // Only for the reaction beat, not the disclosure/question/goodbye.
    const reactionIds = ["safe", "worry", "danger", "unclear", "no_answer"];
    const beat = beats[beatIndex];
    if (!beat || !reactionIds.includes(beat.lineId)) return;

    let cancelled = false;
    void conversationEngine
      .reply({
        elderName,
        heard: spoken ?? "",
        history: historyRef.current,
      })
      .then((text) => {
        if (cancelled) return;
        const clean = text.trim();
        if (!clean) return;
        setGeneratedLine(clean);
        historyRef.current = [
          ...historyRef.current.slice(-5),
          ...(spoken ? [{ role: "elder" as const, text: spoken }] : []),
          { role: "assistant" as const, text: clean },
        ];
        // Speak it with the browser's own Cantonese voice. This is a
        // progressive enhancement — if the platform has no yue voice the
        // caption still carries the line, and the pre-recorded clip has
        // already played.
        speakWithBrowser(clean);
      });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage, beatIndex, outcome, conversationEngine]);

  /** Elder presses a keypad digit. */
  function press(digit: string) {
    if (stage !== "awaiting" && stage !== "listening") return;
    const entry = KEYPAD_PROMPT.find((k) => k.digit === digit);
    if (!entry) return;
    stopListening();
    setSpoken(null);
    setPressLog(digit);
    setOutcome(entry.outcome);
    setBeatIndex((i) => i + 1);
    setStage("speaking");
  }

  /** Nobody answered at all. */
  function noAnswer() {
    if (stage !== "awaiting" && stage !== "listening") return;
    stopListening();
    setPressLog(null);
    setSpoken(null);
    setOutcome("no_answer");
    setBeatIndex((i) => i + 1);
    setStage("speaking");
  }

  /**
   * Hang up at any point.
   *
   * Note on the closing music: it is started by the effect below in response to
   * `stage === "ended"`, and that effect runs *after* this handler returns and
   * React commits the state change. So whatever this function does to audio,
   * the music element does not exist yet — it is created fresh by the effect.
   *
   * The original silence bug was therefore NOT here. It was the music effect
   * being gated on the same one-shot `reported` ref as the `onComplete` call:
   * `onComplete` re-renders the parent with a new callback identity, the effect
   * re-ran, found the latch already consumed, and returned before reaching the
   * music branch. The two effects are now independent, each with its own latch.
   *
   * `stopSpeech` is still correct here: speech and music have separate
   * lifetimes, and hanging up should stop the former while letting the latter
   * begin. Verified by scripts/e2e-call.mjs, which fails on the old gating.
   */
  function hangUp() {
    clearTimers();
    stopSpeech();
    setStage("ended");
  }

  /** Record the elder speaking, then transcribe it. */
  async function startListening() {
    if (!voiceEngine || stage !== "awaiting") return;
    setStage("listening");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const rec = new MediaRecorder(stream);
      recorderRef.current = rec;
      const chunks: Blob[] = [];
      rec.addEventListener("dataavailable", (e) => chunks.push(e.data));
      rec.addEventListener("stop", async () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunks, { type: rec.mimeType || "audio/webm" });
        const { text, error } = await voiceEngine.transcribe(blob);
        const word = text.trim();
        setSpoken(word || "(nothing heard)");
        setTranscribeError(error ?? null);

        // Classification, in order of authority:
        //   1. the deterministic Cantonese classifier, which never returns
        //      "safe" for anything unrecognised — this is the floor for a
        //      totally empty transcript;
        //   2. the conversational engine, when configured, which may read a
        //      phrasing the keyword list misses but cannot downgrade to safe
        //      on its own (enforced inside the engine).
        const floor = classifyCantonese(word);
        let o: Outcome = floor;
        if (conversationEngine && word) {
          try {
            o = await conversationEngine.understand({
              elderName,
              heard: word,
              history: historyRef.current,
            });
          } catch {
            o = floor;
          }
        }
        if (!word) o = "no_answer";

        setPressLog(null);
        setOutcome(o);
        setBeatIndex((i) => i + 1);
        setStage("speaking");
      });
      rec.start();
      // Bound the recording so a silent line does not hold the call open —
      // but generously, so a slow speaker is not cut off mid-sentence.
      timers.current.push(setTimeout(() => stopListening(), RECORDING_MS));
    } catch {
      // No microphone permission — fall back to the keypad, which always works.
      setStage("awaiting");
    }
  }

  function stopListening() {
    const rec = recorderRef.current;
    if (rec && rec.state !== "inactive") rec.stop();
    recorderRef.current = null;
  }

  // Report the result once the call ends, and play the closing music if earned.
  const reported = useRef(false);
  useEffect(() => {
    if (stage !== "ended") return;
    if (reported.current) return;
    reported.current = true;
    const finalOutcome = outcome ?? "no_answer";
    onComplete({ outcome: finalOutcome, answered: outcome !== null && outcome !== "no_answer" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage]);

  /**
   * The closing music.
   *
   * Keyed on the outcome rather than the stage, and *not* guarded by the
   * one-shot `reported` flag above: `onComplete` makes the parent re-render and
   * hands us a fresh `onComplete` identity, which previously re-entered the same
   * effect, found `reported.current` already true, and returned early — so the
   * music branch never ran at all. Starting the fade directly here keeps the
   * two concerns independent.
   *
   * Only started once the call has ended and only on the safe path.
   */
  const musicStarted = useRef(false);
  useEffect(() => {
    if (stage !== "ended") {
      // A new call resets the latch so the music can play again.
      musicStarted.current = false;
      return;
    }
    if (musicStarted.current) return;
    const finalOutcome = outcome ?? "no_answer";
    // Music never plays over a 999 instruction — safe path only.
    if (!mayPlayClosingMusic(finalOutcome)) return;
    musicStarted.current = true;

    let cancelled = false;
    const m = new Audio(CLOSING_MUSIC);
    // Start silent and ramp up, so the swell feels intentional rather than a
    // sudden start after the goodbye.
    m.volume = 0;
    m.loop = false;
    musicRef.current = m;

    void m
      .play()
      .then(() => {
        if (cancelled) return;
        setMusicOn(true);
        const steps = 20;
        let i = 0;
        const id = setInterval(() => {
          i += 1;
          m.volume = Math.min(CLOSING_MUSIC_VOLUME, (CLOSING_MUSIC_VOLUME * i) / steps);
          if (i >= steps) clearInterval(id);
        }, CLOSING_MUSIC_FADE_MS / steps);
        timers.current.push(id as unknown as ReturnType<typeof setTimeout>);
      })
      .catch(() => {
        // Most likely the browser blocked autoplay. Say so rather than failing
        // silently, so the behaviour is diagnosable from the screen.
        if (!cancelled) {
          setMusicOn(false);
          setMusicBlocked(true);
        }
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage, outcome]);

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
            : stage === "listening" ? "Listening…"
            : stage === "ended" ? "Call ended"
            : `Speaking… (${elderName})`}
        </span>
        {stage !== "idle" && stage !== "ended" ? (
          <Button size="sm" variant="outline" className="min-h-10" onClick={hangUp}>
            <PhoneOff className="mr-1 size-4" aria-hidden /> Hang up
          </Button>
        ) : null}
      </div>

      {/* Live captions — always shown, so the call is usable even muted. */}
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
        ) : stage === "listening" ? (
          <p className="text-sm text-muted-foreground">🎙 Listening for your answer…</p>
        ) : stage === "awaiting" ? (
          <>
            <p className="text-lg leading-relaxed" lang="yue-Hant-HK">
              {nudged
                ? "仲喺度㗎，慢慢嚟，唔急。"
                : "你好嗎？今日點呀？"}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {nudged
                ? "Still here — take your time, there's no rush."
                : "Waiting for an answer…"}
              {" · "}
              {secondsLeft}s
            </p>
          </>
        ) : currentLine ? (
          <>
            <p className="flex items-start gap-2 text-lg leading-relaxed">
              <Volume2 className="mt-1 size-5 shrink-0 opacity-70" aria-hidden />
              <span lang="yue-Hant-HK">{generatedLine ?? currentLine.zh}</span>
            </p>
            <p className="mt-1 pl-7 text-xs text-muted-foreground">
              {generatedLine ? "(said live)" : currentLine.en}
            </p>
          </>
        ) : null}
      </div>

      {audioBlocked && stage !== "idle" ? (
        <p role="status" className="text-xs text-muted-foreground">
          Audio could not play in this browser — the captions above carry the call.
        </p>
      ) : null}

      {/* Say why voice input is missing, and say it up front. Gating this on the
          await stage meant the operator only discovered voice was unavailable
          after the question had already been asked — too late to do anything
          about it. It now shows for the whole call. */}
      {!voiceEngine && speechUnavailableReason && stage !== "idle" ? (
        <p
          role="status"
          className="rounded-md border border-dashed p-3 text-xs text-muted-foreground"
        >
          <strong className="font-semibold">Voice answers are off.</strong> {speechUnavailableReason}
        </p>
      ) : null}

      {/* A recogniser failure is worth showing: an empty transcript alone looks
          identical to "nobody spoke", and the two need different fixes. */}
      {transcribeError ? (
        <p role="status" className="rounded-md border border-destructive/40 bg-destructive/5 p-2 text-xs">
          Speech recognition failed ({transcribeError}). The keypad or a retry still works.
        </p>
      ) : null}

      {/* Answer controls — active while the assistant waits */}
      {stage === "awaiting" || stage === "listening" ? (
        <div className="space-y-3">
          <p className="text-sm font-semibold">
            {stage === "listening"
              ? "Recording — speak, then it will be sent:"
              : `Answer the call: (line held open for ${secondsLeft}s)`}
          </p>
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
          {voiceEngine && stage === "awaiting" ? (
            <Button variant="secondary" className="w-full min-h-11" onClick={() => void startListening()}>
              <Mic className="mr-1 size-4" aria-hidden /> Answer by voice
            </Button>
          ) : null}

          {stage === "listening" ? (
            <Button variant="outline" className="w-full min-h-11" onClick={() => stopListening()}>
              Finish speaking
            </Button>
          ) : null}
          <Button variant="outline" className="w-full" onClick={noAnswer}>
            No answer (timeout)
          </Button>
        </div>
      ) : null}

      {/* Result */}
      {outcome && stage !== "awaiting" && stage !== "listening" ? (
        <p className="text-sm">
          <span className="text-muted-foreground">Answered: </span>
          <span className="font-semibold">
            {spoken ? `“${spoken}” → ` : pressLog ? `keypad ${pressLog} → ` : "no answer → "}
            {outcome}
          </span>
        </p>
      ) : null}

      {musicOn ? (
        <p className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
          <span>♪ Closing music playing</span>
          <button className="underline" onClick={stopMusic}>Stop</button>
        </p>
      ) : null}

      {musicBlocked ? (
        <p role="status" className="text-xs text-muted-foreground">
          Closing music was blocked by the browser. Click anywhere on the page and
          start the call again — audio needs one interaction before it may play.
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

/**
 * Maps a spoken Cantonese answer to an outcome.
 *
 * Deliberately conservative: anything that is not clearly a "fine" answer is
 * treated as needing attention, so a mishearing can never be recorded as safe.
 * Mirrors the phrases in SAMPLE_ANSWERS (src/lib/telephony.ts).
 */
export function classifySpoken(text: string): Outcome {
  const t = text.trim();
  if (!t) return "unclear";
  if (/(救命|幫我|好痛|唔舒服|痛|頭暈|跌落|跌親|呼吸)/.test(t)) {
    return /(救命|幫我|好痛|呼吸)/.test(t) ? "danger" : "worrying";
  }
  if (/(冇事|幾好|好好|安好|OK|ok|唔使|冇問題)/.test(t)) return "safe";
  return "unclear";
}
