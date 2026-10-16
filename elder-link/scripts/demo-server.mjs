// Demo server for the phone alert page.
//
// Why this exists: serving the static page and proxying the sensor through the
// SAME port means a phone only ever needs one inbound port open. Our earlier
// setup used two ports (8000 page + 8081 sensor) and Windows Firewall let the
// first through but blocked the second, so the phone could load the page but
// never read the sensor — "連唔到感應器, 失敗 48".
//
//   node scripts/demo-server.mjs            # http://<this-pc-ip>:8000
//
// Routes:
//   GET /sensor/data        -> proxied to the fake sensor's /data
//   GET /sensor/mode/<m>    -> proxied; switch the fake sensor's state
//   GET /app/...            -> proxied to the app, with the /app prefix stripped
//                               (the phone pages address the app's API this way)
//   GET /<file in public/>  -> the alert page, the call page, audio, icons
//   GET /<anything else>    -> proxied to the app
//   WS   <any>              -> forwarded to the app (Vite's HMR socket)
//
// The proxy is intentionally dumb: it only ever talks to the sensor host, never
// to a caller-supplied URL, so this cannot be turned into an open relay.
//
// Why "anything else" belongs to the app: the staff app's routes live at root
// paths (/cases, /enrol, /api/...). An earlier build mounted it under /app/ and
// stripped the prefix on the way in, so the browser's URL said /app/ while the
// client router — which matches on window.location, not on what the server was
// asked for — saw a path with no matching route and rendered "not found". The
// app was styled, loaded, and completely unusable. Forwarding the path
// unchanged is the only arrangement where the URL and the router agree.

import { createServer } from "node:http";
import { connect } from "node:net";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const PORT = Number(process.env["DEMO_PORT"] ?? 8000);
const HOST = process.env["DEMO_HOST"] ?? "0.0.0.0";
const SENSOR = process.env["SENSOR_UPSTREAM"] ?? "http://127.0.0.1:8081";
/** The app server, which owns the call-placing logic. */
const APP = process.env["APP_UPSTREAM"] ?? "http://127.0.0.1:3000";
const APP_URL = new URL(APP);
const APP_HOST = APP_URL.hostname;
const APP_PORT = Number(APP_URL.port || (APP_URL.protocol === "https:" ? 443 : 80));
/** The shared secret the alert page sends when it reports a door alarm. */
const TRIGGER_SECRET = process.env["SENSOR_TRIGGER_SECRET"] ?? "";

const PUBLIC_DIR = fileURLToPath(new URL("../public/", import.meta.url));

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".ico": "image/x-icon",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
};

/** Forward a request to the sensor and stream the reply straight back. */
async function proxy(pathname, res) {
  const target = SENSOR + pathname.replace(/^\/sensor/, "");
  try {
    const upstream = await fetch(target, { signal: AbortSignal.timeout(4000) });
    const body = await upstream.text();
    res.writeHead(upstream.status, {
      "content-type": upstream.headers.get("content-type") ?? "application/json",
      "access-control-allow-origin": "*",
      "cache-control": "no-store",
    });
    res.end(body);
  } catch (e) {
    res.writeHead(502, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "sensor unreachable", detail: e.message }));
  }
}

/**
 * Serve a file from public/.
 *
 * The alert page is served with the sensor trigger secret already filled in.
 * Without this the page ships with an empty password field and an unchecked
 * "notify the app" box, so the door alarm rings the phone but never tells the
 * app to place a call — the elder hears the siren and no one is ever called.
 * The secret is a shared credential the page already needs, and this server is
 * the only other process that has it, so injecting it here is the difference
 * between "works out of the box" and "works after fifteen minutes of typing".
 */
async function staticFile(pathname, res) {
  // normalize() collapses "..", then the prefix check keeps paths inside public/.
  const rel = normalize(decodeURIComponent(pathname)).replace(/^[/\\]+/, "");
  const file = join(PUBLIC_DIR, rel);
  if (!file.startsWith(PUBLIC_DIR)) {
    res.writeHead(403).end("forbidden");
    return;
  }
  try {
    let buf = await readFile(file);

    // Only the alert page needs the secret, and only when one is configured.
    if (file.endsWith("phone-alert.html") && TRIGGER_SECRET) {
      const html = buf.toString("utf8");
      const patched = html
        // Pre-tick the box so the alarm reaches the app by default.
        .replace(
          /<input id="notifyRunner" type="checkbox">/,
          '<input id="notifyRunner" type="checkbox" checked>',
        )
        // Fill the secret the page sends as x-sensor-secret.
        .replace(
          /(<input id="runnerSecret" type="password"[^>]*?)\s*>/,
          `$1 value="${TRIGGER_SECRET}">`,
        );
      if (patched !== html) {
        buf = Buffer.from(patched, "utf8");
        res.writeHead(200, {
          "content-type": "text/html; charset=utf-8",
          "cache-control": "no-store",
        });
        res.end(buf);
        return;
      }
    }

    res.writeHead(200, {
      "content-type": MIME[extname(file)] ?? "application/octet-stream",
      "cache-control": "no-store",
    });
    res.end(buf);
  } catch {
    res.writeHead(404, { "content-type": "text/plain" });
    res.end("not found");
  }
}

/**
 * Does this pathname correspond to a real file in public/?
 *
 * Used to decide "ours or the app's" without guessing: the phone pages and the
 * audio they play are files here, and everything else — every staff route,
 * every app asset, every API call — belongs to the app.
 */
