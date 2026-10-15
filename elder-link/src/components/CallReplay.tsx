// Replay a past check-in call.
//
// The assistant's side of a finished call is fully reconstructable from the
// `call_jobs` row alone: the script is fixed and, given the outcome, the played
// sequence is exactly  disclosure → ask → (the outcome's reaction clip) → close,
// with the closing music on the safe path. So rather than record anything — the
// service deliberately never records audio (FR-13) — this view re-plays the
// same pre-generated clips in the same order.
//
// The elder's side is a different matter: their words and keystroke were never
// stored. Rather than pretend otherwise, the canonical reply for the recorded
// outcome is shown clearly marked as a *reconstruction*, never as a transcript.

import { useCallback, useEffect, useRef, useState } from "react";
import { Info, Pause, Play, SkipBack, SkipForward, Volume2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/StatusBadge";
import { useI18n } from "@/lib/i18n";
import {
  CALL_AUDIO,
  CLOSING_MUSIC_URL,
  buildCallSequence,
  isRecordedOutcome,
  scriptLine,
  type SequenceStep,
} from "@/lib/script";
import { SAMPLE_ANSWERS } from "@/lib/telephony";
import {
  CLOSING_MUSIC_FADE_MS,
  CLOSING_MUSIC_VOLUME,
  mayPlayClosingMusic,
} from "@/lib/voice";
import type { Outcome } from "@/lib/engine";

/** The subset of a `call_jobs` row the replay needs. */
export type ReplayJob = {
  id: string;
  kind: string;
  attempt: number;
  status: string;
  outcome: string | null;
  activity_suggestion: string | null;
  due_at: string;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
};

/** Human-facing label for a job kind, falling back to the raw value. */
function kindLabel(t: (k: string) => string, kind: string): string {
  if (kind === "scheduled") return t("kind_scheduled");
  if (kind === "sensor") return t("kind_sensor");
  if (kind === "retry") return t("kind_retry");
  return kind;
}

/**
 * The elder's canonical reply for an outcome.
 *
 * Returns the reconstructed phrase, or null when the outcome itself *is* the
 * absence of an answer (no_answer) — there is nothing to reconstruct in that
 * case, and inventing words would be dishonest.
 */
function elderReply(outcome: Outcome): string | null {
  return SAMPLE_ANSWERS[outcome] ?? null;
}

export function CallReplay({
  elderName,
  job,
  onClose,
}: {
  elderName: string;
  job: ReplayJob;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const rawOutcome = job.outcome;
  const recorded = isRecordedOutcome(rawOutcome);
  const outcome: Outcome | null = recorded ? rawOutcome : null;

  /** True when this outcome earns the closing music (safe path only). */
  const earnsMusic = outcome !== null && mayPlayClosingMusic(outcome);

  const steps: SequenceStep[] = outcome ? buildCallSequence(outcome) : [];
  /** Index of the line currently being spoken, or -1 before starting. */
  const [index, setIndex] = useState(-1);
  const [playing, setPlaying] = useState(false);
  const [musicOn, setMusicOn] = useState(false);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const musicRef = useRef<HTMLAudioElement | null>(null);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  /** Guards the pauseAfter wait so a step change cannot double-advance. */
  const advancing = useRef(false);
  const closeRef = useRef<HTMLButtonElement | null>(null);

  const clearTimers = useCallback(() => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
  }, []);

  const stopAudio = useCallback(() => {
    const a = audioRef.current;
    if (a) {
      a.pause();
      audioRef.current = null;
    }
  }, []);

  const stopMusic = useCallback(() => {
    const m = musicRef.current;
    if (m) {
      m.pause();
      musicRef.current = null;
    }
    setMusicOn(false);
  }, []);

  /** Full stop — used on close, restart and unmount. */
  const stopAll = useCallback(() => {
    clearTimers();
    advancing.current = false;
    stopAudio();
    stopMusic();
    setPlaying(false);
  }, [clearTimers, stopAudio, stopMusic]);

  useEffect(() => () => stopAll(), [stopAll]);

  // Focus the close button when the dialog opens, and let Escape close it.
  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  /** The closing music, if this outcome earned it. */
  const playClosingMusic = useCallback(() => {
    if (!earnsMusic) return;
    const m = new Audio(CLOSING_MUSIC_URL);
    m.volume = 0;
    m.loop = false;
    musicRef.current = m;
    void m
      .play()
      .then(() => {
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
        // Autoplay blocked, most likely. Say nothing loud: the transcript still
        // carries the call, and the operator has already interacted to get here.
        setMusicOn(false);
      });
  }, [earnsMusic]);

  /**
   * Speak one line, then either advance or finish.
   *
   * Split from the click handler so stepping (prev/next) can reuse it, and so
   * the very first play stays inside the user-gesture call stack — Chromium
   * blocks autoplay otherwise.
   */
  const speakStep = useCallback(
    (i: number) => {
      clearTimers();
      stopAudio();
      const step = steps[i];
      if (!step) return;
      const src = CALL_AUDIO[step.lineId];
      setIndex(i);
      advancing.current = true;
      if (!src) {
        advanceFrom(i, 0);
        return;
      }
      const el = new Audio(src);
      audioRef.current = el;
      const advance = () => advanceFrom(i, step.pauseAfter);
      el.addEventListener("ended", advance, { once: true });
      el.addEventListener("error", advance, { once: true });
      void el.play().catch(advance);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [steps, clearTimers, stopAudio],
  );

  /** Move on after a line and its pause, or roll into the music/stop. */
  function advanceFrom(i: number, pauseAfter: number) {
    if (!advancing.current) return;
    advancing.current = false;
    const id = setTimeout(() => {
      const next = i + 1;
      if (next < steps.length) {
        speakStep(next);
      } else {
        setPlaying(false);
        setIndex(steps.length - 1);
        playClosingMusic();
      }
    }, pauseAfter);
    timers.current.push(id);
  }

  /** Start (or resume) the call from the current line. */
  function play() {
    if (playing || steps.length === 0) return;
    setPlaying(true);
    const start = index < 0 ? 0 : index;
    // Called synchronously from the click so the gesture carries into play().
    speakStep(start);
  }

  function pause() {
    advancing.current = false;
    clearTimers();
    audioRef.current?.pause();
    setPlaying(false);
  }

  function restart() {
    stopAll();
    setIndex(-1);
    setPlaying(true);
    speakStep(0);
  }

  function stepTo(i: number) {
    stopAll();
    if (i < 0) {
      setIndex(-1);
      return;
    }
    if (i >= steps.length) return;
    setIndex(i);
    setPlaying(true);
    speakStep(i);
  }

  const currentLineId = index >= 0 ? (steps[index]?.lineId ?? null) : null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4 sm:items-center"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`${elderName} — ${t("callReplay")}`}
        className="my-8 w-full max-w-2xl space-y-4 rounded-lg border bg-card p-5 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-1">
            <h2 className="text-xl font-semibold">
              {elderName} — {t("callReplay")}
            </h2>
            <div className="flex flex-wrap items-center gap-2 text-sm">
              {job.outcome ? (
                <StatusBadge kind={job.outcome} />
              ) : (
                <StatusBadge kind={job.status} />
              )}
              <span className="text-muted-foreground">
                {new Date(job.created_at).toLocaleString()}
              </span>
            </div>
            <p className="text-xs text-muted-foreground">
              {t("kind")}: <span className="font-semibold">{kindLabel(t, job.kind)}</span>
              {" · "}
              {t("attempt")} #{job.attempt}
              {" · "}
              {t("status")}: {job.status}
            </p>
          </div>
          <Button
            ref={closeRef}
            variant="outline"
            size="sm"
            className="min-h-10"
            onClick={onClose}
            aria-label={t("replayClose")}
          >
            <X className="mr-1 size-4" aria-hidden /> {t("replayClose")}
          </Button>
        </div>

        {!recorded ? (
          // No call behind this job — say so plainly rather than showing
          // playback controls that would do nothing.
          <div
            role="status"
            className="flex items-start gap-2 rounded-md border border-dashed p-4 text-sm text-muted-foreground"
          >
            <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
            <div className="space-y-1">
              <p>{t("replayNoCall")}</p>
              {job.status === "queued" ? (
                <p>
                  {t("replayQueued")} {new Date(job.due_at).toLocaleString()}
                </p>
              ) : null}
            </div>
          </div>
        ) : (
          <>
            {/* Transcript */}
            <ol className="space-y-2">
              {steps.map((step, i) => {
                const line = scriptLine(step.lineId);
                const isReaction = i === 2; // disclosure, ask, reaction, close
                const active = i === index;
                const reply = isReaction && outcome ? elderReply(outcome) : null;
                return (
                  <li key={`${step.lineId}-${i}`}>
                    <div
                      aria-current={active ? "true" : undefined}
                      data-line={step.lineId}
                      className={`rounded-md border p-3 ${
                        active ? "border-primary bg-accent" : "bg-muted/30"
                      }`}
                    >
                      <p className="text-xs font-semibold text-muted-foreground">
                        {t("replayAssistant")}
                      </p>
                      <p className="flex items-start gap-2 leading-relaxed">
                        <Volume2 className="mt-1 size-4 shrink-0 opacity-70" aria-hidden />
                        <span lang="yue-Hant-HK">{line?.zh}</span>
                      </p>
                      <p className="mt-1 pl-6 text-xs text-muted-foreground">{line?.en}</p>
                    </div>
                    {isReaction ? (
                      // The elder's side is a reconstruction, never a recording.
                      <div className="mt-2 rounded-md border border-dashed p-3">
                        <p className="flex items-center gap-2 text-xs font-semibold text-muted-foreground">
                          {t("replayElder")}
                          <span className="rounded-full bg-muted px-2 py-0.5 font-normal">
                            {t("replayReconstruction")}
                          </span>
                        </p>
                        <p className="mt-1 text-base" lang="yue-Hant-HK">
                          {reply ?? t("replayNoAnswerText")}
                        </p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {t("replayReconstructionNote")}
                        </p>
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ol>

            {/* Machine-readable state for tests and the browser check. */}
            <p role="status" className="text-xs text-muted-foreground">
              {musicOn
                ? `♪ ${t("replayMusic")}`
                : currentLineId
                  ? `${t("replayAssistant")}: ${currentLineId}`
                  : t("replayPlay")}
            </p>

            {/* Playback controls */}
            <div className="flex flex-wrap gap-2">
              <Button
                className="min-h-11"
                onClick={playing ? pause : play}
                aria-label={playing ? t("replayPause") : t("replayPlay")}
              >
                {playing ? (
                  <Pause className="mr-1 size-4" aria-hidden />
                ) : (
                  <Play className="mr-1 size-4" aria-hidden />
                )}
                {playing ? t("replayPause") : t("replayPlay")}
              </Button>
              <Button variant="outline" className="min-h-11" onClick={() => stepTo(index - 1)} disabled={index <= 0}>
                <SkipBack className="mr-1 size-4" aria-hidden /> {t("replayPrev")}
              </Button>
              <Button
                variant="outline"
                className="min-h-11"
                onClick={() => stepTo(index + 1)}
                disabled={index >= steps.length - 1}
              >
                {t("replayNext")} <SkipForward className="ml-1 size-4" aria-hidden />
              </Button>
              <Button variant="secondary" className="min-h-11" onClick={restart}>
                {t("replayRestart")}
              </Button>
            </div>

            {/* A single element carries the current line, so the audio that is
                actually playing is inspectable (and always the right clip). */}
            <audio data-testid="replay-audio" data-line={currentLineId ?? ""} />
          </>
        )}
      </div>
    </div>
  );
}
