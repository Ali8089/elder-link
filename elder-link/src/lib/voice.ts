// Voice engine adapters. Mirrors the shape of TelephonyProvider in telephony.ts
// so the speech layer can be swapped by configuration without touching the
// orchestrator, the rules engine or the dashboard.
//
// Two directions are modelled:
//   - speak()      text  -> audio   (the assistant's turn)
//   - transcribe() audio -> text    (the elder's turn)
//
// Providers are selected by env at runtime (see selectVoiceEngine). The default
// is the offline bundle: pre-generated audio assets plus no speech recognition,
// which keeps a fresh clone fully working with no accounts and no network.
//
// Why pre-generated rather than a live TTS call: the check-in script is a fixed,
// finite set of lines known at build time. Synthesising them once removes a
// network dependency that could otherwise fail mid-call, costs nothing at
// runtime, and cannot hit a quota ceiling. See scripts/generate-audio.mjs.

import type { Outcome } from "./engine";

/** A spoken audio clip the assistant can play. */
export type VoiceClip = {
  /** Script line id this clip speaks (matches CALL_SCRIPT ids). */
  lineId: string;
  /** Publicly reachable URL or bundled asset path. */
  url: string;
  /** Spoken text, retained so captions and transcripts stay in sync. */
  text: string;
  /** Language tag, e.g. yue-Hant-HK. */
  lang: string;
};

/** What a transcriber returns for one elder utterance. */
export type Transcription = {
  /** Best-guess transcript. Empty string when nothing intelligible was heard. */
  text: string;
  /** Confidence 0–1 when the provider reports one. */
  confidence?: number;
  /**
   * Why the transcript is empty, when that is a failure rather than silence.
   * Distinguishes "nobody spoke" from "the recogniser is misconfigured", which
   * are the same shape to the caller but need very different fixes.
   */
  error?: string;
};

export interface VoiceEngine {
  readonly name: string;
  /**
   * The assistant's turn. Returns a clip to play, or null when no audio is
   * available — callers must still show the caption, so an elder is never left
   * with silence and no feedback.
   */
  speak(lineId: string, text: string, lang?: string): Promise<VoiceClip | null>;
  /**
   * The elder's turn. Returns the transcript, or an empty transcript when the
   * audio was silent/unintelligible. Never throws for "nothing heard" — that is
   * a valid outcome, and the caller maps it to the no-answer/unclear path.
   */
  transcribe(audio: Blob | ArrayBuffer): Promise<Transcription>;
}

const DEFAULT_LANG = "yue-Hant-HK";

/**
 * Offline engine: serves the pre-generated MP3s from /audio and does no speech
 * recognition. This is the default so the app works with zero configuration.
 */
export function createOfflineEngine(assets: Record<string, string>): VoiceEngine {
  return {
    name: "offline",
    async speak(lineId, text, lang = DEFAULT_LANG) {
      const url = assets[lineId];
      if (!url) return null;
      return { lineId, url, text, lang };
    },
    async transcribe() {
      // No recogniser in the offline bundle — the caller falls back to the
      // keypad, which is the more accessible input anyway.
      return { text: "" };
    },
  };
}

/**
 * Builds the speech-recognition engine against an OpenAI-compatible
 * /v1/audio/transcriptions endpoint. Works with OpenAI Whisper, a self-hosted
 * faster-whisper server, or any gateway exposing the same shape.
 */
export type WhisperConfig = {
  endpoint: string;
  apiKey?: string | undefined;
  model?: string | undefined;
  language?: string | undefined;
};

export function createWhisperEngine(cfg: WhisperConfig): VoiceEngine {
  const model = cfg.model ?? "whisper-1";
  const language = cfg.language ?? "yue";
  return {
    name: "whisper",
    async speak(lineId, text, lang = DEFAULT_LANG) {
      // Speech recognition only — audio playback stays with the asset bundle.
      return { lineId, url: "", text, lang };
    },
    async transcribe(audio) {
      const form = new FormData();
      form.append("file", audio instanceof Blob ? audio : new Blob([audio]), "answer.webm");
      form.append("model", model);
      form.append("language", language);
      const headers: Record<string, string> = {};
      if (cfg.apiKey) headers["Authorization"] = `Bearer ${cfg.apiKey}`;
      try {
        const res = await fetch(cfg.endpoint, { method: "POST", headers, body: form });
        if (!res.ok) {
          // Surface the status: a 401 means a bad key and a 429 means a quota
          // ceiling. Both look like "no speech detected" to the UI otherwise.
          const detail = await res.text().catch(() => "");
          return {
            text: "",
            error: `Speech service returned ${res.status}${detail ? `: ${detail.slice(0, 120)}` : ""}`,
          };
        }
        const json = (await res.json()) as { text?: string };
        return { text: (json.text ?? "").trim() };
      } catch (e) {
        // A recogniser outage must never become a dropped call: an empty
        // transcript routes to the existing unclear/no-answer handling.
        return { text: "", error: (e as Error).message || "network error" };
      }
    },
  };
}

/**
 * Speech recognition via this app's own server route.
 *
 * Preferred over putting a key in the browser: the key stays server-side, and
 * the UI can ask whether recognition is available before offering the button.
 * See src/routes/api/speech/transcribe.ts.
 */
export const SERVER_SPEECH_ENDPOINT = "/api/speech/transcribe";

