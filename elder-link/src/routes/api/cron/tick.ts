// POST /api/cron/tick — the server-side scheduler.
// Runs: due check-in jobs → due queued/retry calls → stale contact-chain steps
//       → door sensors → 30-day deletion. Protected by the CRON_SECRET shared secret.
// Call this every minute (Vercel Cron on Pro, or an external scheduler).
//
// This endpoint is also the app's *external* pulse. The door-sensor watchdog and
// the alert escalation clock both need to know how long it has been since the
// scheduler last ran, and they cannot read that from the database — a stopped
// scheduler writes nothing, so silence looks identical to "the elder's door was
// closed all day". The heartbeat file is written on every tick for them to
// watch, and is the only state this endpoint keeps outside Supabase.
import { createFileRoute } from "@tanstack/react-router";
import { authorizeCron, serverRunner } from "@/lib/server/runner.server";
import { heartbeat } from "@/lib/runner-heartbeat";

export const Route = createFileRoute("/api/cron/tick")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!authorizeCron(request)) {
          return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
        }
        const runner = serverRunner();
        if (!runner) {
          return Response.json({ ok: false, error: "server not configured (SUPABASE_SERVICE_ROLE_KEY)" }, { status: 503 });
        }
        try {
          const result = await runner.tick();
          // Record the pulse even on a failed tick: the scheduler IS alive and
          // being driven, it is the work inside that failed, and the watchdog
          // must distinguish those two situations.
          await heartbeat.record(new Date(), { ok: result.ok });
          return Response.json({ ...result, at: new Date().toISOString() }, { status: result.ok ? 200 : 500 });
        } catch (e) {
          await heartbeat.record(new Date(), { ok: false });
          return Response.json({ ok: false, error: (e as Error).message }, { status: 500 });
        }
      },
      // Allow a GET with the same secret so simple uptime checkers can drive it.
      GET: async ({ request }) => {
        if (!authorizeCron(request)) {
          return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
        }
        const runner = serverRunner();
        if (!runner) {
          return Response.json({ ok: false, error: "server not configured" }, { status: 503 });
        }
        const result = await runner.tick();
        await heartbeat.record(new Date(), { ok: result.ok });
        return Response.json({ ...result, at: new Date().toISOString() }, { status: result.ok ? 200 : 500 });
      },
    },
  },
});
