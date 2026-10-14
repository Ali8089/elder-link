// Server-side runner: same rules as the dashboard, but running on the server
// with the service-role client and the configured telephony provider.
// This is what keeps check-ins, retries, escalations and 30-day deletion
// working when no staff dashboard is open.
import { createAdminClient } from "@/integrations/supabase/admin.server";
import { createRunner, type Runner } from "@/lib/runner";
import { selectProvider } from "@/lib/telephony";

function env(key: string): string | undefined {
  return typeof process !== "undefined" ? process.env[key] : undefined;
}

/** Returns a runner bound to the service-role client, or null if not configured. */
export function serverRunner(): Runner | null {
  const db = createAdminClient();
  if (!db) return null;
  const provider = selectProvider({
    TELEPHONY_PROVIDER: env("TELEPHONY_PROVIDER"),
    TWILIO_ACCOUNT_SID: env("TWILIO_ACCOUNT_SID"),
    TWILIO_AUTH_TOKEN: env("TWILIO_AUTH_TOKEN"),
    TWILIO_FROM_NUMBER: env("TWILIO_FROM_NUMBER"),
    TWILIO_LANGUAGE: env("TWILIO_LANGUAGE"),
    TELEPHONY_WEBHOOK_URL: env("TELEPHONY_WEBHOOK_URL"),
  });
  return createRunner(db, provider);
}

/** Simple shared-secret check for cron/webhook calls. */
export function authorizeCron(request: Request): boolean {
  const secret = env("CRON_SECRET");
  if (!secret) return false;
  const header = request.headers.get("authorization") ?? request.headers.get("x-cron-secret") ?? "";
  const token = header.replace(/^Bearer\s+/i, "").trim();
  return token.length > 0 && token === secret;
}
