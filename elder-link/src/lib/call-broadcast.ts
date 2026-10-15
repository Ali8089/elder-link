// A "call is happening" signal for the browser.
//
// The server has no speaker. The mock provider therefore cannot make anything
// audible on its own: it returns `placed: true` and stops. That is fine for
// tests and fatal for a demo — a caregiver watching the dashboard sees a job
// row appear and hears nothing, which is indistinguishable from a broken call.
//
// So when the mock *accepts* a call, the call is announced here, and the open
// dashboard reads the announcement and plays the recorded Cantonese script
// through the browser. The database remains the source of truth for what
// happened; this log exists only so a human can HEAR it happen.
//
// Deliberately in-process and memory-only:
//   - It carries no data that is not already in `call_jobs`.
//   - Losing it on restart is harmless (worst case: one un-played beep).
//   - A durable queue would imply an at-least-once guarantee this does not
//     offer, and the dashboard must not treat a missed announcement as a
//     missed call.
//
// Only the mock provider announces. A real Twilio call is audible because a
// real telephone rings, and replaying clips in a browser tab alongside it
// would be a second, wrong rendering of the same call.

/** One announced mock call, shaped for the dashboard to play back. */
export interface AnnouncedCall {
  /** Unique per announcement — the dedup key the browser polls against. */
  id: string;
  jobId: string;
  elderId: string;
  /** Shown on the on-screen phone so the caregiver knows who is being called. */
  elderName: string;
  /**
   * The simulated spoken answer, or null.
   *
   * Null means "nobody said anything", which the call script renders as the
   * no-answer line. This is the common case for the sensor path, which passes
   * no answer at all.
   */
  simulatedAnswer: string | null;
  /** ISO instant, used by `?since=` filtering. */
  at: string;
}

/**
 * How many announcements to retain.
 *
 * A dashboard polling every 30s needs only the last few; beyond that the
 * retention exists to survive a briefly-backgrounded tab rather than to be an
 * archive. Bounded so a long-running process cannot grow without limit.
 */
const MAX_ANNOUNCEMENTS = 50;

const announcements: AnnouncedCall[] = [];

/**
 * Records that a mock call was accepted, and returns the announcement.
 *
 * `id` is derived from the job id rather than minted fresh, so replays of the
 * same job are naturally idempotent: re-running a job cannot enqueue a second
 * audible call for it, and the browser's dedup by id needs no extra work.
 */
export function announceCall(input: {
  jobId: string;
  elderId: string;
  elderName: string;
  simulatedAnswer: string | null;
  at?: Date;
}): AnnouncedCall {
  const call: AnnouncedCall = {
    id: `mock-call:${input.jobId}`,
    jobId: input.jobId,
    elderId: input.elderId,
    elderName: input.elderName,
    simulatedAnswer: input.simulatedAnswer,
    at: (input.at ?? new Date()).toISOString(),
  };

  // Replace rather than append if this job was already announced, so the log
  // cannot hold two entries for one call and hand the browser a duplicate.
  const existing = announcements.findIndex((c) => c.id === call.id);
  if (existing >= 0) announcements.splice(existing, 1);
  announcements.push(call);

  // Oldest first: `push` above means the front is the oldest.
  while (announcements.length > MAX_ANNOUNCEMENTS) announcements.shift();

  return call;
}

/**
 * Announcements strictly newer than `since`.
 *
 * Strictly newer, because the caller passes the timestamp of the last call it
 * played: `>=` would replay that exact call on every poll and, because the
 * browser also dedups by id, would be invisible until the one moment it
 * mattered. An absent or unparsable `since` returns everything retained, which
 * is the correct behaviour for a freshly-opened dashboard — it should hear
 * about calls it missed rather than assume none happened.
 */
export function callsSince(since: string | null | undefined): AnnouncedCall[] {
  if (!since) return [...announcements];
  const cutoff = Date.parse(since);
  if (Number.isNaN(cutoff)) return [...announcements];
  return announcements.filter((c) => Date.parse(c.at) > cutoff);
}

/** Test seam: forget every announcement. */
export function clearAnnouncements(): void {
  announcements.length = 0;
}
