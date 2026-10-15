/**
 * Tests for the dashboard sensor trigger.
 *
 * The bug these guard against was not a crash — it was SILENCE. The button's
 * handler resolved "successfully" with a meaningless value while the write it
 * depended on had actually failed, so a caregiver saw nothing at all: no toast,
 * no error, no alert row. Every test here is written to fail if a failed or
 * unconfirmed trigger is allowed to pass silently.
 *
 * `triggerSensorViaEndpoint` therefore has exactly one failure channel — a
 * thrown Error. These tests pin that contract from four angles:
 *
 *   1. a non-2xx response throws (rather than resolving),
 *   2. a 2xx body that still says `{ ok: false }` throws (the precise class of
 *      response the old code discarded),
 *   3. a missing session throws instead of no-oping,
 *   4. the happy path resolves with the server's body AND actually hits the
 *      authenticated route with the bearer token.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The orchestrator reads the session from the Supabase client. Mock that module
// so the tests never touch a real backend; auth.getSession is the only method
// triggerSensorViaEndpoint uses.
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      getSession: vi.fn(async () => ({
        data: { session: { access_token: "test-token" } },
        error: null,
      })),
    },
  },
}));

import { triggerSensorViaEndpoint } from "@/lib/orchestrator";
import { supabase } from "@/integrations/supabase/client";

/** A minimal Response stand-in; only the members the function reads. */
function fakeResponse(ok: boolean, status: number, body: unknown): Response {
  return {
    ok,
    status,
    json: async () => body,
  } as unknown as Response;
}

const ELDER = "0ec7a7ef-d938-45f1-b0dd-d741bcd84726";

describe("triggerSensorViaEndpoint", () => {
  const getSession = vi.mocked(supabase.auth.getSession);

  beforeEach(() => {
    getSession.mockResolvedValue({
      data: { session: { access_token: "test-token" } },
      error: null,
    } as never);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("throws when the server responds with a non-2xx status", async () => {
    // The old code's failure mode in one line: Supabase returned an error
    // object, not a throw, and it was dropped. A 500 here must NOT be dropped.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => fakeResponse(false, 500, { ok: false, error: "boom" })),
    );

    await expect(triggerSensorViaEndpoint(ELDER, "ui-test-1")).rejects.toThrow(/boom/);
  });

  it("throws when a 2xx response still reports ok:false", async () => {
    // Some failures arrive as HTTP 200 with a body that says the work did not
    // happen (e.g. a consent/rate-limit refusal returned via a proxy). Treating
    // that as success is exactly the silent no-op this bug was made of.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => fakeResponse(true, 200, { ok: false, error: "duplicate blocked" })),
    );

    await expect(triggerSensorViaEndpoint(ELDER, "ui-test-2")).rejects.toThrow(/duplicate blocked/);
  });

  it("throws when there is no signed-in session", async () => {
    getSession.mockResolvedValueOnce({ data: { session: null }, error: null } as never);

    // fetch must never be reached when we have no token to send.
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    await expect(triggerSensorViaEndpoint(ELDER, "ui-test-3")).rejects.toThrow(/sign in/i);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("posts to the authenticated route with the bearer token and returns the server body", async () => {
    const fetchSpy = vi.fn(async () =>
      fakeResponse(true, 200, { ok: true, duplicate: false, outcome: "no_answer", step: "retry" }),
    );
    vi.stubGlobal("fetch", fetchSpy);

    const result = await triggerSensorViaEndpoint(ELDER, "ui-test-4");

    expect(result).toMatchObject({ ok: true, duplicate: false, outcome: "no_answer" });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/sensors/trigger");
    expect(init.method).toBe("POST");
    const headers = init.headers as Record<string, string>;
    expect(headers["authorization"]).toBe("Bearer test-token");
    expect(JSON.parse(init.body as string)).toEqual({ elderId: ELDER, externalId: "ui-test-4" });
  });
});
