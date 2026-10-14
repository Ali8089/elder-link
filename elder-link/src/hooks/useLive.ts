import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/** Refetch all queries when shared tables change, so every signed-in staff member sees the same view. */
export function useLive() {
  const qc = useQueryClient();
  useEffect(() => {
    const ch = supabase
      .channel("el-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "cases" }, () => qc.invalidateQueries())
      .on("postgres_changes", { event: "*", schema: "public", table: "escalation_steps" }, () => qc.invalidateQueries())
      .on("postgres_changes", { event: "*", schema: "public", table: "call_jobs" }, () => qc.invalidateQueries())
      .on("postgres_changes", { event: "*", schema: "public", table: "elders" }, () => qc.invalidateQueries())
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [qc]);
}
