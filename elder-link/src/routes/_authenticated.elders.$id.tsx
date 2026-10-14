import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { ArrowLeft, Check, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useI18n } from "@/lib/i18n";
import { useLive } from "@/hooks/useLive";
import { useAuth } from "@/hooks/useAuth";
import { ACTIVITIES, escalationWithinLimit, maskPhone } from "@/lib/engine";
import {
  acknowledgeCase,
  closeCase,
  optOut,
  recordActivityInterest,
  rescheduleElder,
  saveCaseNote,
} from "@/lib/orchestrator";
import { StatusBadge } from "@/components/StatusBadge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

/** Activity codes match the seeded rows in the activities table. */
const ACTIVITY_CODES = ["walk", "tea", "call", "stretch"] as const;

export const Route = createFileRoute("/_authenticated/elders/$id")({
  head: () => ({
    meta: [
      { title: "Elder detail — Elder Link" },
      { name: "description", content: "Profile, consent, call history, activity interest and contact chain for one elder." },
      { property: "og:title", content: "Elder detail — Elder Link" },
      { property: "og:description", content: "Elder profile, history and escalation chain." },
    ],
  }),
  component: ElderDetail,
});

function ElderDetail() {
  const { id } = Route.useParams();
  const { t } = useI18n();
  const { user } = useAuth();
  const qc = useQueryClient();
  useLive();
  const q = useQuery({
    queryKey: ["elder", id],
    queryFn: async () => {
      const [e, c, j, k, n, ai] = await Promise.all([
        supabase.from("elders").select("*").eq("id", id).single(),
        supabase.from("contacts").select("*").eq("elder_id", id).order("priority"),
        supabase.from("call_jobs").select("*").eq("elder_id", id).order("created_at", { ascending: false }).limit(20),
        supabase.from("cases").select("*, escalation_steps(*)").eq("elder_id", id).order("created_at", { ascending: false }),
        supabase.from("notifications").select("*").eq("elder_id", id).order("created_at", { ascending: false }).limit(5),
        supabase.from("activity_interests").select("*").eq("elder_id", id).order("created_at", { ascending: false }).limit(5),
      ]);
      if (e.error) throw e.error;
      return {
        elder: e.data,
        contacts: c.data ?? [],
        jobs: j.data ?? [],
        cases: k.data ?? [],
        notifications: n.data ?? [],
        interests: ai.data ?? [],
      };
    },
  });
  const refresh = () => qc.invalidateQueries();
  if (q.isLoading) return <p role="status">…</p>;
  if (!q.data) return <p>Not found</p>;
  const { elder, contacts, jobs, cases, notifications, interests } = q.data;

  return (
    <div className="space-y-8">
      <Link to="/cases" className="inline-flex min-h-11 items-center gap-1 font-semibold underline">
        <ArrowLeft aria-hidden className="h-4 w-4" /> {t("back")}
      </Link>
      <header className="flex flex-wrap items-center gap-3">
        <h1 className="text-3xl md:text-4xl">{elder.display_name}</h1>
        <StatusBadge kind={elder.status} />
      </header>

      <div className="grid gap-6 lg:grid-cols-3">
        <section className="rounded-lg border bg-card p-5" aria-labelledby="p-h">
          <h2 id="p-h" className="text-xl">{t("consent")}</h2>
          <dl className="mt-3 space-y-2">
            <Row k={t("reference")} v={elder.reference_number || "—"} />
            <Row k={t("centre")} v={elder.centre || "—"} />
            <Row k={t("phone")} v={maskPhone(elder.phone)} />
            <Row k={t("preferredCallTime")} v={elder.preferred_call_time || "—"} />
            <Row k={t("nextCheck")} v={elder.next_check_at ? new Date(elder.next_check_at).toLocaleString() : "—"} />
            {(["consent_elder", "consent_contact", "consent_service"] as const).map((c) => (
              <Row key={c} k={t(c)} v={elder[c] ? <span className="text-safe">✓ Yes</span> : <span className="text-destructive">✗ No</span>} />
            ))}
            <Row k={t("consentChecked")} v={elder.consent_checked_at ? new Date(elder.consent_checked_at).toLocaleString() : "—"} />
          </dl>
          <h3 className="mt-5 font-bold">{t("contacts")}</h3>
          <ul className="mt-2 space-y-1 text-sm">
            {contacts.map((c) => (
              <li key={c.id}>{c.priority}. {c.name} ({c.relation}) · {maskPhone(c.phone)}</li>
            ))}
          </ul>
          <Reschedule elder={elder} onDone={refresh} />
          {elder.status !== "opted_out" && (
            <Button variant="outline" className="mt-5 min-h-11" onClick={async () => { if (confirm(t("optOut") + "?")) { await optOut(elder.id); refresh(); } }}>
              {t("optOut")}
            </Button>
          )}
        </section>

        <section className="space-y-4 lg:col-span-2" aria-labelledby="c-h">
          <h2 id="c-h" className="text-xl">{t("cases")}</h2>
          {cases.length === 0 && <p className="text-muted-foreground">{t("noCases")}</p>}
          {cases.map((c) => (
            <CaseCard key={c.id} c={c} userId={user!.id} onChange={refresh} />
          ))}

          <section className="rounded-lg border bg-card p-5" aria-labelledby="i-h">
            <h2 id="i-h" className="text-xl">{t("interest")}</h2>
            <InterestPicker elderId={elder.id} onDone={refresh} />
            {interests.length > 0 && (
              <ul className="mt-3 space-y-1 text-sm">
                {interests.map((i) => (
                  <li key={i.id}>{new Date(i.created_at).toLocaleString()} · {i.activity_code} · {i.source}</li>
                ))}
              </ul>
            )}
          </section>

          <section className="rounded-lg border bg-card p-5" aria-labelledby="n-h">
            <h2 id="n-h" className="text-xl">{t("notifications")}</h2>
            {notifications.length === 0 && <p className="text-muted-foreground">—</p>}
            <ul className="mt-2 space-y-1 text-sm">
              {notifications.map((n) => (
                <li key={n.id}>{new Date(n.created_at).toLocaleString()} · {n.target} · {n.status} · {n.detail}</li>
              ))}
            </ul>
          </section>
        </section>
      </div>

      <section aria-labelledby="h-h">
        <h2 id="h-h" className="text-xl">{t("history")}</h2>
        <div className="mt-3 overflow-x-auto rounded-lg border bg-card">
          <table className="w-full text-left text-sm">
            <thead className="bg-muted"><tr><th className="p-3">Time</th><th className="p-3">Type</th><th className="p-3">#</th><th className="p-3">Result</th><th className="p-3">{t("activity")}</th></tr></thead>
            <tbody>
              {jobs.map((j) => (
                <tr key={j.id} className="border-t">
                  <td className="p-3">{new Date(j.created_at).toLocaleString()}</td>
                  <td className="p-3">{j.kind}</td>
                  <td className="p-3">{j.attempt}</td>
                  <td className="p-3">{j.outcome ? <StatusBadge kind={j.outcome} /> : `${j.status} · due ${new Date(j.due_at).toLocaleTimeString()}`}</td>
                  <td className="p-3">{j.activity_suggestion ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return <div className="flex justify-between gap-3"><dt className="text-muted-foreground">{k}</dt><dd className="text-right font-semibold">{v}</dd></div>;
}

/** FR-16: reschedule — preferred call time and interval. */
function Reschedule({ elder, onDone }: { elder: { id: string; preferred_call_time: string; check_interval_days: number }; onDone: () => void }) {
  const { t } = useI18n();
  const [time, setTime] = useState(elder.preferred_call_time ?? "");
  const [days, setDays] = useState(elder.check_interval_days ?? 2);
  const [busy, setBusy] = useState(false);
  return (
    <div className="mt-5 space-y-2 border-t pt-4">
      <h3 className="font-bold">{t("reschedule")}</h3>
      <div className="flex flex-wrap items-center gap-2">
        <label className="text-sm" htmlFor="rc-time">{t("preferredCallTime")}</label>
        <input id="rc-time" className="h-11 rounded-md border border-input bg-card px-3" value={time} onChange={(e) => setTime(e.target.value)} placeholder="10:00" />
        <label className="text-sm" htmlFor="rc-days">{t("interval")}</label>
        <select id="rc-days" className="h-11 rounded-md border border-input bg-card px-3" value={days} onChange={(e) => setDays(Number(e.target.value))}>
          <option value={2}>2 {t("days")}</option>
          <option value={3}>3 {t("days")}</option>
        </select>
        <Button
          className="min-h-11"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await rescheduleElder(elder.id, time, days);
              toast.success(t("saved"));
              onDone();
            } catch (e) {
              toast.error((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          {t("saveChanges")}
        </Button>
      </div>
    </div>
  );
}

/** FR-05: capture the activity the elder is interested in. */
function InterestPicker({ elderId, onDone }: { elderId: string; onDone: () => void }) {
  const { t, lang } = useI18n();
  const [code, setCode] = useState<string>(ACTIVITY_CODES[0]);
  const [busy, setBusy] = useState(false);
  return (
    <div className="mt-3 flex flex-wrap items-center gap-2">
      <label className="text-sm" htmlFor="ai-code">{t("activity")}</label>
      <select id="ai-code" className="h-11 rounded-md border border-input bg-card px-3" value={code} onChange={(e) => setCode(e.target.value)}>
        {ACTIVITY_CODES.map((c, i) => (
          <option key={c} value={c}>{lang === "zh" ? ACTIVITIES[i]!.zh : ACTIVITIES[i]!.en}</option>
        ))}
      </select>
      <Button
        className="min-h-11"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            await recordActivityInterest(elderId, code);
            toast.success(t("interestRecorded"));
            onDone();
          } catch (e) {
            toast.error((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        {t("markInterest")}
      </Button>
    </div>
  );
}

type CaseRow = {
  id: string; reason: string; status: string; note: string | null; version: number;
  trigger_at: string; escalation_started_at: string | null; created_at: string;
  escalation_steps: { id: string; step_order: number; target: string; target_label: string; status: string }[];
};

function CaseCard({ c, userId, onChange }: { c: CaseRow; userId: string; onChange: () => void }) {
  const { t } = useI18n();
  const [note, setNote] = useState(c.note ?? "");
  const [busy, setBusy] = useState(false);
  const ok = escalationWithinLimit(c.trigger_at, c.escalation_started_at);
  const steps = [...c.escalation_steps].sort((a, b) => a.step_order - b.step_order);

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    try {
      await fn();
      onChange();
    } catch (e) {
      // Optimistic-locking conflicts land here.
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <article className="rounded-lg border bg-card p-5">
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge kind={c.reason} />
        <StatusBadge kind={c.status} />
        <span className={`text-sm font-semibold ${ok ? "text-safe" : "text-destructive"}`}>
          {t("escalationTime")}: {ok ? "✓ " + t("within60") : "✗ " + t("over60")}
        </span>
      </div>
      <h3 className="mt-4 font-bold">{t("chain")}</h3>
      <ol className="mt-2 grid gap-2 sm:grid-cols-3">
        {steps.map((s) => (
          <li key={s.id} className={`rounded-md border p-3 ${s.status === "calling" ? "border-primary bg-accent" : ""}`}>
            <div className="text-sm font-bold">{s.step_order}. {t(s.target)}</div>
            <div className="text-sm">{s.target_label}</div>
            <div className="mt-1 flex items-center gap-1 text-sm font-semibold">
              {s.status === "answered" ? <Check aria-hidden className="h-4 w-4 text-safe" /> : s.status === "no_answer" ? <X aria-hidden className="h-4 w-4 text-destructive" /> : null}
              {s.status}
            </div>
          </li>
        ))}
      </ol>
      {c.status !== "closed" && (
        <div className="mt-4 space-y-3">
          <label className="block font-semibold" htmlFor={`n-${c.id}`}>{t("note")}</label>
          <Textarea id={`n-${c.id}`} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" className="min-h-11" disabled={busy} onClick={() => run(async () => { await saveCaseNote(c.id, note, c.version); toast.success(t("saved")); })}>{t("saveNote")}</Button>
            {c.status === "open" && <Button className="min-h-11" disabled={busy} onClick={() => run(async () => { await acknowledgeCase(c.id, userId, c.version); })}>{t("acknowledge")}</Button>}
            <Button variant="secondary" className="min-h-11" disabled={busy} onClick={() => run(async () => { await saveCaseNote(c.id, note, c.version); await closeCase(c.id, c.version + 1); })}>{t("closeCase")}</Button>
          </div>
        </div>
      )}
      {c.status === "closed" && c.note && <p className="mt-3 text-sm">📝 {c.note}</p>}
    </article>
  );
}
