// POST /api/speech/transcribe — server-side speech recognition.
//
// Why this exists rather than calling the provider from the browser:
//
//   * The API key stays on the server. Browser-side transcription needs a
//     VITE_-prefixed variable, which is inlined into the JavaScript bundle and
//     readable by anyone who opens devtools. A check-in service for vulnerable
//     people should not be operated on a key the public can lift.
//   * Only the API key holder can rotate or rate-limit it. Server-side means a
//     leaked client cannot burn the quota.
//   * One place to swap providers.
//
// The response shape is deliberately small and never includes the provider's
// raw error body, so a misconfigured key cannot dump vendor detail to a caller.

import { createFileRoute } from "@tanstack/react-router";

/** Groq is the default because its free tier covers Whisper. */
const GROQ_URL = "https://api.groq.com/openai/v1/audio/transcriptions";

/** Cantonese. Whisper uses ISO-639-1 here, not the BCP-47 tag. */
const DEFAULT_LANGUAGE = "yue";

/** Reject anything implausibly large before forwarding it upstream. */
const MAX_BYTES = 8 * 1024 * 1024;

/**
 * How long to wait for the recogniser before aborting, in milliseconds.
 *
 * This was 25s, chosen when the only provider was Groq's cloud API, which
 * answers in well under a second — a 25s ceiling there only ever caught a dead
 * network. That assumption is wrong for the self-hosted faster-whisper server
 * the project now recommends: QA measured a single clip end-to-end at 18–32s on
 * CPU, and a cold request also pays the one-off model-load cost. At 25s a
 * perfectly healthy local server was aborted mid-transcription and the caller
 * got a 502 "Speech service timed out" on almost every real check-in.
 *
 * The default is therefore 120s — roughly 4x the measured worst case — so CPU
 * inference has room to finish. Do NOT lower it back toward the cloud-era value:
 * a slow-but-working transcription must complete, and a call that waits is far
 * better than a call that fails. A fast cloud endpoint can opt into a shorter
 * ceiling explicitly via SPEECH_TO_TEXT_TIMEOUT_MS; the default stays generous
 * because the default provider is now local CPU inference.
 */
const DEFAULT_TIMEOUT_MS = 120_000;

/**
 * The upstream timeout, overridable with SPEECH_TO_TEXT_TIMEOUT_MS.
 *
 * A malformed or non-positive value falls back to the default rather than being
 * honoured: a NaN/0/negative timeout would abort every request immediately,
 * which is a worse failure than a typo going unnoticed.
 */
export function resolveTimeoutMs(env: Record<string, string | undefined>): number {
  const raw = env["SPEECH_TO_TEXT_TIMEOUT_MS"];
  if (!raw) return DEFAULT_TIMEOUT_MS;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_TIMEOUT_MS;
  return parsed;
}

type Provider = { url: string; key: string; model: string; language: string };

/**
 * Resolves the provider from the environment.
 *
 * Groq is preferred, but any OpenAI-compatible Whisper endpoint works via
 * SPEECH_TO_TEXT_URL, so a self-hosted faster-whisper drops in unchanged.
 */
export function resolveSpeechProvider(
  env: Record<string, string | undefined>,
): Provider | { error: string } {
  const language = env["SPEECH_TO_TEXT_LANGUAGE"] || DEFAULT_LANGUAGE;

  const groqKey = env["GROQ_API_KEY"];
  if (groqKey) {
    return {
      url: GROQ_URL,
      key: groqKey,
      model: env["SPEECH_TO_TEXT_MODEL"] || "whisper-large-v3",
      language,
    };
  }

  const url = env["SPEECH_TO_TEXT_URL"];
  if (url) {
    const key = env["SPEECH_TO_TEXT_API_KEY"] || "";
    return {
      url,
      key,
      model: env["SPEECH_TO_TEXT_MODEL"] || "whisper-1",
      language,
    };
  }

  return {
    error:
      "No speech provider configured. Set GROQ_API_KEY (free at console.groq.com/keys) " +
      "or SPEECH_TO_TEXT_URL. Until then the call uses the keypad only.",
  };
}

export const Route = createFileRoute("/api/speech/transcribe")({
  server: {
    handlers: {
      /**
       * GET — is speech recognition available?
       *
       * The call UI asks this before showing the "Answer by voice" button, so
       * the control only appears when pressing it would actually work. That is
       * the specific bug this fixes: the button was gated on a client-side key
       * that was never present, so it silently never appeared.
       */
      GET: async () => {
        const provider = resolveSpeechProvider(process.env);
        if ("error" in provider) {
          return Response.json({ available: false, reason: provider.error }, { status: 200 });
        }
        return Response.json({
          available: true,
          model: provider.model,
          language: provider.language,
        });
      },

      POST: async ({ request }) => {
        const provider = resolveSpeechProvider(process.env);
        if ("error" in provider) {
          return Response.json({ text: "", error: provider.error }, { status: 503 });
        }

        let audio: ArrayBuffer;
        try {
          const form = await request.formData();
          const file = form.get("audio");
          if (!(file instanceof Blob)) {
            return Response.json({ text: "", error: "No audio supplied." }, { status: 400 });
          }
          if (file.size === 0) {
            // Silence is a normal outcome, not an error — the caller maps it to
            // the no-answer path.
            return Response.json({ text: "" });
          }
          if (file.size > MAX_BYTES) {
            return Response.json({ text: "", error: "Recording too long." }, { status: 413 });
          }
          audio = await file.arrayBuffer();
        } catch {
          return Response.json({ text: "", error: "Malformed request." }, { status: 400 });
        }

        const upstream = new FormData();
        // The extension matters: Whisper infers the container from the filename.
        upstream.append("file", new Blob([audio], { type: "audio/webm" }), "answer.webm");
        upstream.append("model", provider.model);
        upstream.append("language", provider.language);
        // Bias the model toward the shape of an answer we expect. Whisper
        // hallucinates confidently on short, quiet audio, and a check-in call
        // is exactly that; naming the context measurably reduces invented words.
        upstream.append(
          "prompt",
          "一位長者回答每日問候電話。佢會講自己今日身體點，例如「我冇事」、「幾好」、「有啲頭暈」。",
        );

        const headers: Record<string, string> = {};
        if (provider.key) headers["Authorization"] = `Bearer ${provider.key}`;

        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), resolveTimeoutMs(process.env));
        try {
          const res = await fetch(provider.url, {
            method: "POST",
            headers,
            body: upstream,
            signal: controller.signal,
          });
          if (!res.ok) {
            // Map the status to something actionable, without echoing the
            // provider's body, which can contain key fragments.
            const hint =
              res.status === 401 ? "The speech API key was rejected."
              : res.status === 429 ? "The speech service is rate-limited; try again shortly."
              : res.status === 413 ? "Recording too long."
              : `Speech service error ${res.status}.`;
            return Response.json({ text: "", error: hint }, { status: 502 });
          }
          const json = (await res.json()) as { text?: string };
          return Response.json({ text: (json.text ?? "").trim() });
        } catch (e) {
          const aborted = (e as Error).name === "AbortError";
          return Response.json(
            { text: "", error: aborted ? "Speech service timed out." : "Could not reach the speech service." },
            { status: 502 },
          );
        } finally {
          clearTimeout(timer);
        }
      },
    },
  },
});
