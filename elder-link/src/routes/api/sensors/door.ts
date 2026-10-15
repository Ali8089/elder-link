// POST /api/sensors/door — the door sensor's entry point into the call system.
//
// The poller (scripts/sensor-poller.mjs) watches the ESP32 and POSTs here when
// the door has been held open past the firmware's threshold:
//
//   { "elderId": "...", "externalId": "door:<device>:<iso>" }
//
// The endpoint turns that into a check-in call by reusing the runner that
// already owns every safety rule:
//
//   createCallJob(elder, "sensor")   consent gate + rate limit
//   record the sensor_alert          UNIQUE external_id → one call per episode
//   runCallJob                       place the call via the configured provider
//
// Why a server route rather than letting the poller touch the database:
// the caller is a script on a domestic network, so the credential it carries
// must be a narrow shared secret, not a database key. Everything privileged
// stays on this side.

import { createFileRoute } from "@tanstack/react-router";
import { serverRunner } from "@/lib/server/runner.server";
import { describeThreshold } from "@/lib/device-threshold";

function env(key: string): string | undefined {
  return typeof process !== "undefined" ? process.env[key] : undefined;
}

/**
 * Authorises the poller.
 *
 * A shared secret, not a user session: the poller is a headless process. When
 * no secret is configured the endpoint refuses rather than running open — an
 * unauthenticated endpoint that places phone calls is the worst possible
 * default, since anyone on the network could ring the elder repeatedly.
 */
function authorize(request: Request): boolean {
  const secret = env("SENSOR_TRIGGER_SECRET");
  if (!secret) return false;
  const provided =
    request.headers.get("x-sensor-secret") ??
    (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!provided || provided.length !== secret.length) return false;
  // Constant-time-ish comparison; the secret is short-lived and local, but a
  // naive === leaks length-prefix information for free.
  let diff = 0;
  for (let i = 0; i < secret.length; i++) diff |= provided.charCodeAt(i) ^ secret.charCodeAt(i);
  return diff === 0;
}

export const Route = createFileRoute("/api/sensors/door")({
  server: {
    handlers: {
      /**
       * GET — is the sensor endpoint configured, and what is the device's
       * threshold?
       *
       * Mirrors the speech route: the dashboard can ask whether the door sensor
       * will actually work before claiming that it will. The threshold is
       * reported here as well as in the UI because the dashboard should never
       * have to hardcode a number that belongs to the hardware.
       */
      GET: async () => {
        const configured = Boolean(env("SENSOR_TRIGGER_SECRET"));
        return Response.json({
          configured,
          threshold: describeThreshold(),
          ...(configured ? {} : { reason: "Set SENSOR_TRIGGER_SECRET to accept sensor triggers." }),
        });
      },

      POST: async ({ request }) => {
        if (!authorize(request)) {
          return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
        }

        let body: { elderId?: unknown; externalId?: unknown };
        try {
          body = (await request.json()) as typeof body;
        } catch {
          return Response.json({ ok: false, error: "malformed request" }, { status: 400 });
        }

        const elderId = typeof body.elderId === "string" ? body.elderId : "";
        const externalId = typeof body.externalId === "string" ? body.externalId : "";
        if (!elderId || !externalId) {
          return Response.json({ ok: false, error: "elderId and externalId are required" }, { status: 400 });
        }

        const runner = serverRunner();
        if (!runner) {
          return Response.json({ ok: false, error: "server not configured" }, { status: 503 });
        }

        // Claim the episode BEFORE placing any call. The UNIQUE constraint on
        // external_id is what guarantees one call per door-open episode across
        // restarts and concurrent pollers, so it must be won first: creating
        // the job first would mean a losing duplicate still rings the elder.
        const claim = await runner.claimSensorEpisode({ elderId, externalId });
        if (claim.duplicate) {
          return Response.json({ ok: true, duplicate: true, action: "none" });
        }

        try {
          const job = await runner.createCallJob(elderId, "sensor");
          await runner.attachAlertJob(externalId, job.id);
          await runner.audit("sensor.alert", "sensor_alerts");
          const result = await runner.runCallJob(job.id, null);
          return Response.json({ ok: true, duplicate: false, ...result });
        } catch (e) {
          // Consent missing or rate-limited. The episode stays claimed, which
          // is deliberate: retrying a blocked elder on every poll would hammer
          // a gate that is refusing on purpose.
          const error = (e as Error).message;
          await runner.audit(`sensor.blocked:${error.slice(0, 80)}`, "sensor_alerts");
          return Response.json({ ok: false, error }, { status: 409 });
        }
      },
    },
  },
});
