// Server-only Supabase client using the service-role key.
// Used by cron/health/webhook routes so they can run without a signed-in user.
// NEVER import this file from client code.
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

function env(key: string): string | undefined {
  return typeof process !== "undefined" ? process.env[key] : undefined;
}

export function supabaseUrl(): string | undefined {
  return env("SUPABASE_URL") || env("VITE_SUPABASE_URL");
}

/** Service-role client (bypasses RLS). Returns null when not configured. */
export function createAdminClient(): SupabaseClient<any, any, any> | null {
  const url = supabaseUrl();
  const key = env("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

/** Anon client for verifying a staff login server-side. */
export function createAnonClient(): SupabaseClient<any, any, any> | null {
  const url = supabaseUrl();
  const key = env("SUPABASE_PUBLISHABLE_KEY") || env("VITE_SUPABASE_PUBLISHABLE_KEY") || env("SUPABASE_ANON_KEY");
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

export function serverConfigStatus() {
  return {
    supabaseUrl: Boolean(supabaseUrl()),
    serviceRoleKey: Boolean(env("SUPABASE_SERVICE_ROLE_KEY")),
    anonKey: Boolean(env("SUPABASE_PUBLISHABLE_KEY") || env("VITE_SUPABASE_PUBLISHABLE_KEY") || env("SUPABASE_ANON_KEY")),
    cronSecret: Boolean(env("CRON_SECRET")),
    telephonyProvider: env("TELEPHONY_PROVIDER") ?? "mock",
  };
}
