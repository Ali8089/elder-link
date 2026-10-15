// Is the scheduler actually running?
//
// This exists because of a specific, silent failure: the door sensor can only be
// read when something asks it, and if the thing that asks — the cron tick — stops
// being scheduled, *nothing* happens and *nothing says so*. The app keeps
// serving pages, the database keeps answering, the dashboard looks healthy. The
// only way to notice is to know when the tick last ran, which is precisely what
// a stopped tick cannot tell you from the inside.
//
// So the tick writes a pulse to a file on the way out, and the watchdog reads
// it. Writing the last run time *before* doing the work would be wrong: a tick
// that starts and then hangs for nine minutes would look alive the whole time.
// The file is touched on completion, so its age is the age of the last
// *completed* run.
//
// A file rather than a table row because this is liveness, not data: it must
// survive the database being the thing that is down, and it must not appear in
// backups, RLS policies, or the audit trail. The cost is that it describes one
// host — which is exactly the granularity at which "is cron firing" is asked.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

/** Where the pulse is kept. Overridable so tests and odd hosts can redirect it. */
export function heartbeatPath(env: (key: string) => string | undefined = (k) =>
  typeof process !== "undefined" ? process.env[k] : undefined): string {
  return env("RUNNER_HEARTBEAT_PATH") ?? "/tmp/elder-link-runner-heartbeat.json";
}

export type Heartbeat = {
  /** ISO instant of the last completed tick. */
  at: string;
  /** Whether that tick's work succeeded — a live-but-failing scheduler is a different alarm. */
  ok: boolean;
};

/**
 * How stale a pulse may be before the scheduler is presumed stopped.
 *
 * Three minutes against a one-minute schedule: one missed tick is a hiccup
 * (a deploy, a cold start, a slow query), three in a row is a stopped clock.
 * Being too eager here is expensive — it escalates to a human being woken up.
 */
export const HEARTBEAT_STALE_SECONDS = 180;

export function heartbeatAgeSeconds(hb: Heartbeat | null, now: Date): number | null {
  if (!hb) return null;
  const at = Date.parse(hb.at);
  if (Number.isNaN(at)) return null;
  return Math.round((now.getTime() - at) / 1000);
}

/**
 * True when the scheduler should be treated as down.
 *
 * A missing pulse is treated as down, not as unknown. The alternative — assume
 * it is fine until proven otherwise — means a cron that was never configured in
 * the first place is indistinguishable from a healthy system, and the sensor is
 * silently unmonitored for the whole pilot.
 */
export function runnerLooksStopped(hb: Heartbeat | null, now: Date, staleSeconds = HEARTBEAT_STALE_SECONDS): boolean {
  const age = heartbeatAgeSeconds(hb, now);
  if (age === null) return true;
  // Clock skew between writers and readers must not fake an outage.
  return age > staleSeconds;
}

/** Records that a tick completed. Best-effort: never let liveness break the tick. */
export const heartbeat = {
  async record(now: Date, opts: { ok: boolean; path?: string } = { ok: true }): Promise<void> {
    const path = opts.path ?? heartbeatPath();
    try {
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, JSON.stringify({ at: now.toISOString(), ok: opts.ok }), "utf8");
    } catch (e) {
      // A read-only or missing /tmp must not fail check-ins. The watchdog will
      // see a stale pulse and escalate, which is the correct conservative
      // outcome for a machine that cannot record its own pulse.
      console.error(`[heartbeat] could not write ${path}: ${(e as Error).message}`);
    }
  },

  async read(path = heartbeatPath()): Promise<Heartbeat | null> {
    try {
      const raw = await readFile(path, "utf8");
      const parsed = JSON.parse(raw) as Partial<Heartbeat>;
      if (typeof parsed.at !== "string") return null;
      return { at: parsed.at, ok: parsed.ok === true };
    } catch {
      return null;
    }
  },
};

// Silence an unused-import style complaint in editors that do not see the
// `node:fs/promises` types through the bundler's resolution.
void readFile;
