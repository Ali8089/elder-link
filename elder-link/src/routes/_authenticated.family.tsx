// Family monitoring — what a relative sees about their own elder.
//
// Deliberately read-only. Staff decide every emergency (see the PRD), so this
// screen never offers an action that changes a case. The only thing a relative
// can change is their own notification preference.
//
// Scope is enforced by RLS, not by this component. Every query below returns
// only rows the signed-in relative is linked to; if the link is pending or
// revoked, the lists come back empty and the screen says so.

import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertTriangle, Bell, BellOff, CalendarHeart, PhoneCall, ShieldAlert } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { familyMembersTable } from "@/integrations/supabase/types";
import { useI18n } from "@/lib/i18n";
import { useRole } from "@/hooks/useRole";
import { maskPhone } from "@/lib/engine";
import { StatusBadge } from "@/components/StatusBadge";

type NotifyLevel = "all" | "alerts" | "none";

/** The relative's link to an elder, shaped for this screen. */
type FamilyLink = {
  id: string;
  elder_id: string;
  name: string;
  relation: string;
  phone: string | null;
  notify_level: NotifyLevel;
  wants_activity_news: boolean;
  status: string;
  elderName: string | null;
};

type FamilyCall = {
  id: string;
  elder_id: string;
  status: string;
  outcome: string | null;
  created_at: string;
};

type FamilyCase = {
  id: string;
  reason: string;
  trigger_at: string;
  handledBy: string;
};

type FamilyInterest = {
  id: string;
  elder_id: string;
  activity_code: string;
  created_at: string;
};

export const Route = createFileRoute("/_authenticated/family")({
  head: () => ({
    meta: [
      { title: "Family — Elder Link" },
      { name: "description", content: "Follow your relative's check-in calls, alerts and community activity." },
      { property: "og:title", content: "Family — Elder Link" },
      { property: "og:description", content: "Read-only view of your relative's care status." },
    ],
  }),
  component: FamilyMonitoring,
});

/**
 * Shapes the nested PostgREST response without relying on the generated
 * foreign-key metadata, which is only populated after the migration that
 * creates family_members has been applied to the live database.
 */
function shapeLinks(rows: unknown): FamilyLink[] {
  const out: FamilyLink[] = [];
  for (const raw of (rows ?? []) as Record<string, unknown>[]) {
    const elder = raw["elders"] as Record<string, unknown> | null | undefined;
    out.push({
      id: String(raw["id"]),
      elder_id: String(raw["elder_id"]),
      name: String(raw["name"] ?? ""),
      relation: String(raw["relation"] ?? ""),
      phone: (raw["phone"] as string | null) ?? null,
      notify_level: (raw["notify_level"] as NotifyLevel) ?? "all",
      wants_activity_news: Boolean(raw["wants_activity_news"]),
      status: String(raw["status"] ?? "pending"),
      elderName: elder ? (elder["display_name"] as string | null) ?? null : null,
    });
  }
  return out;
}

function shapeCalls(rows: unknown): FamilyCall[] {
  return ((rows ?? []) as Record<string, unknown>[]).map((r) => ({
    id: String(r["id"]),
    elder_id: String(r["elder_id"]),
    status: String(r["status"] ?? ""),
    outcome: (r["outcome"] as string | null) ?? null,
    created_at: String(r["created_at"] ?? ""),
  }));
}

function shapeCases(rows: unknown): FamilyCase[] {
  return ((rows ?? []) as Record<string, unknown>[]).map((r) => {
    const steps = (r["escalation_steps"] ?? []) as Record<string, unknown>[];
    // The step currently being worked — this is who has the call right now.
    const active = steps.find((s) => s["status"] === "calling" || s["status"] === "answered");
    return {
      id: String(r["id"]),
      reason: String(r["reason"] ?? "unclear"),
      trigger_at: String(r["trigger_at"] ?? ""),
      handledBy: active ? String(active["target"] ?? "staff") : "staff",
    };
  });
}

function shapeInterests(rows: unknown): FamilyInterest[] {
  return ((rows ?? []) as Record<string, unknown>[]).map((r) => ({
    id: String(r["id"]),
    elder_id: String(r["elder_id"]),
    activity_code: String(r["activity_code"] ?? ""),
    created_at: String(r["created_at"] ?? ""),
  }));
}

