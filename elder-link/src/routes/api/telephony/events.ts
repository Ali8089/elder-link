// POST /api/telephony/events — provider webhook (speech result / call status).
// Verifies the provider signature (Twilio) or a shared secret, processes events
// idempotently, and applies the call outcome through the shared runner.
// Uses the Web Crypto API so it runs on any server runtime.
import { createFileRoute } from "@tanstack/react-router";
import { serverRunner } from "@/lib/server/runner.server";
import { dtmfToAnswer } from "@/lib/engine";

function env(key: string): string | undefined {
  return typeof process !== "undefined" ? process.env[key] : undefined;
}

function toBase64(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

/** Twilio signature: base64(HMAC-SHA1(authToken, url + sorted(paramName+paramValue))). */
async function twilioSignatureValid(
  url: string,
  params: Record<string, string>,
  signature: string,
  token: string,
): Promise<boolean> {
  const sorted = Object.keys(params).sort();
  let payload = url;
  for (const k of sorted) payload += k + params[k];
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(token), { name: "HMAC", hash: "SHA-1" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(payload));
  const expected = toBase64(new Uint8Array(sig));
  if (expected.length !== signature.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  return diff === 0;
}

export const Route = createFileRoute("/api/telephony/events")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const raw = await request.text();
        const params: Record<string, string> = {};
        for (const [k, v] of new URLSearchParams(raw)) params[k] = v;

        // 1) Authorise the caller: Twilio signature, or a shared secret.
        const url = new URL(request.url);
        const token = env("TWILIO_AUTH_TOKEN");
        const signature = request.headers.get("x-twilio-signature") ?? "";
        const shared = env("TELEPHONY_WEBHOOK_SECRET");
        const providedSecret = request.headers.get("x-webhook-secret") ?? url.searchParams.get("secret") ?? "";
        const publicUrl = `${request.headers.get("x-forwarded-proto") ?? url.protocol.replace(":", "")}://${request.headers.get("host") ?? url.host}${url.pathname}${url.search}`;

        const okSignature = token && signature ? await twilioSignatureValid(publicUrl, params, signature, token) : false;
        const okSecret = Boolean(shared && providedSecret && providedSecret === shared);
        if (!okSignature && !okSecret) {
          return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
        }

        const runner = serverRunner();
        if (!runner) return Response.json({ ok: false, error: "server not configured" }, { status: 503 });

        const jobId = url.searchParams.get("job") ?? "";
        const kind = url.searchParams.get("kind") ?? "speech";
        const callSid = params.CallSid ?? "unknown";
        const eventType = kind === "speech" ? "speech" : (params.CallStatus ?? "status");

        if (!jobId) return Response.json({ ok: false, error: "missing job id" }, { status: 400 });

        // 2) Idempotency — the same provider event is only processed once.
        const { duplicate } = await runner.recordTelephonyEvent(`${callSid}:${eventType}`, jobId, eventType);
        if (duplicate) return Response.json({ ok: true, duplicate: true });

        try {
          if (kind === "speech") {
            const speech = (params.SpeechResult ?? "").trim();
            // No speech captured → treated as no answer (never safe).
            const result = await runner.applyCallResult(jobId, speech.length ? speech : null);
            return Response.json({ ok: true, ...result });
          }
          if (kind === "dtmf") {
            // Keypad answer: 1 = safe, 2 = worrying, 3 = danger. No digit → no answer.
            const result = await runner.applyCallResult(jobId, dtmfToAnswer(params.Digits));
            return Response.json({ ok: true, ...result });
          }
          // Status callbacks: only act on terminal failure states.
          const status = (params.CallStatus ?? "").toLowerCase();
          if (["no-answer", "busy", "failed", "canceled"].includes(status)) {
            const result = await runner.applyCallResult(jobId, null);
            return Response.json({ ok: true, ...result });
          }
          return Response.json({ ok: true, ignored: status });
        } catch (e) {
          return Response.json({ ok: false, error: (e as Error).message }, { status: 500 });
        }
      },
    },
  },
});
