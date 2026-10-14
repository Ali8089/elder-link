// POST /api/auth/login — staff sign-in with a SERVER-SIDE lockout.
// 5 failed attempts for the same email+IP → locked for 15 minutes.
// On success the client receives the Supabase session tokens to set locally.
import { createFileRoute } from "@tanstack/react-router";
import { createAdminClient, createAnonClient } from "@/integrations/supabase/admin.server";

export const Route = createFileRoute("/api/auth/login")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const admin = createAdminClient();
        const anon = createAnonClient();
        if (!admin || !anon) {
          return Response.json({ error: { code: "NOT_CONFIGURED", message: "Server auth is not configured." } }, { status: 503 });
        }
        let email = "";
        let password = "";
        try {
          const body = (await request.json()) as { email?: string; password?: string };
          email = (body.email ?? "").trim();
          password = body.password ?? "";
        } catch {
          return Response.json({ error: { code: "BAD_REQUEST", message: "Invalid request body." } }, { status: 400 });
        }
        if (!email || !password) {
          return Response.json({ error: { code: "BAD_REQUEST", message: "Email and password are required." } }, { status: 400 });
        }
        const ip = (request.headers.get("x-forwarded-for") ?? "").split(",")[0]?.trim() || "unknown";

        // 1) Is this email+IP currently locked out?
        const lock = await admin.rpc("login_lock_status", { p_email: email, p_ip: ip });
        if (!lock.error && lock.data) {
          return Response.json(
            { error: { code: "LOCKED", message: "Too many failed attempts. Try again in 15 minutes.", lockedUntil: lock.data } },
            { status: 429 },
          );
        }

        // 2) Verify the credentials server-side.
        const { data, error } = await anon.auth.signInWithPassword({ email, password });
        if (error || !data.session) {
          const fail = await admin.rpc("record_login_failure", { p_email: email, p_ip: ip });
          const lockedUntil = fail.data ?? null;
          if (lockedUntil) {
            return Response.json(
              { error: { code: "LOCKED", message: "Too many failed attempts. Try again in 15 minutes.", lockedUntil } },
              { status: 429 },
            );
          }
          return Response.json(
            { error: { code: "INVALID_CREDENTIALS", message: "Invalid email or password." } },
            { status: 401 },
          );
        }

        // 3) Success — clear the failure counter and hand the session to the client.
        await admin.rpc("clear_login_attempts", { p_email: email, p_ip: ip });
        return Response.json({
          access_token: data.session.access_token,
          refresh_token: data.session.refresh_token,
          expires_at: data.session.expires_at,
          user: { id: data.session.user.id, email: data.session.user.email },
        });
      },
    },
  },
});
