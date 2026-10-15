import { describe, expect, it, beforeEach } from "vitest";
import { announceCall, callsSince, clearAnnouncements } from "./call-broadcast";

const base = { elderId: "e1", elderName: "周伯", simulatedAnswer: null };

describe("call-broadcast", () => {
  beforeEach(() => clearAnnouncements());

  it("announces a call with a stable, job-derived id", () => {
    const a = announceCall({ ...base, jobId: "j1" });
    expect(a.id).toBe("mock-call:j1");
    expect(a.elderName).toBe("周伯");
    expect(a.simulatedAnswer).toBeNull();
  });

  it("is idempotent for the same job — re-running cannot enqueue a second call", () => {
    announceCall({ ...base, jobId: "j1" });
    announceCall({ ...base, jobId: "j1" });
    expect(callsSince(null)).toHaveLength(1);
  });

  it("keeps distinct jobs distinct", () => {
    announceCall({ ...base, jobId: "j1" });
    announceCall({ ...base, jobId: "j2" });
    expect(callsSince(null).map((c) => c.jobId)).toEqual(["j1", "j2"]);
  });

  it("returns the announcement for a null simulated answer (the sensor path)", () => {
    const a = announceCall({ ...base, jobId: "j1", simulatedAnswer: null });
    expect(a.simulatedAnswer).toBeNull();
  });

  it("returns everything retained when `since` is absent", () => {
    announceCall({ ...base, jobId: "j1", at: new Date("2026-10-15T10:00:00Z") });
    announceCall({ ...base, jobId: "j2", at: new Date("2026-10-15T10:00:05Z") });
    expect(callsSince(null)).toHaveLength(2);
  });

  it("filters STRICTLY newer, so the last-played call is never replayed", () => {
    announceCall({ ...base, jobId: "j1", at: new Date("2026-10-15T10:00:00Z") });
    announceCall({ ...base, jobId: "j2", at: new Date("2026-10-15T10:00:05Z") });
    const after = callsSince("2026-10-15T10:00:00Z");
    expect(after.map((c) => c.jobId)).toEqual(["j2"]);
  });

  it("treats an unparsable `since` as absent rather than returning nothing", () => {
    announceCall({ ...base, jobId: "j1" });
    expect(callsSince("not-a-date")).toHaveLength(1);
  });

  it("caps retention so a long-running process cannot grow without bound", () => {
    for (let i = 0; i < 60; i++) {
      announceCall({ ...base, jobId: `j${i}`, at: new Date(Date.UTC(2026, 9, 15, 10, 0, i)) });
    }
    const all = callsSince(null);
    expect(all).toHaveLength(50);
    // Oldest are dropped, newest are kept.
    expect(all[all.length - 1]?.jobId).toBe("j59");
    expect(all.some((c) => c.jobId === "j0")).toBe(false);
  });
});
