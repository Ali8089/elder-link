import { createFileRoute, Link, Outlet, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { BarChart3, PhoneCall, ListChecks, UserPlus, LogOut, Users } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useRole } from "@/hooks/useRole";
import { useScheduler } from "@/hooks/useScheduler";
import { LiveCallBanner } from "@/components/LiveCallBanner";
import { LangSwitch, useI18n } from "@/lib/i18n";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  component: Layout,
});

/** Operational screens. A relative must not see these. */
const STAFF_NAV = [
  { to: "/cases", key: "cases", Icon: ListChecks },
  { to: "/enrol", key: "enrol", Icon: UserPlus },
  { to: "/test-controls", key: "testControls", Icon: PhoneCall },
  { to: "/analytics", key: "analytics", Icon: BarChart3 },
] as const;

/** Screens a relative may use. */
const FAMILY_NAV = [{ to: "/family", key: "family", Icon: Users }] as const;

/** Exported so the navigation can be asserted directly in tests. */
export function Layout() {
  const { session, loading } = useAuth();
  const { isStaff, isFamily, loading: roleLoading } = useRole();
  const { t } = useI18n();
  const navigate = useNavigate();
  useScheduler();
  useEffect(() => {
    if (!loading && !session) navigate({ to: "/" });
  }, [loading, session, navigate]);
  if (loading || !session) return <div className="p-10" role="status">…</div>;

  // A relative who is not also staff gets the family screen only. Staff keep
  // the operational screens and, when they are also a relative, gain Family.
  const nav = [
    ...(isStaff ? STAFF_NAV : []),
    ...(isFamily ? FAMILY_NAV : []),
  ];

  return (
    <div className="min-h-screen md:grid md:grid-cols-[220px_1fr]">
      <header className="bg-sidebar text-sidebar-foreground md:min-h-screen">
        <div className="flex items-center justify-between gap-2 p-4 md:flex-col md:items-start md:gap-6 md:p-6">
          <span className="flex items-center gap-2 text-lg font-bold">
            <PhoneCall aria-hidden className="h-5 w-5 text-sidebar-primary" /> {t("appName")}
          </span>
          <LangSwitch />
        </div>

        {/*
          Primary navigation.
          The sidebar column only exists at >=768px. Below that the header would
          otherwise show a logo and nothing else — the first version of this
          layout put the links in a horizontally-scrolling row that the
          viewport clipped, which made every screen unreachable. A bordered,
          wrapping block always renders every link instead: it stays on one
          line when there is room and adds a second line when there is not,
          so nothing is ever hidden behind a scroll position.
        */}
        <nav
          aria-label="Main"
          className="flex flex-wrap gap-1 border-y border-sidebar-border bg-sidebar px-2 py-2 md:flex-col md:border-0 md:px-3 md:py-0"
        >
          {roleLoading ? null : nav.map(({ to, key, Icon }) => (
            <Link
              key={to}
              to={to}
              className="flex min-h-11 items-center gap-2 rounded-md px-3 font-semibold hover:bg-sidebar-accent"
              activeProps={{ className: "bg-sidebar-accent text-sidebar-primary" }}
            >
              <Icon aria-hidden className="h-5 w-5 shrink-0" />
              <span>{t(key)}</span>
            </Link>
          ))}
          <button
            onClick={() => supabase.auth.signOut()}
            className="flex min-h-11 items-center gap-2 rounded-md px-3 font-semibold hover:bg-sidebar-accent md:mt-6"
          >
            <LogOut aria-hidden className="h-5 w-5 shrink-0" /> <span>{t("signOut")}</span>
          </button>
        </nav>
        <p className="hidden px-6 py-4 text-xs opacity-80 md:block">{t("notice")}</p>
      </header>
      <main className="min-w-0 p-4 md:p-8">
        <Outlet />
      </main>
      {/*
        Mounted in the layout, not on a page: a door-sensor alarm can start a
        call from any of several places (the phone, the local app, the cron
        tick), so the banner has to be visible on every staff screen rather than
        only on the call-controls page. It reads the database — not an in-memory
        signal — so it appears whichever instance placed the call, and it shows
        only; the call itself is placed on the elder's phone.
      */}
      <LiveCallBanner />
    </div>
  );
}