function FamilyMonitoring() {
  const { t } = useI18n();
  const qc = useQueryClient();
  const { isStaff, isFamily, loading: roleLoading } = useRole();

  // The relative's own links, including pending ones, so we can explain the
  // state rather than showing a blank page.
  const links = useQuery({
    queryKey: ["family-links"],
    queryFn: async () => {
      const { data, error } = await familyMembersTable(supabase)
        .select("id, elder_id, name, relation, phone, notify_level, wants_activity_news, status, elders(display_name)")
        .order("created_at");
      if (error) throw new Error(error.message);
      return shapeLinks(data);
    },
    enabled: isFamily || isStaff,
  });

  const allLinks = links.data ?? [];
  const activeIds = allLinks.filter((l) => l.status === "active").map((l) => l.elder_id);
  const elderNameFor = (elderId: string) =>
    allLinks.find((l) => l.elder_id === elderId)?.elderName ?? t("familyUnknownElder");

  // Everything below relies on RLS to scope to the linked elder(s).
  const calls = useQuery({
    queryKey: ["family-calls", activeIds],
    queryFn: async () => {
      const { data } = await supabase
        .from("call_jobs")
        .select("id, elder_id, status, outcome, created_at")
        .in("elder_id", activeIds)
        .order("created_at", { ascending: false })
        .limit(12);
      return shapeCalls(data);
    },
    enabled: activeIds.length > 0,
  });

  const cases = useQuery({
    queryKey: ["family-cases", activeIds],
    queryFn: async () => {
      const { data } = await supabase
        .from("cases")
        .select("id, elder_id, reason, status, severity, trigger_at, escalation_steps(target, status)")
        .in("elder_id", activeIds)
        .order("created_at", { ascending: false })
        .limit(10);
      return shapeCases(data);
    },
    enabled: activeIds.length > 0,
  });

  const interests = useQuery({
    queryKey: ["family-interests", activeIds],
    queryFn: async () => {
      const { data } = await supabase
        .from("activity_interests")
        .select("id, elder_id, activity_code, created_at")
        .in("elder_id", activeIds)
        .order("created_at", { ascending: false })
        .limit(10);
      return shapeInterests(data);
    },
    enabled: activeIds.length > 0,
  });

  const updatePrefs = useMutation({
    mutationFn: async (input: { id: string; notify_level: NotifyLevel; wants_activity_news: boolean }) => {
      // RLS permits a relative to change only their own row's preferences.
      const { error } = await familyMembersTable(supabase)
        .update({ notify_level: input.notify_level, wants_activity_news: input.wants_activity_news })
        .eq("id", input.id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      toast.success(t("saved"));
      void qc.invalidateQueries({ queryKey: ["family-links"] });
    },
    onError: (e) => toast.error((e as Error).message),
  });

  if (roleLoading) return <p role="status" className="p-6">…</p>;

  if (!isFamily && !isStaff) {
    return (
      <div className="max-w-2xl space-y-3">
        <h1 className="text-3xl md:text-4xl">{t("familyTitle")}</h1>
        <p className="rounded-md border bg-card p-4 text-sm text-muted-foreground">{t("familyNoRole")}</p>
      </div>
    );
  }

  const openCases = (cases.data ?? []);
  const pending = allLinks.filter((l) => l.status === "pending");

  return (
    <div className="space-y-8">
      <header className="space-y-1">
        <h1 className="text-3xl md:text-4xl">{t("familyTitle")}</h1>
        <p className="text-sm text-muted-foreground">{t("familyIntro")}</p>
      </header>

      {/* Pending invitations — explain rather than hide */}
      {pending.length > 0 && (
        <section className="rounded-lg border-2 border-dashed p-4">
          <h2 className="font-bold">{t("familyPending")}</h2>
          <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
            {pending.map((l) => (
              <li key={l.id}>
                {l.elderName} · {l.name} ({l.relation}) — {t("familyAwaiting")}
              </li>
            ))}
          </ul>
        </section>
      )}

      {activeIds.length === 0 && pending.length === 0 && (
        <p className="rounded-lg border bg-card p-6 text-muted-foreground">{t("familyNone")}</p>
      )}

      {/* Emergencies and alerts first — the thing a relative actually wants */}
      {activeIds.length > 0 && (
        <section className="space-y-3">
          <h2 className="flex items-center gap-2 text-2xl">
            <ShieldAlert aria-hidden className="h-5 w-5" /> {t("familyAlerts")}
          </h2>
          {openCases.length === 0 ? (
            <p className="rounded-lg border bg-card p-4 text-sm text-muted-foreground">{t("familyNoAlerts")}</p>
          ) : (
            openCases.map((c) => (
              <article key={c.id} className="rounded-lg border bg-card p-4">
                <div className="flex flex-wrap items-center gap-3">
                  <AlertTriangle aria-hidden className="h-5 w-5 text-warn" />
                  <StatusBadge kind={c.reason} />
                  <span className="text-sm text-muted-foreground">
                    {new Date(c.trigger_at).toLocaleString()}
                  </span>
                </div>
                <p className="mt-2 text-sm">
                  {t("familyHandledBy")}:{" "}
                  <span className="font-semibold">
                    {c.handledBy === "staff" ? t("familyStaffReviewing") : t(c.handledBy)}
                  </span>
                </p>
                <p className="mt-1 text-xs text-muted-foreground">{t("familyReadOnly")}</p>
              </article>
            ))
          )}
        </section>
      )}

      {/* Positive signal — only shown when the relative opted in */}
      {activeIds.length > 0 && (
        <section className="space-y-3">
          <h2 className="flex items-center gap-2 text-2xl">
            <CalendarHeart aria-hidden className="h-5 w-5" /> {t("familyActivity")}
          </h2>
          {(interests.data ?? []).length === 0 ? (
            <p className="rounded-lg border bg-card p-4 text-sm text-muted-foreground">{t("familyNoActivity")}</p>
          ) : (
            <ul className="space-y-2">
              {(interests.data ?? []).map((i) => (
                <li key={i.id} className="flex flex-wrap items-center gap-2 rounded-lg border bg-card p-3 text-sm">
                  <span className="font-semibold">{t(i.activity_code)}</span>
                  <span className="text-muted-foreground">{new Date(i.created_at).toLocaleDateString()}</span>
                  <span className="ml-auto text-xs text-muted-foreground">{t("familyInterestNote")}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {/* Recent calls — the reassurance that check-ins are happening */}
      {activeIds.length > 0 && (
        <section className="space-y-3">
          <h2 className="flex items-center gap-2 text-2xl">
            <PhoneCall aria-hidden className="h-5 w-5" /> {t("familyCalls")}
          </h2>
          {(calls.data ?? []).length === 0 ? (
            <p className="rounded-lg border bg-card p-4 text-sm text-muted-foreground">{t("familyNoCalls")}</p>
          ) : (
            <div className="overflow-x-auto rounded-lg border bg-card">
              <table className="w-full text-left text-sm">
                <thead className="bg-muted">
                  <tr>
                    <th className="p-3">{t("familyWhen")}</th>
                    <th className="p-3">{t("familyElder")}</th>
                    <th className="p-3">{t("familyResult")}</th>
                  </tr>
                </thead>
                <tbody>
                  {(calls.data ?? []).map((j) => (
                    <tr key={j.id} className="border-t">
                      <td className="p-3">{new Date(j.created_at).toLocaleString()}</td>
                      <td className="p-3">{elderNameFor(j.elder_id)}</td>
                      <td className="p-3">
                        {j.outcome ? <StatusBadge kind={j.outcome} /> : <span className="text-muted-foreground">{j.status}</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {/* The relative's own preferences — the one thing they may change */}
      {isFamily && allLinks.length > 0 && (
        <section className="space-y-3">
          <h2 className="flex items-center gap-2 text-2xl">
            <Bell aria-hidden className="h-5 w-5" /> {t("familyPrefs")}
          </h2>
          {allLinks.map((l) => (
            <div key={l.id} className="rounded-lg border bg-card p-4">
              <p className="font-semibold">
                {l.name} · {l.relation} — {l.elderName}
              </p>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <label className="space-y-1 text-sm">
                  <span className="font-semibold">{t("familyNotifyLevel")}</span>
                  <select
                    className="h-11 w-full rounded-md border border-input bg-card px-3"
                    value={l.notify_level}
                    onChange={(e) =>
                      updatePrefs.mutate({
                        id: l.id,
                        notify_level: e.target.value as NotifyLevel,
                        wants_activity_news: l.wants_activity_news,
                      })
                    }
                  >
                    <option value="all">{t("familyNotifyAll")}</option>
                    <option value="alerts">{t("familyNotifyAlerts")}</option>
                    <option value="none">{t("familyNotifyNone")}</option>
                  </select>
                </label>
                <label className="flex min-h-11 items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="size-5"
                    checked={l.wants_activity_news}
                    onChange={(e) =>
                      updatePrefs.mutate({
                        id: l.id,
                        notify_level: l.notify_level,
                        wants_activity_news: e.target.checked,
                      })
                    }
                  />
                  <span>{t("familyActivityOptIn")}</span>
                </label>
              </div>
              {l.notify_level === "none" && (
                <p className="mt-3 flex items-center gap-2 text-sm text-muted-foreground">
                  <BellOff aria-hidden className="h-4 w-4" /> {t("familyMuted")}
                </p>
              )}
              {isStaff && l.phone && (
                <p className="mt-3 text-xs text-muted-foreground">
                  {maskPhone(l.phone)} · {t("familyStaffView")}
                </p>
              )}
            </div>
          ))}
        </section>
      )}

      {isStaff && (
        <p className="text-xs text-muted-foreground">
          {t("familyStaffNotice")}
        </p>
      )}
    </div>
  );
}
