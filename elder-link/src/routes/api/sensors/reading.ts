// GET /api/sensors/reading — the physical door sensor's current state.
//
// Why this exists: the dashboard needs to show that the app and the hardware
// agree. It cannot do that by reading our own database, because a stored row
// only says what the device reported at some point in the past. So this route
// asks the device directly and hands the answer back untouched.
//
// It is a read-only proxy and deliberately a thin one:
//
//   * The device URL is server configuration (`SENSOR_URL`), never a request
//     parameter. Accepting a URL from the caller would turn this into an open
//     proxy for probing the LAN.
//   * It is behind the staff session like the rest of the dashboard.
//   * A device that is unreachable is a normal event on domestic wifi, so the
//     route answers 200 with `{ reading: null }` and a reason rather than an
//     error the UI has to special-case.
//
// The reading shape is intentionally passed through as-is: `{fsr, open, alarm}`.
// `alarm` is the firmware's own verdict on a door held open past its threshold,
// and it is the signal the poller acts on.

import { createFileRoute } from "@tanstack/react-router";
import { parseReading } from "@/lib/sensor";
import { describeThreshold } from "@/lib/device-threshold";

function env(key: string): string | undefined {
  return typeof process !== "undefined" ? process.env[key] : undefined;
}

export const Route = createFileRoute("/api/sensors/reading")({
  server: {
    handlers: {
      GET: async () => {
        const url = env("SENSOR_URL") ?? "http://10.129.230.175/data";
        const timeoutMs = Number(env("SENSOR_TIMEOUT_MS") ?? 4_000);

        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        try {
          const res = await fetch(url, { signal: controller.signal });
          if (!res.ok) {
            return Response.json({ reading: null, reason: `device returned ${res.status}`, threshold: describeThreshold() });
          }
          // Validate rather than trust: a captive portal or a half-written body
          // can return valid JSON that is not a reading.
          const reading = parseReading(await res.json());
          if (!reading) {
            return Response.json({ reading: null, reason: "device response was not a reading", threshold: describeThreshold() });
          }
          return Response.json({ reading, threshold: describeThreshold() });
        } catch (e) {
          const reason = (e as Error).name === "AbortError" ? "device timed out" : "device unreachable";
          return Response.json({ reading: null, reason, threshold: describeThreshold() });
        } finally {
          clearTimeout(timer);
        }
      },
    },
  },
});
