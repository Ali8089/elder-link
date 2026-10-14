// POST /api/test/call — place a REAL check-in call now (staff only).
// Secrets stay server-side: the browser only sends its Supabase access token.
// If no real provider is configured this returns 409 and the dashboard falls
// back to the mock demo call.
import { createFileRoute } from "@tanstack/react-router";
import { createAdminClient, createAnonClient } from "@/integrations/supabase/admin.server";
import { serverRunner } from "@/lib/server/runner.server";

export const Route = createFileRoute("/api/test/call")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const anon = createAnonClient();
        const admin = createAdminClient();
        const runner = serverRunner();
        if (!anon || !admin || !runner) {
          return Response.json({ ok: false, error: "server not configured" }, { status: 503 });
        }

        // 1) Only signed-in staff may trigger a real call.
        const bearer = (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
        if (!bearer) return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
        const { data: userData } = await anon.auth.getUser(bearer);
        if (!userData.user) return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
        const role = await admin.from("user_roles").select("role").eq("user_id", userData.user.id).limit(1);
        if (!role.data?.length) return Response.json({ ok: false, error: "forbidden" }, { status: 403 });

        // 2) Is a real provider configured?
        const provider = (process.env["TELEPHONY_PROVIDER"] ?? "mock").toLowerCase();
        if (provider === "mock") {
          return Response.json(
            { ok: false, error: "no_real_provider", message: "Set TELEPHONY_PROVIDER=twilio and TWILIO_* variables to place real calls." },
            { status: 409 },
          );
        }

        let elderId = "";
        try {
          const body = (await request.json()) as { elderId?: string };
          elderId = body.elderId ?? "";
        } catch {
          return Response.json({ ok: false, error: "bad_request" }, { status: 400 });
        }
        if (!elderId) return Response.json({ ok: false, error: "elderId is required" }, { status: 400 });

        try {
          const job = await runner.createCallJob(elderId, "demo");
          const result = await runner.runCallJob(job.id, null, userData.user.id);
          return Response.json({ ok: true, job_id: job.id, ...result });
        } catch (e) {
          return Response.json({ ok: false, error: (e as Error).message }, { status: 400 });
        }
      },
    },
  },
});
