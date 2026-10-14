// GET /api/health — prototype health check (monitoring requirement).
// Reports configuration status, queue/overdue counts and the last scheduler tick.
import { createFileRoute } from "@tanstack/react-router";
import { createAdminClient, serverConfigStatus } from "@/integrations/supabase/admin.server";

export const Route = createFileRoute("/api/health")({
  server: {
    handlers: {
      GET: async () => {
        const config = serverConfigStatus();
        const db = createAdminClient();
        if (!db) {
          return Response.json(
            { ok: false, config, error: "SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_URL) not configured" },
            { status: 503 },
          );
        }
        try {
          const now = new Date().toISOString();
          const [overdue, openCases, pending, stuck, ticks] = await Promise.all([
            db.from("elders").select("id", { count: "exact", head: true }).eq("status", "active").lt("next_check_at", now),
            db.from("cases").select("id", { count: "exact", head: true }).neq("status", "closed"),
            db.from("call_jobs").select("id", { count: "exact", head: true }).eq("status", "queued"),
            db
              .from("escalation_steps")
              .select("id", { count: "exact", head: true })
              .eq("status", "calling")
              .lt("started_at", new Date(Date.now() - 2 * 60_000).toISOString()),
            db.from("scheduler_runs").select("*").order("started_at", { ascending: false }).limit(1),
          ]);
          return Response.json({
            ok: true,
            at: now,
            config,
            counts: {
              overdue_elders: overdue.count ?? 0,
              open_cases: openCases.count ?? 0,
              queued_jobs: pending.count ?? 0,
              stuck_chain_steps: stuck.count ?? 0,
            },
            last_tick: ticks.data?.[0] ?? null,
          });
        } catch (e) {
          return Response.json({ ok: false, config, error: (e as Error).message }, { status: 500 });
        }
      },
    },
  },
});
