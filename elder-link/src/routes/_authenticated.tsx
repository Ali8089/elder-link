import { createFileRoute, Link, Outlet, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { BarChart3, FlaskConical, ListChecks, PhoneCall, UserPlus, LogOut } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { isDemoMode } from "@/integrations/supabase/demo-client";
import { useAuth } from "@/hooks/useAuth";
import { useScheduler } from "@/hooks/useScheduler";
import { LangSwitch, useI18n } from "@/lib/i18n";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  component: Layout,
});

const nav = [
  { to: "/cases", key: "cases", Icon: ListChecks },
  { to: "/enrol", key: "enrol", Icon: UserPlus },
  { to: "/test-controls", key: "testControls", Icon: FlaskConical },
  { to: "/analytics", key: "analytics", Icon: BarChart3 },
] as const;

function Layout() {
  const { session, loading } = useAuth();
  const { t } = useI18n();
  const navigate = useNavigate();
  useScheduler();
  useEffect(() => {
    if (!loading && !session) navigate({ to: "/" });
  }, [loading, session, navigate]);
  if (loading || !session) return <div className="p-10" role="status">…</div>;

  return (
    <div className="min-h-screen md:grid md:grid-cols-[240px_1fr]">
      <header className="bg-sidebar text-sidebar-foreground md:min-h-screen">
        <div className="flex items-center justify-between gap-2 p-4 md:flex-col md:items-start md:gap-6 md:p-6">
          <span className="flex items-center gap-2 text-lg font-bold">
            <PhoneCall aria-hidden className="h-5 w-5 text-sidebar-primary" /> {t("appName")}
          </span>
          <LangSwitch />
        </div>
        <nav aria-label="Main" className="flex gap-1 overflow-x-auto px-2 pb-2 md:flex-col md:px-3">
          {nav.map(({ to, key, Icon }) => (
            <Link
              key={to}
              to={to}
              className="flex min-h-12 shrink-0 items-center gap-2 rounded-md px-3 font-semibold hover:bg-sidebar-accent"
              activeProps={{ className: "bg-sidebar-accent text-sidebar-primary" }}
            >
              <Icon aria-hidden className="h-5 w-5" /> {t(key)}
            </Link>
          ))}
          <button
            onClick={() => supabase.auth.signOut()}
            className="flex min-h-12 shrink-0 items-center gap-2 rounded-md px-3 font-semibold hover:bg-sidebar-accent md:mt-6"
          >
            <LogOut aria-hidden className="h-5 w-5" /> {t("signOut")}
          </button>
        </nav>
        <p className="hidden px-6 py-4 text-xs opacity-80 md:block">{t("notice")}</p>
      </header>
      <main className="min-w-0 p-4 md:p-8">
        {isDemoMode() && (
          <p
            role="status"
            className="mb-6 rounded-md border-2 border-dashed border-warn bg-warn-soft p-3 text-sm font-semibold text-warn"
          >
            ⚠ Demo mode — in-memory data, mock telephony (no real calls). A reload resets everything.
          </p>
        )}
        <Outlet />
      </main>
    </div>
  );
}
