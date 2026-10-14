// POST /api/auth/signup — staff sign-up restricted by an allow-list.
// Closes the "anyone can self-signup as operator" hole: only emails listed in
// ALLOWED_STAFF_EMAILS (comma separated) can create an account.
import { createFileRoute } from "@tanstack/react-router";
import { createAdminClient } from "@/integrations/supabase/admin.server";

export const Route = createFileRoute("/api/auth/signup")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const admin = createAdminClient();
        if (!admin) {
          return Response.json({ error: { code: "NOT_CONFIGURED", message: "Server auth is not configured." } }, { status: 503 });
        }
        const allow = (process.env["ALLOWED_STAFF_EMAILS"] ?? "")
          .split(",")
          .map((s) => s.trim().toLowerCase())
          .filter(Boolean);

        let email = "";
        let password = "";
        try {
          const body = (await request.json()) as { email?: string; password?: string };
          email = (body.email ?? "").trim().toLowerCase();
          password = body.password ?? "";
        } catch {
          return Response.json({ error: { code: "BAD_REQUEST", message: "Invalid request body." } }, { status: 400 });
        }
        if (!email || password.length < 8) {
          return Response.json(
            { error: { code: "BAD_REQUEST", message: "A valid email and a password of at least 8 characters are required." } },
            { status: 400 },
          );
        }
        if (allow.length === 0 || !allow.includes(email)) {
          return Response.json(
            {
              error: {
                code: "NOT_ALLOWED",
                message: "This email is not on the staff allow-list. Ask an administrator to add it.",
              },
            },
            { status: 403 },
          );
        }
        const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
        if (error) {
          return Response.json({ error: { code: "SIGNUP_FAILED", message: error.message } }, { status: 400 });
        }
        // The database trigger grants the 'operator' role automatically.
        return Response.json({ ok: true, user_id: data.user?.id ?? null });
      },
    },
  },
});
