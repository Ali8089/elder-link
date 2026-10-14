import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useI18n } from "@/lib/i18n";
import { useLive } from "@/hooks/useLive";
import { escalationWithinLimit, isOverdue } from "@/lib/engine";
import { StatusBadge } from "@/components/StatusBadge";

export const Route = createFileRoute("/_authenticated/analytics")({
  head: () => ({
    meta: [
      { title: "Health & results — Elder Link" },
      { name: "description", content: "Prototype metrics: call outcomes, escalation timing and unresolved cases." },
      { property: "og:title", content: "Health & results — Elder Link" },
      { property: "og:description", content: "Elder Link prototype metrics." },
    ],
  }),
  component: Analytics,
});

function Analytics() {
  const { t } = useI18n();
  useLive();
  const q = useQuery({
    queryKey: ["analytics"],
    queryFn: async () => {
      const [j, c, e] = await Promise.all([
        supabase.from("call_jobs").select("outcome"),
        supabase.from("cases").select("status, trigger_at, escalation_started_at"),
        supabase.from("elders").select("status, next_check_at"),
      ]);
      return { jobs: j.data ?? [], cases: c.data ?? [], elders: e.data ?? [] };
    },
  });
  const d = q.data ?? { jobs: [], cases: [], elders: [] };
  const count = (o: string) => d.jobs.filter((j) => j.outcome === o).length;
  const now = new Date();
  const overdue = d.elders.filter((e) => e.status === "active" && isOverdue(e.next_check_at, now)).length;
  const timed = d.cases.filter((c) => c.escalation_started_at);
  const within = timed.filter((c) => escalationWithinLimit(c.trigger_at, c.escalation_started_at)).length;
  const unresolved = d.cases.filter((c) => c.status !== "closed").length;

  return (
    <div className="space-y-8">
      <h1 className="text-3xl md:text-4xl">{t("analytics")}</h1>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {(["safe", "worrying", "danger", "no_answer"] as const).map((o) => (
          <div key={o} className="rounded-lg border bg-card p-5">
            <StatusBadge kind={o} />
            <p className="mt-3 font-display text-5xl">{count(o)}</p>
          </div>
        ))}
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <Stat label={t("overdue")} value={overdue} />
        <Stat label={t("unresolved")} value={unresolved} />
        <Stat label={`${t("escalationTime")} ${t("within60")}`} value={`${within}/${timed.length}`} />
        <Stat label={t("callsToday")} value={d.jobs.length} />
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-lg border bg-card p-5">
      <p className="font-semibold text-muted-foreground">{label}</p>
      <p className="mt-2 font-display text-4xl">{value}</p>
    </div>
  );
}
