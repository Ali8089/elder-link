// POST /api/cron/tick — the server-side scheduler.
// Runs: due check-in jobs → due queued/retry calls → stale contact-chain steps
//       → 30-day deletion. Protected by the CRON_SECRET shared secret.
// Call this every minute (Vercel Cron on Pro, or an external scheduler).
import { createFileRoute } from "@tanstack/react-router";
import { authorizeCron, serverRunner } from "@/lib/server/runner.server";

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
          return Response.json({ ...result, at: new Date().toISOString() }, { status: result.ok ? 200 : 500 });
        } catch (e) {
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
        return Response.json({ ...result, at: new Date().toISOString() }, { status: result.ok ? 200 : 500 });
      },
    },
  },
});
