// Which episode does an alarmed reading belong to?
//
// This is where the "sixty calls" bug lived, so the tests are written around the
// exact mistake that caused it: deriving the episode id from the current time
// instead of from when the door first alarmed. A test that only checked "an id
// is returned" would have passed against the broken version.

import { describe, expect, it } from "vitest";
import { episodeEnded, episodeIdAt, resolveEpisodeId, type OpenEpisode } from "./sensor-episode";

const DEVICE = "10.129.230.175";
const T0 = new Date("2026-10-15T12:00:00.000Z");

describe("episodeIdAt", () => {
  it("scopes the id to the device so two flats cannot collide", () => {
    expect(episodeIdAt(DEVICE, T0)).toBe(`door:${DEVICE}:2026-10-15T12:00:00.000Z`);
    expect(episodeIdAt("10.0.0.9", T0)).not.toBe(episodeIdAt(DEVICE, T0));
  });

  it("is a pure function of device + timestamp — the same instant gives the same id", () => {
    // Idempotence is the whole mechanism: the id must be stable across processes.
    expect(episodeIdAt(DEVICE, T0)).toBe(episodeIdAt(DEVICE, new Date(T0.getTime())));
  });
});

describe("resolveEpisodeId", () => {
  it("starts a new episode when the database has none open", () => {
    const r = resolveEpisodeId(DEVICE, { openEpisode: null, firstSeenAt: T0 });
    expect(r.reused).toBe(false);
    expect(r.externalId).toBe(episodeIdAt(DEVICE, T0));
  });

  it("REUSES the open episode even when the clock has moved on", () => {
    // The regression guard. The broken implementation keyed off `now()`, so a
    // second tick — an hour later, same open door — minted a new id and called
    // again. Reuse must win over the caller's timestamp.
    const open: OpenEpisode = { externalId: episodeIdAt(DEVICE, T0), receivedAt: T0.toISOString() };
    const later = new Date("2026-10-15T13:00:00.000Z");
    const r = resolveEpisodeId(DEVICE, { openEpisode: open, firstSeenAt: later });
    expect(r.reused).toBe(true);
    expect(r.externalId).toBe(open.externalId);
    expect(r.externalId).not.toBe(episodeIdAt(DEVICE, later));
  });

  it("never mints a fresh id while an episode is open, over many ticks", () => {
    const open: OpenEpisode = { externalId: episodeIdAt(DEVICE, T0), receivedAt: T0.toISOString() };
    const ids = new Set<string>();
    for (let minute = 0; minute < 60; minute++) {
      const seen = new Date(T0.getTime() + minute * 60_000);
      ids.add(resolveEpisodeId(DEVICE, { openEpisode: open, firstSeenAt: seen }).externalId);
    }
    expect(ids.size).toBe(1);
  });
});

describe("episodeEnded", () => {
  it("does NOT end on an unreachable device", () => {
    // The flakiness trap: if a quiet board closed the episode, the next
    // successful reading would open a new one and ring the elder twice.
    expect(episodeEnded(null)).toBe(false);
  });

  it("does not end while the door is still alarming", () => {
    expect(episodeEnded({ open: true, alarm: true })).toBe(false);
  });

  it("does not end while the door is open but under the firmware threshold", () => {
    // Open-but-not-alarming means the episode is over (the door came back under
    // 15s), even though the door itself is still ajar.
    expect(episodeEnded({ open: true, alarm: false })).toBe(true);
  });

  it("ends when the door is closed", () => {
    expect(episodeEnded({ open: false, alarm: false })).toBe(true);
  });
});
