import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useI18n } from "@/lib/i18n";
import { useLive } from "@/hooks/useLive";
import { isOverdue } from "@/lib/engine";
import { StatusBadge } from "@/components/StatusBadge";

export const Route = createFileRoute("/_authenticated/cases")({
  head: () => ({
    meta: [
      { title: "Cases — Elder Link" },
      { name: "description", content: "Shared list of open, acknowledged and closed elder check-in cases." },
      { property: "og:title", content: "Cases — Elder Link" },
      { property: "og:description", content: "Shared list of elder check-in cases." },
    ],
  }),
  component: CasesPage,
});

function CasesPage() {
  const { t } = useI18n();
  useLive();
  const [filter, setFilter] = useState<"all" | "open" | "acknowledged" | "closed">("open");
  const cases = useQuery({
    queryKey: ["cases"],
    queryFn: async () => {
      const r = await supabase.from("cases").select("*, elders(display_name, district)").order("severity", { ascending: false }).order("created_at", { ascending: false });
      if (r.error) throw r.error;
      return r.data;
    },
  });
  const elders = useQuery({
    queryKey: ["elders"],
    queryFn: async () => {
      const r = await supabase.from("elders").select("*").order("display_name");
      if (r.error) throw r.error;
      return r.data;
    },
  });
  const now = new Date();
  const list = (cases.data ?? []).filter((c) => filter === "all" || c.status === filter);

  return (
    <div className="space-y-10">
      <section aria-labelledby="cases-h">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <h1 id="cases-h" className="text-3xl md:text-4xl">{t("cases")}</h1>
          <div role="group" aria-label="Filter" className="flex flex-wrap gap-2">
            {(["open", "acknowledged", "closed", "all"] as const).map((f) => (
              <button
                key={f}
                aria-pressed={filter === f}
                onClick={() => setFilter(f)}
                className={`min-h-11 rounded-full border px-4 font-semibold ${filter === f ? "border-primary bg-primary text-primary-foreground" : "border-input bg-card"}`}
              >
                {t(f)}
              </button>
            ))}
          </div>
        </div>
        <ul className="mt-6 space-y-3">
          {list.length === 0 && <li className="rounded-lg border border-dashed p-6 text-muted-foreground">{t("noCases")}</li>}
          {list.map((c) => (
            <li key={c.id}>
              <Link to="/elders/$id" params={{ id: c.elder_id }} className="flex flex-wrap items-center gap-3 rounded-lg border bg-card p-4 hover:border-primary">
                <StatusBadge kind={c.reason} />
                <span className="text-lg font-bold">{c.elders?.display_name}</span>
                <span className="text-muted-foreground">{c.elders?.district}</span>
                <span className="ml-auto flex items-center gap-3">
                  <StatusBadge kind={c.status} />
                  <time className="text-sm text-muted-foreground">{new Date(c.created_at).toLocaleString()}</time>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="elders-h">
        <h2 id="elders-h" className="text-2xl">{t("elders")}</h2>
        <ul className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {(elders.data ?? []).map((e) => (
            <li key={e.id}>
              <Link to="/elders/$id" params={{ id: e.id }} className="block h-full rounded-lg border bg-card p-4 hover:border-primary">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-lg font-bold">{e.display_name}</span>
                  <StatusBadge kind={e.status} />
                  {e.status === "active" && isOverdue(e.next_check_at, now) && <StatusBadge kind="overdue" />}
                </div>
                <p className="mt-1 text-sm text-muted-foreground">
                  {e.district} · {t("nextCheck")}: {e.next_check_at ? new Date(e.next_check_at).toLocaleString() : "—"}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
