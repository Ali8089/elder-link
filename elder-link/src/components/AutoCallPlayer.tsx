// Plays the recorded Cantonese script when the server announces a call.
//
// Mounted once in the authenticated layout, so it is listening on every staff
// screen — a caregiver does not have to be on the call-controls page to hear
// an elder being called. That is the whole point: the alarm should produce a
// call they can HEAR, without anyone pressing anything.
//
// This is a headless driver, not the on-screen phone. `CantoneseDemoCall` owns
// the interactive call (keypad, microphone, transcript) and is still the right
// component when a human is walking through a call by hand. This component
// covers the unattended case: the same script, the same clips, no interaction.
//
// Audio policy: browsers block `play()` until the page has had a gesture. The
// dashboard is behind a sign-in, so the gesture already happened — but the
// block can still appear (a reloaded tab, a strict autoplay policy). When it
// does, this renders a "press to hear" button rather than failing silently,
// because a silent failure here is exactly the bug being fixed.

import { useCallback, useEffect, useRef, useState } from "react";
import { PhoneCall } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { CALL_AUDIO, CALL_SCRIPT, buildCallSequence } from "@/lib/script";
import type { Outcome } from "@/lib/engine";
import { Button } from "@/components/ui/button";

/** One call as the server announced it (mirrors src/lib/call-broadcast.ts). */
interface AnnouncedCall {
  id: string;
  jobId: string;
  elderId: string;
  elderName: string;
  simulatedAnswer: string | null;
  at: string;
}

/**
 * Which reaction line a simulated answer corresponds to.
 *
 * The server sends the *spoken text*, not an outcome, because that is what a
 * provider would really return. Mapping it back is therefore done on the words
 * the demo actually uses. Anything unrecognised — including null, which is
 * what the sensor path always sends — is a no-answer, which is also the
 * honest default: we have no evidence the elder spoke.
 */
function outcomeForAnswer(answer: string | null): Outcome {
  if (!answer) return "no_answer";
  const a = answer.trim();
  if (a === "") return "no_answer";
  if (a.includes("救命") || a.includes("跌倒")) return "danger";
  if (a.includes("唔舒服") || a.includes("頭暈") || a.includes("头晕")) return "worrying";
  if (a.includes("冇事") || a.includes("幾好") || a.includes("几好")) return "safe";
  return "unclear";
}

/** Play one clip and resolve when it finishes (or immediately if it cannot). */
function playClip(src: string, timeoutMs = 15_000): Promise<"played" | "blocked" | "error"> {
  return new Promise((resolve) => {
    const el = new Audio(src);
    let settled = false;
    const finish = (r: "played" | "blocked" | "error") => {
      if (settled) return;
      settled = true;
      el.onended = null;
      el.onerror = null;
      resolve(r);
    };
    el.onended = () => finish("played");
    el.onerror = () => finish("error");
    // A clip that never fires `ended` must not wedge the queue forever.
    setTimeout(() => finish("played"), timeoutMs);
    el.play().then(
      () => {},
      () => finish("blocked"),
    );
  });
}

export function AutoCallPlayer() {
  const [active, setActive] = useState<AnnouncedCall | null>(null);
  /** Set when the browser refused to autoplay, so we can offer a manual start. */
  const [needsGesture, setNeedsGesture] = useState(false);
  /** Ids already played, so a 30s poll never replays a call. */
  const playedRef = useRef<Set<string>>(new Set());
  /** Newest announcement timestamp seen, used as the `?since=` cursor. */
  const cursorRef = useRef<string | null>(null);
  /** True while a call is playing, so two calls never overlap. */
  const busyRef = useRef(false);
  /** Set on unmount so an in-flight call stops instead of writing state. */
  const cancelledRef = useRef(false);

  const playCall = useCallback(async (call: AnnouncedCall) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setNeedsGesture(false);
    setActive(call);

    const outcome = outcomeForAnswer(call.simulatedAnswer);
    for (const step of buildCallSequence(outcome)) {
      if (cancelledRef.current) break;
      const src = CALL_AUDIO[step.lineId];
      if (!src) continue;
      const result = await playClip(src);
      if (result === "blocked") {
        // Give up on this call and ask for a gesture. Leaving `playedRef`
        // untouched is deliberate: the elder was never actually called, so the
        // call must stay un-played and be offered again on the next poll.
        busyRef.current = false;
        setNeedsGesture(true);
        return;
      }
      // A missing clip still advances: one bad file must not silence the rest.
      await new Promise((r) => setTimeout(r, Math.min(step.pauseAfter, 1200)));
    }

    busyRef.current = false;
    if (!cancelledRef.current) {
      playedRef.current.add(call.id);
      setTimeout(() => {
        if (!cancelledRef.current) setActive(null);
      }, 1200);
    }
  }, []);

  useEffect(() => {
    cancelledRef.current = false;
    let stopped = false;

    const poll = async () => {
      if (stopped || busyRef.current) return;
      try {
        const { data } = await supabase.auth.getSession();
        const token = data.session?.access_token;
        if (!token) return;
        const qs = cursorRef.current ? `?since=${encodeURIComponent(cursorRef.current)}` : "";
        const res = await fetch(`/api/calls/recent${qs}`, {
          headers: { authorization: `Bearer ${token}` },
        });
        if (!res.ok) return;
        const body = (await res.json()) as { calls?: AnnouncedCall[] };
        const calls = body.calls ?? [];
        // Advance the cursor even when nothing is playable, so the next poll
        // asks only about what happened after this one.
        for (const c of calls) {
          if (!cursorRef.current || Date.parse(c.at) > Date.parse(cursorRef.current)) {
            cursorRef.current = c.at;
          }
        }
        const next = calls.find((c) => !playedRef.current.has(c.id));
        if (next) await playCall(next);
      } catch {
        // Network hiccup — the next poll tries again. Never a crash: a broken
        // speaker must not take the dashboard down with it.
      }
    };

    const id = setInterval(poll, 5_000);
    void poll();
    return () => {
      stopped = true;
      cancelledRef.current = true;
      clearInterval(id);
    };
  }, [playCall]);

  // Rendered only when the browser refused to autoplay: the call has NOT
  // happened yet, so the caregiver is asked to unlock audio so it can.
  if (needsGesture && active) {
    return (
      <div className="fixed bottom-4 right-4 z-50 max-w-xs rounded-lg border bg-card p-4 shadow-lg">
        <p className="flex items-center gap-2 font-semibold">
          <PhoneCall aria-hidden className="h-4 w-4" /> Incoming call — {active.elderName}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          Your browser blocked automatic audio. Press to hear the call.
        </p>
        <Button className="mt-3 w-full" onClick={() => void playCall(active)}>
          Play call audio
        </Button>
      </div>
    );
  }

  if (!active) return null;

  return (
    <div className="fixed bottom-4 right-4 z-50 flex items-center gap-3 rounded-lg border bg-card px-4 py-3 shadow-lg">
      <span className="relative flex h-3 w-3">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-400 opacity-75" />
        <span className="relative inline-flex h-3 w-3 rounded-full bg-red-500" />
      </span>
      <div>
        <p className="text-sm font-semibold">Calling {active.elderName}…</p>
        <p className="text-xs text-muted-foreground">
          {CALL_SCRIPT[0] ? "Elder Link automated check-in (Cantonese)" : ""}
        </p>
      </div>
    </div>
  );
}
