import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { PhoneCall } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useI18n } from "@/lib/i18n";
import { SAMPLE_ANSWERS } from "@/lib/telephony";
import { CALL_SCRIPT } from "@/lib/script";
import type { Outcome } from "@/lib/engine";
import { advanceCaseChain, demoCall, runDueCheckIns, triggerSensorViaEndpoint } from "@/lib/orchestrator";
import { CantoneseDemoCall } from "@/components/CantoneseDemoCall";
import { selectVoiceEngine, speechIsAvailable } from "@/lib/voice";
import { selectConversationEngine } from "@/lib/conversation";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/_authenticated/test-controls")({
  head: () => ({
    meta: [
      { title: "Call controls — Elder Link" },
      { name: "description", content: "Place and record check-in calls, sensor alerts and contact-chain follow-ups." },
      { property: "og:title", content: "Call controls — Elder Link" },
      { property: "og:description", content: "Run the check-in journeys: safe, worrying, and no-answer." },
    ],
  }),
  component: TestControls,
});

/**
 * A fresh id for one dashboard-triggered door-open episode.
 *
 * Each click must be a distinct episode, or the UNIQUE constraint on
 * `sensor_alerts.external_id` would correctly treat the second click as a
 * duplicate and decline to call — the caregiver would think it had failed.
 * The `ui-` prefix mirrors the poller's `door:` and the old `sim-` convention,
 * and the slice+timestamp keeps it stable in shape while unique in value.
 */
function makeEpisodeId(elderId: string): string {
  return `ui-${elderId.slice(0, 8)}-${Date.now()}`;
}

