// Telephony adapters. Swap the provider without touching the orchestrator.
// Mock is the default so the service runs with no vendor account connected.
// Set TELEPHONY_PROVIDER=twilio plus the TWILIO_* variables to place real calls.
//
// Twilio auth: prefer an API Key (SK… + secret) over the account Auth Token.
// The account SID (AC…) is still required in the API URL path.
import type { Outcome } from "./engine";
import { CALL_SCRIPT } from "./script";

export interface PlaceCallInput {
  jobId: string;
  to: string;
  /** Only used by the mock provider (simulated spoken answer). */
  simulatedAnswer?: string | null;
}

export interface PlaceCallResult {
  /** Provider event id — used for idempotency. */
  eventId: string;
  /** Spoken answer text (real provider) or the simulated answer (mock). */
  answer: string | null;
  /** Provider call id, when a real call was placed. */
  providerCallId?: string;
  /** True when a call was accepted by the provider. */
  placed: boolean;
  error?: string;
}

export interface TelephonyProvider {
  name: string;
  /** Places a call and resolves with the provider's event id and the answer text. */
  placeCall(input: PlaceCallInput): Promise<PlaceCallResult>;
}

export const MockProvider: TelephonyProvider = {
  name: "mock",
  async placeCall({ jobId, simulatedAnswer }) {
    return {
      eventId: `mock-${jobId}-${Date.now()}`,
      answer: simulatedAnswer ?? null,
      placed: true,
    };
  },
};

export interface TwilioConfig {
  /** Account SID (starts with AC…) — used in the API URL. */
  accountSid: string;
  /** Basic-auth username: API Key SID (SK…) or the Account SID. */
  authUser: string;
  /** Basic-auth password: API Key secret, or the account Auth Token. */
  authPass: string;
  /** Fixed caller number in E.164, e.g. +85212345678. */
  fromNumber: string;
  /** <Say> language, e.g. yue-HK. Must match the chosen voice. */
  language?: string | undefined;
  /** Explicit voice, e.g. Google.yue-HK-Standard-A. Strongly recommended for Cantonese. */
  voice?: string | undefined;
  /** Public URL of the webhook route. */
  webhookUrl: string;
  /** Optional pre-generated Cantonese audio URL to play instead of <Say>. */
  audioUrl?: string | undefined;
}

/**
 * Twilio adapter.
 * - Places a real outbound call from a fixed caller number.
 * - Speaks the approved bilingual script (AI disclosure first).
 * - Captures the answer by keypad (DTMF, most reliable) or by speech.
 * - Recording is never enabled (FR-13).
 */
export function createTwilioProvider(cfg: TwilioConfig): TelephonyProvider {
  const lang = cfg.language || "yue-HK";
  return {
    name: "twilio",
    async placeCall({ jobId, to }) {
      const body = new URLSearchParams({
        To: to,
        From: cfg.fromNumber,
        Twiml: buildGatherTwiml({
          jobId,
          language: lang,
          voice: cfg.voice,
          webhookUrl: cfg.webhookUrl,
          audioUrl: cfg.audioUrl,
        }),
        Record: "false", // never record (FR-13)
        MachineDetection: "Enable",
        StatusCallback: `${cfg.webhookUrl}?job=${encodeURIComponent(jobId)}&kind=status`,
      });
      try {
        const res = await fetch(
          `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(cfg.accountSid)}/Calls.json`,
          {
            method: "POST",
            headers: {
              Authorization: "Basic " + btoa(`${cfg.authUser}:${cfg.authPass}`),
              "Content-Type": "application/x-www-form-urlencoded",
            },
            body,
          },
        );
        const json = (await res.json()) as { sid?: string; message?: string; code?: number };
        if (!res.ok || !json.sid) {
          return {
            eventId: `twilio-error-${jobId}-${Date.now()}`,
            answer: null,
            placed: false,
            error: json.message ?? `HTTP ${res.status}`,
          };
        }
        // The answer arrives later via the webhook; a real call has no inline answer.
        return { eventId: `twilio-${json.sid}`, answer: null, providerCallId: json.sid, placed: true };
      } catch (e) {
        return { eventId: `twilio-error-${jobId}-${Date.now()}`, answer: null, placed: false, error: (e as Error).message };
      }
    },
  };
}

/**
 * TwiML for one check-in call.
 * Keypad (DTMF) is the default because it is free, instant and never mis-hears:
 *   1 = safe, 2 = worrying, 3 = immediate danger.
 * Set `mode: "speech"` to gather a spoken answer instead.
 */
export function buildGatherTwiml(input: {
  jobId: string;
  language: string;
  voice?: string | undefined;
  webhookUrl: string;
  audioUrl?: string | undefined;
  mode?: "dtmf" | "speech";
}): string {
  const disclosure = CALL_SCRIPT.find((s) => s.id === "disclosure")!;
  const ask = CALL_SCRIPT.find((s) => s.id === "ask")!;
  const close = CALL_SCRIPT.find((s) => s.id === "close")!;
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const mode = input.mode ?? "dtmf";
  const action = `${input.webhookUrl}?job=${encodeURIComponent(input.jobId)}&kind=${mode}`;
  const voiceAttr = input.voice ? ` voice="${esc(input.voice)}"` : "";

  // Pre-generated Cantonese audio (free TTS tier) avoids carrier voice-quality issues.
  const prompt = input.audioUrl
    ? `<Play>${esc(input.audioUrl)}</Play>`
    : `<Say language="${esc(input.language)}"${voiceAttr}>${esc(disclosure.zh)}</Say>`;
  const askPart = input.audioUrl
    ? ""
    : `<Say language="${esc(input.language)}"${voiceAttr}>${esc(ask.zh)}</Say>`;

  const gather =
    mode === "speech"
      ? `<Gather input="speech" speechTimeout="auto" language="${esc(input.language)}" action="${esc(action)}" method="POST">${askPart}</Gather>`
      : `<Gather input="dtmf" numDigits="1" timeout="6" action="${esc(action)}" method="POST">${askPart}</Gather>`;

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    "<Response>",
    prompt,
    gather,
    `<Say language="${esc(input.language)}"${voiceAttr}>${esc(close.zh)}</Say>`,
    "<Hangup/>",
    "</Response>",
  ].join("");
}

/** Chooses the provider from environment variables; mock by default. */
export function selectProvider(env: Record<string, string | undefined>): TelephonyProvider {
  const kind = (env["TELEPHONY_PROVIDER"] ?? "mock").toLowerCase();
  const accountSid = env["TWILIO_ACCOUNT_SID"];
  const authUser = env["TWILIO_API_KEY_SID"] || env["TWILIO_ACCOUNT_SID"];
  const authPass = env["TWILIO_API_KEY_SECRET"] || env["TWILIO_AUTH_TOKEN"];
  if (kind === "twilio" && accountSid && authUser && authPass && env["TWILIO_FROM_NUMBER"]) {
    return createTwilioProvider({
      accountSid,
      authUser,
      authPass,
      fromNumber: env["TWILIO_FROM_NUMBER"],
      language: env["TWILIO_LANGUAGE"],
      voice: env["TWILIO_VOICE"],
      webhookUrl: env["TELEPHONY_WEBHOOK_URL"] ?? "",
      audioUrl: env["TWILIO_AUDIO_URL"],
    });
  }
  return MockProvider;
}

export const SAMPLE_ANSWERS: Record<Outcome, string | null> = {
  safe: "我幾好，冇事",
  worrying: "有啲頭暈，唔舒服",
  danger: "我跌倒咗，救命",
  unclear: "嗯……",
  no_answer: null,
};
