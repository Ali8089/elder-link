// GET /api/calls/recent — calls the dashboard has not heard yet.
//
// The mock telephony provider cannot make a sound: the server has no speaker.
// So the mock announces each accepted call (see src/lib/call-broadcast.ts) and
// the open dashboard reads those announcements here and plays the recorded
// Cantonese script through the browser.
//
// Auth mirrors /api/sensors/trigger: the browser sends its Supabase access
// token and this route verifies the caller is signed-in staff. The cron secret
// is also accepted, so a headless poller (or a test harness) can read the same
// feed without impersonating a human.
//
// Why not Supabase Realtime: the app subscribes to no Realtime channels today,
// and the scheduler already runs on a 30-second cadence. A poll that matches
// that cadence adds no new infrastructure, no new failure mode and no new
// dependency — and the 30s worst-case latency is irrelevant for a call that
// the elder will listen to for a minute.

import { createFileRoute } from "@tanstack/react-router";
import { createAdminClient, createAnonClient } from "@/integrations/supabase/admin.server";
import { callsSince } from "@/lib/call-broadcast";
import { authorizeCron } from "@/lib/server/runner.server";

/** True when the caller is a signed-in staff member, or holds the cron secret. */
async function authorize(request: Request): Promise<boolean> {
  if (authorizeCron(request)) return true;

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

export const Route = createFileRoute("/api/calls/recent")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!(await authorize(request))) {
          return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
        }
        const since = new URL(request.url).searchParams.get("since");
        const calls = callsSince(since);
        // Never cache: the whole point is to notice a call that just started,
        // and a cached empty list would delay it by the cache lifetime.
        return Response.json({ ok: true, calls }, { headers: { "cache-control": "no-store" } });
      },
    },
  },
});
