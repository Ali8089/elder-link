import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { advanceCaseChain, runCallJob } from "@/lib/orchestrator";

/** Prototype scheduler: while a staff dashboard is open, run retry jobs whose time has come (simulated as no answer). */
export function useScheduler() {
  const qc = useQueryClient();
  useEffect(() => {
    let running = false;
    const tick = async () => {
      if (running) return;
      running = true;
      try {
        const { data } = await supabase
          .from("call_jobs")
          .select("id")
          .eq("status", "queued")
          .eq("kind", "retry")
          .lte("due_at", new Date().toISOString());
        for (const j of data ?? []) {
          // Claim the job first so two open dashboards never run it twice.
          const claim = await supabase.from("call_jobs").update({ status: "ringing" }).eq("id", j.id).eq("status", "queued").select("id");
          if (claim.data?.length) await runCallJob(j.id, null);
        }
        // Contact chain: a contact who hasn't picked up within 2 minutes is treated as no answer and the next one is called.
        const cutoff = new Date(Date.now() - 2 * 60_000).toISOString();
        const { data: stale } = await supabase
          .from("escalation_steps")
          .select("id, case_id, cases!inner(status)")
          .eq("status", "calling")
          .eq("cases.status", "open")
          .lte("started_at", cutoff);
        for (const s of stale ?? []) {
          // Re-check the step is still ringing so two dashboards don't advance it twice.
          const still = await supabase.from("escalation_steps").select("id").eq("id", s.id).eq("status", "calling");
          if (still.data?.length) await advanceCaseChain(s.case_id, "no_answer");
        }
        if (data?.length || stale?.length) qc.invalidateQueries();
      } finally {
        running = false;
      }
    };
    tick();
    const id = setInterval(tick, 30_000);
    return () => clearInterval(id);
  }, [qc]);
}
