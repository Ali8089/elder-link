// GET /api/analytics/summary — aggregate prototype metrics (PRD API list).
// Privacy-safe: counts and timings only, never phone numbers or note text.
// Protected by the CRON_SECRET (or staff bearer token).
import { createFileRoute } from "@tanstack/react-router";
import { createAdminClient, createAnonClient } from "@/integrations/supabase/admin.server";
import { authorizeCron } from "@/lib/server/runner.server";
import { escalationWithinLimit } from "@/lib/engine";

export const Route = createFileRoute("/api/analytics/summary")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const admin = createAdminClient();
        if (!admin) return Response.json({ ok: false, error: "server not configured" }, { status: 503 });

        // Authorise: cron secret, or a signed-in staff member.
        let authorised = authorizeCron(request);
        if (!authorised) {
          const anon = createAnonClient();
          const bearer = (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
          if (anon && bearer) {
            const { data } = await anon.auth.getUser(bearer);
            if (data.user) {
              const role = await admin.from("user_roles").select("role").eq("user_id", data.user.id).limit(1);
              authorised = Boolean(role.data?.length);
            }
          }
        }
        if (!authorised) return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });

        const [jobs, cases, elders, interests] = await Promise.all([
          admin.from("call_jobs").select("outcome, kind"),
          admin.from("cases").select("status, trigger_at, escalation_started_at"),
          admin.from("elders").select("status, next_check_at"),
          admin.from("activity_interests").select("id", { count: "exact", head: true }),
        ]);

        const jobsRows = jobs.data ?? [];
        const caseRows = cases.data ?? [];
        const elderRows = elders.data ?? [];
        const now = new Date();
        const count = (o: string) => jobsRows.filter((j: any) => j.outcome === o).length;
        const timed = caseRows.filter((c: any) => c.escalation_started_at);
        const within = timed.filter((c: any) => escalationWithinLimit(c.trigger_at, c.escalation_started_at)).length;

        return Response.json({
          ok: true,
          at: now.toISOString(),
          outcomes: {
            safe: count("safe"),
            worrying: count("worrying"),
            danger: count("danger"),
            unclear: count("unclear"),
            no_answer: count("no_answer"),
          },
          cases: {
            open: caseRows.filter((c: any) => c.status === "open").length,
            acknowledged: caseRows.filter((c: any) => c.status === "acknowledged").length,
            closed: caseRows.filter((c: any) => c.status === "closed").length,
            escalation_within_60s_percent: timed.length ? Math.round((within / timed.length) * 100) : null,
          },
          elders: {
            active: elderRows.filter((e: any) => e.status === "active").length,
            draft: elderRows.filter((e: any) => e.status === "draft").length,
            opted_out: elderRows.filter((e: any) => e.status === "opted_out").length,
            overdue: elderRows.filter((e: any) => e.status === "active" && e.next_check_at && new Date(e.next_check_at) < now).length,
          },
          activity_interests: interests.count ?? 0,
        });
      },
    },
  },
});