function TestControls() {
  const { t, lang } = useI18n();
  const qc = useQueryClient();
  const [elderId, setElderId] = useState("");
  const [outcome, setOutcome] = useState<Outcome>("safe");
  const [busy, setBusy] = useState(false);
  const elders = useQuery({
    queryKey: ["elders-active"],
    queryFn: async () => (await supabase.from("elders").select("id, display_name").eq("status", "active").order("display_name")).data ?? [],
  });
  const openCases = useQuery({
    queryKey: ["open-chain"],
    queryFn: async () =>
      (await supabase.from("cases").select("id, reason, elders(display_name), escalation_steps(status, target)").neq("status", "closed").order("created_at", { ascending: false })).data ?? [],
  });
  const target = elderId || elders.data?.[0]?.id || "";

  // Speech recognition is offered only when a recogniser is configured. Without
  // one the call falls back to the keypad, which is the more accessible input
  // for this audience anyway.
  const voiceEngine = useMemo(() => {
    const env = import.meta.env as Record<string, string | undefined>;
    const assets: Record<string, string> = {
      disclosure: "/audio/disclosure.mp3",
      ask: "/audio/ask.mp3",
      safe: "/audio/safe.mp3",
      worry: "/audio/worry.mp3",
      danger: "/audio/danger.mp3",
      unclear: "/audio/unclear.mp3",
      no_answer: "/audio/no_answer.mp3",
      close: "/audio/close.mp3",
    };
    return selectVoiceEngine(env, assets);
  }, []);

  // The conversational layer. Uses the same Groq key when present, so one key
  // turns on both speech recognition and natural replies; otherwise this is the
  // deterministic Cantonese script.
  const conversationEngine = useMemo(() => {
    const env = import.meta.env as Record<string, string | undefined>;
    return selectConversationEngine(env);
  }, []);

  // Ask the server whether it can actually transcribe, rather than guessing
  // from a client-side key. The "Answer by voice" control is shown only when
  // this comes back true, so it is never a button that does nothing.
  const speech = useQuery({
    queryKey: ["speech-available"],
    queryFn: () => speechIsAvailable(),
    staleTime: 5 * 60_000,
    retry: false,
  });

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    try {
      const r = (await fn()) as { outcome?: string; step?: string; ok?: boolean; error?: string } | number;
      // A resolved value that reports failure is still a failure. The old code
      // only caught thrown errors, so a `{ ok: false }` result — which is what
      // a rejected Supabase write produces — fell straight through to the
      // success toast. Surface it instead: silence is the bug.
      if (typeof r !== "number" && r && r.ok === false) {
        throw new Error(r.error ?? "Action failed");
      }
      toast.success(typeof r === "number" ? `${r} job(s) run` : `${t(r.outcome ?? "")} → ${r.step === "retry" ? t("retryScheduled") : r.step}`);
    } catch (e) {
      toast.error(e instanceof Error && e.message ? e.message : String(e));
    }
    setBusy(false);
    qc.invalidateQueries();
  }

  /** Runs the scripted journey for the outcome picked on the phone keypad. */
  async function runOutcome(o: Outcome) {
    setBusy(true);
    try {
      const r = (await demoCall(target, SAMPLE_ANSWERS[o])) as { outcome?: string; step?: string };
      toast.success(`${t(r.outcome ?? "")} → ${r.step === "retry" ? t("retryScheduled") : r.step}`);
    } catch (e) {
      toast.error((e as Error).message);
    }
    setBusy(false);
    qc.invalidateQueries();
  }

  return (
    <div className="space-y-8">
      <h1 className="text-3xl md:text-4xl">{t("testControls")}</h1>
      <p className="flex items-center gap-2 rounded-md border bg-card p-4 text-sm text-muted-foreground">
        <PhoneCall aria-hidden className="h-5 w-5 shrink-0" /> {t("testOnly")}
      </p>
      <p className="text-sm text-muted-foreground">{t("schedulerNote")}</p>

      <section className="grid gap-4 rounded-lg border bg-card p-5 md:grid-cols-2">
        <div className="space-y-2">
          <label htmlFor="el" className="font-semibold">{t("elders")}</label>
          <select id="el" className="h-12 w-full rounded-md border border-input bg-card px-3" value={target} onChange={(e) => setElderId(e.target.value)}>
            {elders.data?.map((e) => <option key={e.id} value={e.id}>{e.display_name}</option>)}
          </select>
        </div>
        <fieldset className="space-y-2">
          <legend className="font-semibold">{t("answerAs")}</legend>
          <div className="flex flex-wrap gap-2">
            {(Object.keys(SAMPLE_ANSWERS) as Outcome[]).map((o) => (
              <button key={o} aria-pressed={outcome === o} onClick={() => setOutcome(o)} className={`min-h-11 rounded-full border px-4 font-semibold ${outcome === o ? "border-primary bg-primary text-primary-foreground" : "border-input"}`}>
                {t(o)}
              </button>
            ))}
          </div>
          <p className="text-sm text-muted-foreground">“{SAMPLE_ANSWERS[outcome] ?? "—"}”</p>
        </fieldset>
        <div className="flex flex-wrap gap-3 md:col-span-2">
          <Button className="h-12" disabled={busy || !target} onClick={() => runOutcome(outcome)}>{t("demoCall")}</Button>
          <Button variant="destructive" className="h-12" disabled={busy || !target} onClick={() => run(() => triggerSensorViaEndpoint(target, makeEpisodeId(target)))}>{t("triggerSensor")}</Button>
          <Button variant="outline" className="h-12" disabled={busy} onClick={() => run(() => runDueCheckIns(SAMPLE_ANSWERS[outcome]))}>{t("runDue")}</Button>
          <Button variant="outline" className="h-12" disabled={busy} onClick={() => run(async () => {
            const r = await supabase.from("call_jobs").update({ due_at: new Date().toISOString() }).eq("status", "queued").eq("kind", "retry").select("id");
            return r.data?.length ?? 0;
          })}>{t("fastForward")}</Button>
        </div>
      </section>

      {/* Cantonese check-in call — the assistant speaks the script, the elder answers on the keypad. */}
      <section className="space-y-3">
        <h2 className="text-2xl">{t("demoCallTitle")}</h2>
        <p className="text-sm text-muted-foreground">{t("demoCallNote")}</p>
        <CantoneseDemoCall
          elderName={elders.data?.find((e) => e.id === target)?.display_name ?? ""}
          voiceEngine={speech.data?.available ? voiceEngine : undefined}
          speechUnavailableReason={speech.data?.available ? undefined : speech.data?.reason}
          conversationEngine={conversationEngine}
          onComplete={(r) => {
            // The captured answer is applied through the same runner a live call uses,
            // so the dashboard, escalation chain and analytics react identically.
            void runOutcome(r.outcome);
          }}
        />
      </section>

      <section className="space-y-3">
        <h2 className="text-2xl">{t("chain")}</h2>
        {(openCases.data ?? []).length === 0 && <p className="text-muted-foreground">{t("noCases")}</p>}
        {openCases.data?.map((c) => {
          const calling = c.escalation_steps.find((s) => s.status === "calling");
          return (
            <div key={c.id} className="flex flex-wrap items-center gap-3 rounded-lg border bg-card p-4">
              <span className="font-bold">{c.elders?.display_name}</span>
              <span>{t(c.reason)}</span>
              <span className="text-sm text-muted-foreground">→ {calling ? t(calling.target) : "—"}</span>
              <span className="ml-auto flex gap-2">
                <Button size="sm" className="min-h-10" disabled={!calling || busy} onClick={() => run(async () => { await advanceCaseChain(c.id, "answered"); return 0; })}>{t("chainAnswer")}</Button>
                <Button size="sm" variant="outline" className="min-h-10" disabled={!calling || busy} onClick={() => run(async () => { await advanceCaseChain(c.id, "no_answer"); return 0; })}>{t("chainNoAnswer")}</Button>
              </span>
            </div>
          );
        })}
      </section>

      <section className="rounded-lg border bg-card p-5">
        <h2 className="text-2xl">{t("script")}</h2>
        <ol className="mt-3 space-y-2">
          {CALL_SCRIPT.map((s) => <li key={s.id}><b>{s.id}:</b> {lang === "zh" ? s.zh : s.en}</li>)}
        </ol>
      </section>
    </div>
  );
}
