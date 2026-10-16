// Shows, automatically, that a check-in call is being made.
//
// Why this reads the DATABASE rather than an in-memory announcement log: the
// call is placed by whichever server instance handled the alarm — the local app
// when the door sensor is on the same LAN, a serverless function when the phone
// notifies it, or the cron tick. An in-process log only exists inside the one
// process that wrote it, so a dashboard served by a different instance (or a
// different deployment) heard nothing and no call ever appeared. `call_jobs` is
// the durable record every instance shares, and `started_at` is stamped at the
// moment a call is actually placed — so it is the one reliable "a call is
// happening" signal.
//
// The Cantonese script is deliberately NOT played here. The call happens on the
// elder's phone; the dashboard only needs to show that it is happening. Playing
// clips in a dashboard tab was also a second, wrong rendering of the same call.

import { useEffect, useRef, useState } from "react";
import { PhoneCall } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

/**
 * How long a call keeps showing after it was placed.
 *
 * A check-in call is short, so this only has to outlast the polling gap; long
 * enough that a dashboard which polls every few seconds never misses one, short
 * enough that a finished call does not leave a stale banner on screen.
 */
export const CALL_ACTIVE_MS = 45_000;

/** How often to look. Short enough to feel immediate, cheap enough to leave open. */
export const CALL_POLL_MS = 4_000;

/** A call that started recently enough to still be reported. */
type ActiveCall = {
  id: string;
  kind: string;
  elderName: string;
};

export function LiveCallBanner() {
  const [active, setActive] = useState<ActiveCall | null>(null);
  /** Job ids already reported, so one call cannot re-appear on every poll. */
  const seen = useRef<Set<string>>(new Set());

  useEffect(() => {
    let stopped = false;

    async function poll() {
      if (stopped) return;
      try {
        const since = new Date(Date.now() - CALL_ACTIVE_MS).toISOString();
        const { data } = await supabase
          .from("call_jobs")
          // `started_at` is only set once a call is actually placed, so the
          // filter is also what keeps queued-but-not-yet-run jobs out.
          .select("id, kind, started_at, elders(display_name)")
          .gte("started_at", since)
          .order("started_at", { ascending: false })
          .limit(1);
        if (stopped) return;

        const job = (data ?? [])[0];
        if (!job) {
          // Nothing recent: the call has finished (or was never placed).
          setActive(null);
          return;
        }
        if (seen.current.has(job.id)) return;
        seen.current.add(job.id);
        setActive({
          id: job.id,
          kind: job.kind,
          elderName: job.elders?.display_name ?? "",
        });
      } catch {
        // A failed poll must never take the dashboard down; the next one retries.
      }
    }

    void poll();
    const timer = setInterval(() => void poll(), CALL_POLL_MS);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, []);

  if (!active) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="live-call-banner"
      className="fixed bottom-4 right-4 z-50 flex items-center gap-3 rounded-lg border bg-card px-4 py-3 shadow-lg"
    >
      <span className="relative flex h-3 w-3" aria-hidden>
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-400 opacity-75" />
        <span className="relative inline-flex h-3 w-3 rounded-full bg-red-500" />
      </span>
      <PhoneCall aria-hidden className="h-4 w-4 shrink-0" />
      <div>
        <p className="text-sm font-semibold">
          {active.elderName ? `Calling ${active.elderName}…` : "Placing a check-in call…"}
        </p>
        <p className="text-xs text-muted-foreground">
          {active.kind === "sensor"
            ? "Door sensor alert — check-in call under way"
            : "Check-in call under way"}
        </p>
      </div>
    </div>
  );
}
