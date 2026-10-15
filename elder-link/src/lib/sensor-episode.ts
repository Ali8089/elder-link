// Deciding which door-open episode a reading belongs to.
//
// This is the heart of "call once per open door", and it is easy to get subtly
// wrong in a way that only shows up under a real scheduler.
//
// The trap: if the episode id is derived from the moment the poller *noticed*
// the alarm — `door:<device>:<now>` — then every scheduler tick invents a fresh
// episode, the UNIQUE constraint on `sensor_alerts.external_id` never fires, and
// the elder is rung on every tick for as long as the door stays open. The rate
// limiter would eventually blunt it, which makes it worse: the bug hides behind
// a different control instead of failing loudly.
//
// The fix is to key the episode to the moment the door *first went past the
// threshold*, and to remember that moment for as long as the door stays alarmed.
// A door open for an hour is one episode no matter how many times we look at it.
//
// Because the tick is stateless (each invocation is a fresh process, and there
// may be several running), that memory cannot live in a variable. It lives in
// the database: the open `sensor_alerts` row for this device *is* the episode
// marker. See findOpenEpisode below.

/** The device's own verdict on one reading. */
export type DoorState = {
  /** True while the door is held open. */
  open: boolean;
  /** True once the firmware's threshold has elapsed. */
  alarm: boolean;
};

/** A door-open episode as recorded in the database. */
export type OpenEpisode = {
  /** The `sensor_alerts.external_id` of the open episode. */
  externalId: string;
  /** When it was first recorded. */
  receivedAt: string;
  /**
   * The onset moment of the episode, read back out of its id.
   *
   * Optional because a row written by an older build, or by hand, may not carry
   * one; callers fall back to `receivedAt` in that case.
   */
  openedAt?: string;
};

/**
 * A stable episode id derived from the moment the alarm was first observed.
 *
 * `deviceId` scopes it so two flats' sensors can never collide. The timestamp
 * must be the *first* observation of this alarm, not the current time.
 */
export function episodeIdAt(deviceId: string, firstAlarmedAt: Date): string {
  return `door:${deviceId}:${firstAlarmedAt.toISOString()}`;
}

/**
 * Pick the episode id to claim for an alarmed reading.
 *
 * If the database already holds an open episode for this device, this reading
 * belongs to it — reuse that id so the claim collides and no second call is
 * made. Otherwise this is a new door-open and the caller's timestamp starts one.
 *
 * Why this is a pure function taking the open episode as an argument, rather
 * than doing the lookup itself: the decision is the part worth testing, and it
 * needs no database to test. The lookup is a one-line query at the call site.
 */
export function resolveEpisodeId(
  deviceId: string,
  alarmObservations: {
    /** The open episode for this device, if the database has one. */
    openEpisode: OpenEpisode | null;
    /** When this alarm was first seen by *this* process, used only to start one. */
    firstSeenAt: Date;
  },
): { externalId: string; reused: boolean } {
  if (alarmObservations.openEpisode) {
    return { externalId: alarmObservations.openEpisode.externalId, reused: true };
  }
  return { externalId: episodeIdAt(deviceId, alarmObservations.firstSeenAt), reused: false };
}

/**
 * Finish a running episode and hand back the id its successor should use.
 *
 * A door closes and reopens — perhaps within the same second — and the episode
 * id is derived from the reopen timestamp. Two alarms that land in the same
 * millisecond therefore mint the *same* id, so the successor collides with its
 * predecessor's `sensor_alerts.external_id` and the claim is refused. The elder
 * would be silenced for that door permanently, which is far worse than the
 * duplicate call the dedup exists to prevent.
 *
 * The fix is not to make ids finer-grained — any resolution can be collided at.
 * It is to make sure the id is never reused: the episode that is ending is
 * finished first, and only then does the caller ask for the next id. This
 * function encodes that order so it cannot be got wrong at the call site.
 *
 * Returns the id that was closed, and whether anything actually was (there is
 * usually no open episode to close, which is not an error).
 */
export function finishEpisode(
  deviceId: string,
  episode: OpenEpisode | null,
  endedAt: Date,
): { closedExternalId: string | null; closedAt: string } {
  return { closedExternalId: episode?.externalId ?? null, closedAt: endedAt.toISOString() };
}

/**
 * True when a previously open episode should now be considered finished.
 *
 * An episode ends when the door is observed back below the alarm state. It is
 * deliberately NOT ended by an unreachable device: a board on domestic wifi
 * going quiet for one tick must not close the episode, or the next successful
 * reading would start a fresh one and ring the elder a second time for the same
 * open door.
 */
export function episodeEnded(reading: DoorState | null): boolean {
  if (reading === null) return false;
  return !reading.alarm;
}
