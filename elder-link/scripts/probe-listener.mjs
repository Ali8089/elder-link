// A deliberately tiny logger: it answers every request with a plain "OK" and
// prints who called. Its only job is to prove whether the phone's traffic
// reaches this machine at all, which separates a network problem from an
// app/cache problem.
import { createServer } from "node:http";

const PORT = Number(process.env.PROBE_PORT ?? 8899);
const server = createServer((req, res) => {
  const peer = req.socket.remoteAddress;
  const stamp = new Date().toLocaleTimeString("en-GB", { hour12: false });
  console.log(`${stamp}  ${peer}  ${req.method} ${req.url}  ua=${(req.headers["user-agent"] || "").slice(0, 60)}`);
  res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
  res.end(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1">
    <body style="font:20px system-ui;padding:2rem;background:#0b1220;color:#e8eef8">
    <h1>✅ 連到咗！</h1><p>Your phone reached this PC. Peer: <code>${peer}</code></p></body>`);
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`probe listener on http://0.0.0.0:${PORT}  -> open http://<pc-ip>:${PORT}/ from the phone`);
});