async function staticFileExists(pathname) {
  const rel = normalize(decodeURIComponent(pathname)).replace(/^[/\\]+/, "");
  const file = join(PUBLIC_DIR, rel);
  if (!file.startsWith(PUBLIC_DIR)) return false;
  try {
    return (await stat(file)).isFile();
  } catch {
    return false;
  }
}

/**
 * Forward a request to the app server (the thing that places calls).
 *
 * A leading /app is stripped, because the phone pages address the app's API
 * that way (/app/api/sensors/door). Every other path is forwarded unchanged:
 * the app's routes and its assets are both absolute from the root, and the
 * client router matches on the browser's URL, so what the app is asked for has
 * to be what the browser is looking at.
 *
 * The query string is carried through unchanged. Vite's `?url` and `?import`
 * suffixes are part of the asset's identity — dropping them makes the app
 * return the file's contents where the browser asked for a JS module, which
 * shows up as "does not provide an export named 'default'".
 */
async function proxyApp(pathname, req, res) {
  const query = req.url.includes("?") ? "?" + req.url.split("?").slice(1).join("?") : "";
  const stripped = pathname.replace(/^\/app/, "") || "/";
  const target = APP + stripped + query;
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const body = Buffer.concat(chunks);
  try {
    const upstream = await fetch(target, {
      method: req.method,
      headers: {
        "content-type": req.headers["content-type"] ?? "application/json",
        "accept": req.headers["accept"] ?? "*/*",
        ...(req.headers["x-sensor-secret"]
          ? { "x-sensor-secret": req.headers["x-sensor-secret"] }
          : {}),
      },
      body: req.method === "GET" || req.method === "HEAD" ? undefined : body,
      signal: AbortSignal.timeout(60000), // the runner legitimately takes seconds
    });
    // Stream the bytes through unchanged. Reading as text and re-encoding
    // corrupts binary assets (fonts, images), and the app serves both.
    const buf = Buffer.from(await upstream.arrayBuffer());
    res.writeHead(upstream.status, {
      "content-type":
        upstream.headers.get("content-type") ?? "application/octet-stream",
      "access-control-allow-origin": "*",
      "cache-control": "no-store",
    });
    res.end(buf);
  } catch (e) {
    res.writeHead(502, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "app unreachable", detail: e.message }));
  }
}

const server = createServer((req, res) => {
  const { pathname } = new URL(req.url, `http://${HOST}:${PORT}`);

  // Log every inbound request with its peer address.
  //
  // This exists because "the link does not open on my phone" is ambiguous
  // between three very different faults: the phone never reached this machine
  // (network/firewall), it reached it and the page failed to render (app), or
  // it was served a cached page (stale build). The peer line tells those apart
  // at a glance — if the phone's request never appears here, the problem is
  // upstream of the app and no amount of app-side fixing will help.
  if (!pathname.startsWith("/sensor/")) {
    const peer = (req.socket.remoteAddress || "?").replace(/^::ffff:/, "");
    const stamp = new Date().toLocaleTimeString("en-GB", { hour12: false });
    console.log(`${stamp}  ${peer}  ${req.method} ${pathname}`);
  }

  // Both the sensor and the app are proxied through this one port so a phone
  // only ever needs a single inbound port open (see the header note).
  if (pathname.startsWith("/sensor/")) return void proxy(pathname, res);

  // /app and /app/... reach the app with the prefix stripped. This is what the
  // phone pages use to address the app's API (/app/api/sensors/door and
  // /app/api/speech/transcribe), and it keeps the old /app/ staff link alive.
  if (pathname === "/app" || pathname.startsWith("/app/")) {
    return void proxyApp(pathname, req, res);
  }

  // A real file in public/ is ours — the door alert page, the call screen, the
  // audio, the icons. Everything else is the app's: its routes live at root
  // paths, and "/" is its sign-in screen. The app's own assets (/src/...,
  // /@vite/client) and its API calls (/api/...) fall into this branch too,
  // which is what makes the app usable through this port at all.
  staticFileExists(pathname).then((mine) => {
    return mine ? void staticFile(pathname, res) : void proxyApp(pathname, req, res);
  });
});

// Forward WebSocket upgrades to the app.
//
// The app is served by Vite's dev server, whose hot-reload client opens a
// socket at the root of whatever origin served the page. Without this the
// socket fails against a server that has no upgrade handler, and the browser
// console fills with handshake errors on every page. This server has no
// WebSocket routes of its own, so every upgrade belongs to the app.
server.on("upgrade", (req, socket) => {
  const upstream = connect(APP_PORT, APP_HOST, () => {
    const passthrough = Object.entries(req.headers)
      .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(", ") : v}`)
      .join("\r\n");
    upstream.write(
      `${req.method} ${req.url} HTTP/1.1\r\n` +
        `Host: ${APP_HOST}:${APP_PORT}\r\n` +
        `${passthrough}\r\n\r\n`
    );
  });
  socket.pipe(upstream);
  upstream.pipe(socket);
  const kill = () => {
    try { socket.destroy(); } catch {}
    try { upstream.destroy(); } catch {}
  };
  socket.on("error", kill);
  upstream.on("error", kill);
});

server.listen(PORT, HOST, () => {
  console.log(`demo server on http://${HOST}:${PORT}`);
  console.log(`  page   -> http://<this-pc-ip>:${PORT}/phone-alert.html`);
  console.log(`  app    -> http://<this-pc-ip>:${PORT}/   (proxied to ${APP})`);
  console.log(`  sensor -> proxied at /sensor/data  (upstream ${SENSOR})`);
});
