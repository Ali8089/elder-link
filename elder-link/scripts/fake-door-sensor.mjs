// Stand-in for the door sensor, for verifying the automatic call path while the
// physical board's web server is unreachable. Pings respond but HTTP does not,
// so this serves the exact same JSON and status-text shape the firmware does.
//
// It can also be *driven*: GET /mode/<mode> switches the state it reports, which
// is what lets scripts/verify-auto-call.mjs walk a door through alarm -> still
// open -> offline -> back -> closed -> alarm and assert on what the app did at
// each step. Without that the end-to-end test could only ever observe one state.
import { createServer } from "node:http";

const PORT = Number(process.env["FAKE_PORT"] ?? 8081);
let mode = process.env["FAKE_MODE"] ?? "alarm";
// `alarm`   -> door open past threshold (must call)
// `open`    -> door open, under threshold (must NOT call)
// `closed`  -> door closed (must NOT call)
// `offline` -> refuse every request, as if the board dropped off the wifi
// `flicker` -> alarm, then closed, then alarm (must call TWICE, distinct episodes)
const MODES = ["alarm", "open", "closed", "offline", "flicker"];

let ticks = 0;

const reading = () => {
  if (mode === "closed") return { fsr: 120, open: false, alarm: false };
  if (mode === "open") return { fsr: 2400, open: true, alarm: false };
  if (mode === "flicker") {
    ticks += 1;
    // Alternate every request so one run crosses both edges.
    return ticks % 2 === 1
      ? { fsr: 30, open: true, alarm: true }
      : { fsr: 120, open: false, alarm: false };
  }
  return { fsr: 30, open: true, alarm: true };
};

const statusText = (r) => (r.alarm ? "ALERT: Door Open > 15s!" : r.open ? "Door Open" : "Door Closed");

const server = createServer((req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);

  if (url.pathname.startsWith("/mode/")) {
    const wanted = url.pathname.slice("/mode/".length);
    if (!MODES.includes(wanted)) {
      res.writeHead(400, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: `unknown mode '${wanted}'`, modes: MODES }));
      return;
    }
    mode = wanted;
    ticks = 0;
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, mode, reading: mode === "offline" ? null : reading() }));
    console.log(`[fake] mode -> ${mode}`);
    return;
  }

  if (mode === "offline") {
    // A board that is off the network does not answer politely — the socket dies.
    req.socket.destroy();
    return;
  }

  if (url.pathname === "/data") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(reading()));
    return;
  }

  const r = reading();
  res.writeHead(200, { "content-type": "text/html" });
  res.end(
    `<!DOCTYPE html><html><head><title>ESP32 Door Monitor</title></head><body><div id='st'>${statusText(r)}</div></body></html>`,
  );
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`fake door sensor on http://127.0.0.1:${PORT}  mode=${mode}`);
  console.log(`  GET /data -> ${JSON.stringify(reading())}`);
  console.log(`  GET /mode/<${MODES.join("|")}> to switch state`);
});
