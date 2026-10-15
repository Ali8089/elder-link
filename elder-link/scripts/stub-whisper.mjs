/**
 * Throwaway Whisper stand-in.
 *
 * Proves the /api/speech/transcribe POST path end to end — multipart parsing,
 * size/empty guards, upstream forward, response mapping — without needing a
 * real API key. It returns a fixed Cantonese answer so the classification path
 * downstream can also be exercised.
 */
import { createServer } from "node:http";

let lastSeen = null;

createServer((req, res) => {
  if (req.method !== "POST") {
    res.writeHead(405).end();
    return;
  }
  const chunks = [];
  req.on("data", (c) => chunks.push(c));
  req.on("end", () => {
    const body = Buffer.concat(chunks);
    const text = body.toString("latin1");
    // Record what the route actually forwarded, so the test can assert on it.
    lastSeen = {
      bytes: body.length,
      contentType: req.headers["content-type"] ?? "",
      hasAuth: Boolean(req.headers["authorization"]),
      hasModel: /name="model"/.test(text),
      hasLanguage: /name="language"/.test(text),
      hasPrompt: /name="prompt"/.test(text),
      hasFile: /name="file"/.test(text),
      filename: (text.match(/filename="([^"]+)"/) || [])[1] ?? null,
      language: (text.match(/name="language"\r?\n\r?\n([^\r\n]+)/) || [])[1] ?? null,
      model: (text.match(/name="model"\r?\n\r?\n([^\r\n]+)/) || [])[1] ?? null,
    };
    console.log("STUB received:", JSON.stringify(lastSeen));
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ text: "我幾好，冇事" }));
  });
}).listen(5599, "127.0.0.1", () => console.log("stub whisper listening on 5599"));
