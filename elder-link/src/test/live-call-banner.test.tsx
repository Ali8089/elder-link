/**
 * The live-call banner.
 *
 * It reads the database rather than the old in-memory announcement log, because
 * the call can be placed by any of several processes — the local app when the
 * door sensor is on the LAN, the phone's notify call, the cron tick, or a
 * separate serverless function — and an in-process log is only visible to the
 * one process that wrote it. This test mocks the query with the same shape and
 * asserts the three things that matter: the banner appears for a freshly-started
 * call, it names the elder, and it stays silent when there is no call. The
 * fourth assertion is the deliberate behaviour change: no audio.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

const h = vi.hoisted(() => ({
  rows: [] as unknown[],
  queries: [] as string[],
}));

vi.mock("@/integrations/supabase/client", () => {
  type Builder = {
    select: () => Builder;
    gte: () => Builder;
    order: () => Builder;
    limit: () => Promise<{ data: unknown[]; error: null }>;
  };
  return {
    supabase: {
      from: (table: string) => {
        h.queries.push(table);
        const builder: Builder = {
          select: () => builder,
          gte: () => builder,
          order: () => builder,
          limit: () => Promise.resolve({ data: h.rows, error: null }),
        };
        return builder;
      },
    },
  };
});

const { LiveCallBanner } = await import("@/components/LiveCallBanner");

function call(kind: string, elderName: string, id: string) {
  return { id, kind, started_at: new Date().toISOString(), elders: { display_name: elderName } };
}

describe("live call banner", () => {
  beforeEach(() => {
    h.rows = [];
    h.queries = [];
  });

  it("shows nothing while no call has started", async () => {
    render(<LiveCallBanner />);
    await waitFor(() => expect(h.queries).toContain("call_jobs"));
    expect(screen.queryByTestId("live-call-banner")).toBeNull();
  });

  it("shows the elder being called as soon as a call starts", async () => {
    h.rows = [call("demo", "陳婆婆", "j1")];
    render(<LiveCallBanner />);
    const banner = await screen.findByTestId("live-call-banner");
    expect(banner.textContent).toContain("Calling 陳婆婆…");
  });

  it("names the door-sensor alarm as the reason when that is what started it", async () => {
    h.rows = [call("sensor", "周伯", "j2")];
    render(<LiveCallBanner />);
    const banner = await screen.findByTestId("live-call-banner");
    expect(banner.textContent).toContain("Door sensor alert");
  });

  it("plays no audio — the call itself happens on the elder's phone", async () => {
    h.rows = [call("sensor", "周伯", "j3")];
    const { container } = render(<LiveCallBanner />);
    await screen.findByTestId("live-call-banner");
    expect(container.querySelectorAll("audio")).toHaveLength(0);
  });
});