export function createServerSpeechEngine(
  endpoint = SERVER_SPEECH_ENDPOINT,
): VoiceEngine {
  return {
    name: "server-whisper",
    async speak(lineId, text, lang = DEFAULT_LANG) {
      // Recognition only; playback stays with the asset bundle.
      return { lineId, url: "", text, lang };
    },
    async transcribe(audio) {
      const form = new FormData();
      form.append("audio", audio instanceof Blob ? audio : new Blob([audio]), "answer.webm");
      try {
        const res = await fetch(endpoint, { method: "POST", body: form });
        const json = (await res.json().catch(() => ({}))) as { text?: string; error?: string };
        if (!res.ok) return { text: "", error: json.error ?? `Speech route returned ${res.status}` };
        return { text: (json.text ?? "").trim(), ...(json.error ? { error: json.error } : {}) };
      } catch (e) {
        return { text: "", error: (e as Error).message || "network error" };
      }
    },
  };
}

/**
 * Is the server-side recogniser available?
 *
 * The call UI calls this before rendering the "Answer by voice" control, so the
 * button is only offered when pressing it would work. Gating on a client-side
 * key instead was the bug that made the button never appear.
 */
export async function speechIsAvailable(
  endpoint = SERVER_SPEECH_ENDPOINT,
): Promise<{ available: boolean; reason?: string }> {
  try {
    const res = await fetch(endpoint);
    if (!res.ok) return { available: false, reason: `Speech route returned ${res.status}` };
    const json = (await res.json()) as { available?: boolean; reason?: string };
    return json.available
      ? { available: true }
      : { available: false, ...(json.reason ? { reason: json.reason } : {}) };
  } catch {
    return { available: false, reason: "Could not reach the speech route." };
  }
}

/** Chooses the engine from environment variables; offline bundle by default. */
export function selectVoiceEngine(
  env: Record<string, string | undefined>,
  assets: Record<string, string>,
): VoiceEngine {
  // Preferred path: our own server route, which holds the key. Always available
  // as an option — the server decides whether it can actually transcribe.
  if (env["VITE_SPEECH_MODE"] !== "client") {
    const endpoint = env["VITE_SPEECH_ENDPOINT"] || SERVER_SPEECH_ENDPOINT;
    return createServerSpeechEngine(endpoint);
  }

  // Groq directly from the browser. Only for local experiments: the key is
  // inlined into the bundle and readable by anyone.
  const groqKey = env["GROQ_API_KEY"] ?? env["VITE_GROQ_API_KEY"];
  if (groqKey && env["SPEECH_TO_TEXT_PROVIDER"] !== "custom") {
    return createGroqSttEngine({ apiKey: groqKey });
  }

  const endpoint = env["SPEECH_TO_TEXT_URL"];
  if (endpoint) {
    // exactOptionalPropertyTypes: build the object conditionally so absent keys
    // are omitted rather than set to undefined.
    const cfg: WhisperConfig = { endpoint };
    const apiKey = env["SPEECH_TO_TEXT_API_KEY"];
    const model = env["SPEECH_TO_TEXT_MODEL"];
    const language = env["SPEECH_TO_TEXT_LANGUAGE"];
    if (apiKey) cfg.apiKey = apiKey;
    if (model) cfg.model = model;
    if (language) cfg.language = language;
    return createWhisperEngine(cfg);
  }
  return createOfflineEngine(assets);
}

// ---------------------------------------------------------------------------
// Groq — the recommended free speech-recognition provider
// ---------------------------------------------------------------------------

/**
 * Groq's Whisper endpoint. OpenAI-compatible, so `createWhisperEngine` itself
 * works unchanged; these constants just save repeating the URL and model id.
 *
 * Free tier, no credit card: <https://console.groq.com/keys>
 */
export const GROQ_STT_DEFAULTS = {
  endpoint: "https://api.groq.com/openai/v1/audio/transcriptions",
  /**
   * `whisper-large-v3` rather than the cheaper `-turbo`: the turbo model is
   * noticeably weaker on Cantonese, and a check-in call is a few seconds of
   * audio at a time, so the cost difference is irrelevant at this scale.
   */
  model: "whisper-large-v3",
} as const;

export type GroqSttConfig = {
  apiKey: string;
  model?: string | undefined;
  /** Whisper uses ISO-639-1, so this is "yue" — not the BCP-47 "yue-Hant-HK". */
  language?: string | undefined;
};

export function createGroqSttEngine(cfg: GroqSttConfig): VoiceEngine {
  const inner = createWhisperEngine({
    endpoint: GROQ_STT_DEFAULTS.endpoint,
    apiKey: cfg.apiKey,
    model: cfg.model ?? GROQ_STT_DEFAULTS.model,
    language: cfg.language ?? "yue",
  });
  return { ...inner, name: "groq-whisper" };
}

/**
 * Music played once the check-in call ends well.
 *
 * Deliberately restricted to the safe path: the worry/danger script closes by
 * telling the elder to call 999, and music over that instruction would be
 * actively dangerous. See MUSIC_OUTCOMES — every other outcome stays silent.
 */
export const MUSIC_OUTCOMES: readonly Outcome[] = ["safe"] as const;

/** True when music is allowed to play for this outcome. */
export function mayPlayClosingMusic(outcome: Outcome): boolean {
  return MUSIC_OUTCOMES.includes(outcome);
}

/** Volume for the closing music, as a fraction of full scale. */
export const CLOSING_MUSIC_VOLUME = 0.18;

/** Milliseconds to fade the music in and out, so it never startles. */
export const CLOSING_MUSIC_FADE_MS = 1200;
