// POST /api/sensors/trigger — the dashboard's "trigger sensor" button.
//
// A caregiver clicking "觸發感應器" must produce EXACTLY the same behaviour as a
// physical door opening: one call per episode, consent checked, an alert row
// written against the REAL elder id, and the safe path able to close it.
//
// Why this is a separate route from /api/sensors/door rather than reusing it:
// door.ts authenticates the *poller* with a narrow shared secret
// (SENSOR_TRIGGER_SECRET) carried by a headless process on the elder's LAN. That
// secret must never reach a browser, so the dashboard cannot call door.ts
// directly. This route authenticates the *signed-in staff member* instead, using
// the Supabase access token the browser already holds — no shared secret is
// exposed — and then runs the identical claim-then-call sequence through the
// same service-role runner. Two doors, one room.
//
// History: the dashboard previously wrote the alert itself through the browser
// (anon) client using a hardcoded demo elder uuid. That uuid does not exist in
// the real `elders` table, so every insert failed the
// `sensor_alerts_elder_id_fkey` foreign key — and because a Supabase insert
// returns an error object rather than throwing, the failure was silently
// discarded. This route removes both problems: the id comes from the real elder
// list, and a failure is a non-2xx response the UI is forced to surface.

import { createFileRoute } from "@tanstack/react-router";
import { createAdminClient, createAnonClient } from "@/integrations/supabase/admin.server";
import { serverRunner } from "@/lib/server/runner.server";

/**
 * Authorises a signed-in staff member.
 *
 * Mirrors /api/test/call: the browser only ever sends its Supabase access
 * token; the privileged work happens here with the service-role client.
 */
async function authorizeStaff(request: Request): Promise<boolean> {
  const anon = createAnonClient();
  const admin = createAdminClient();
  if (!anon || !admin) return false;
  const bearer = (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!bearer) return false;
  const { data: userData } = await anon.auth.getUser(bearer);
  if (!userData.user) return false;
  const role = await admin.from("user_roles").select("role").eq("user_id", userData.user.id).limit(1);
  return Boolean(role.data?.length);
}

export const Route = createFileRoute("/api/sensors/trigger")({
  server: {
    handlers: {
      /**
       * GET — can the button actually work?
       *
       * Mirrors door.ts's GET and the speech route: the dashboard can ask
       * before claiming a control will do anything, so the caregiver is never
       * shown a button that silently no-ops.
       */
      GET: async () => {
        const configured = Boolean(serverRunner());
        return Response.json({
          configured,
          ...(configured ? {} : { reason: "Server is not configured (SUPABASE_SERVICE_ROLE_KEY missing)." }),
        });
      },

      POST: async ({ request }) => {
        if (!(await authorizeStaff(request))) {
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

        // Claim the episode BEFORE placing any call — identical to door.ts. The
        // UNIQUE constraint on external_id is what guarantees one call per
        // episode; winning the claim first means a duplicate click can never
        // ring the elder twice.
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
          // Consent missing or rate-limited. The episode stays claimed, which is
          // deliberate: the poller/manual retry must not hammer a refusing gate.
          const error = (e as Error).message;
          await runner.audit(`sensor.blocked:${error.slice(0, 80)}`, "sensor_alerts");
          return Response.json({ ok: false, error }, { status: 409 });
        }
      },
    },
  },
});
