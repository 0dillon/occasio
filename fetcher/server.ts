import { timingSafeEqual } from "node:crypto";
import http from "node:http";
import { safeFetch } from "./safe-fetch";

/**
 * Restricted fetch service. Runs as its own process/container with no
 * database credentials and no product secrets except its inbound token.
 * Deploy it on a network segment without routes to internal services or
 * cloud metadata; the in-process checks are a second layer, not the only one.
 */
const token = process.env.FETCHER_TOKEN ?? "";
const port = Number(process.env.FETCHER_PORT ?? 4100);
if (token.length < 24) throw new Error("FETCHER_TOKEN (24+ chars) is required");

function authorized(h: string | undefined) {
  const given = Buffer.from(h?.replace(/^Bearer /, "") ?? "");
  const want = Buffer.from(token);
  return given.length === want.length && timingSafeEqual(given, want);
}

let inFlight = 0;
const server = http.createServer(async (req, res) => {
  if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ ok: true, inFlight }));
    return;
  }
  if (req.method !== "POST" || req.url !== "/fetch" || !authorized(req.headers.authorization)) {
    res.writeHead(404).end();
    return;
  }
  if (inFlight >= 8) {
    res.writeHead(429, { "retry-after": "5" }).end();
    return;
  }
  let raw = "";
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 8192) {
      res.writeHead(413).end();
      return;
    }
  }
  inFlight++;
  try {
    const { url, etag, lastModified } = JSON.parse(raw) as { url: string; etag?: string; lastModified?: string };
    const result = await safeFetch(String(url), { etag, lastModified });
    // Bound what we return to callers.
    if (result.body && result.body.length > 600_000) result.body = result.body.slice(0, 600_000);
    res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(result));
  } catch {
    res.writeHead(400).end();
  } finally {
    inFlight--;
  }
});
server.listen(port, "127.0.0.1", () => console.log(`fetcher listening on 127.0.0.1:${port}`));
process.on("SIGTERM", () => server.close(() => process.exit(0)));
