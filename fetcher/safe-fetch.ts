import { createHash } from "node:crypto";
import { lookup } from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import net from "node:net";

/**
 * Restricted HTTP retrieval for untrusted URLs (OWASP SSRF guidance):
 *  - http(s) only, ports 80/443, no credentials in URLs
 *  - every hostname is resolved once; ALL addresses must be public
 *  - the connection is pinned to the validated address (no second DNS
 *    lookup that could be rebound), while SNI/certificate checks still use
 *    the original hostname
 *  - redirects are followed manually and each hop is re-validated
 *  - response size, time and content type are bounded
 * This module has no database access and no product secrets.
 */

export type FetchResult = {
  outcome: "ok" | "blocked" | "not_found" | "error" | "denied_by_policy" | "unsupported";
  requestedUrl: string;
  finalUrl: string | null;
  status: number | null;
  contentType: string | null;
  body: string | null;
  contentHash: string | null;
  etag: string | null;
  lastModified: string | null;
  detail: string | null;
  notModified?: boolean;
};

export class PolicyError extends Error {}

const MAX_BYTES = 2 * 1024 * 1024;
const TIMEOUT_MS = 10_000;
const MAX_REDIRECTS = 5;
const ALLOWED_TYPES = ["text/html", "application/xhtml+xml", "text/plain", "application/json", "application/ld+json", "application/feed+json"];
export const USER_AGENT = "OCCASIO-verifier/0.1 (+https://occasio.example/crawler; opportunity verification)";

function ipv4ToInt(ip: string) {
  return ip.split(".").reduce((a, o) => (a << 8) + Number(o), 0) >>> 0;
}
function inCidr4(ip: string, cidr: string) {
  const [base, bits] = cidr.split("/") as [string, string];
  const mask = Number(bits) === 0 ? 0 : (~0 << (32 - Number(bits))) >>> 0;
  return (ipv4ToInt(ip) & mask) === (ipv4ToInt(base) & mask);
}
const BLOCKED_V4 = [
  "0.0.0.0/8", "10.0.0.0/8", "100.64.0.0/10", "127.0.0.0/8", "169.254.0.0/16", "172.16.0.0/12",
  "192.0.0.0/24", "192.0.2.0/24", "192.88.99.0/24", "192.168.0.0/16", "198.18.0.0/15",
  "198.51.100.0/24", "203.0.113.0/24", "224.0.0.0/4", "240.0.0.0/4", "255.255.255.255/32",
];

/** True only for globally routable unicast addresses. */
export function isPublicAddress(ip: string): boolean {
  const v = net.isIP(ip);
  if (v === 4) return !BLOCKED_V4.some((c) => inCidr4(ip, c));
  if (v === 6) {
    const a = ip.toLowerCase();
    if (a === "::" || a === "::1") return false;
    // IPv4-mapped / translated forms: judge the embedded IPv4 address.
    const mapped = a.match(/^(?:::ffff:|::ffff:0:|64:ff9b::)(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPublicAddress(mapped[1]!);
    if (/^::ffff:/.test(a)) return false;
    const first = parseInt(a.split(":")[0] || "0", 16);
    if ((first & 0xfe00) === 0xfc00) return false; // fc00::/7 unique local
    if ((first & 0xffc0) === 0xfe80) return false; // fe80::/10 link-local
    if ((first & 0xffc0) === 0xfec0) return false; // fec0::/10 site-local (deprecated)
    if ((first & 0xff00) === 0xff00) return false; // multicast
    if (a.startsWith("2001:db8") || a.startsWith("2001:0db8")) return false; // documentation
    if (a.startsWith("64:ff9b:") || a.startsWith("100::")) return false;
    if (a.startsWith("2002:")) return false; // 6to4 can embed private v4
    return (first & 0xe000) === 0x2000; // 2000::/3 global unicast only
  }
  return false;
}

export function validateUrl(raw: string): URL {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new PolicyError("invalid URL");
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") throw new PolicyError("scheme not allowed");
  if (u.username || u.password) throw new PolicyError("credentials not allowed");
  if (u.port && !["80", "443"].includes(u.port)) throw new PolicyError("port not allowed");
  const host = u.hostname.replace(/^\[|\]$/g, "");
  if (net.isIP(host) && !isPublicAddress(host)) throw new PolicyError("address not public");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal") || !host.includes(".")) {
    throw new PolicyError("host not allowed");
  }
  return u;
}

export type Resolver = (host: string) => Promise<{ address: string; family: number }[]>;
const defaultResolver: Resolver = (host) => lookup(host, { all: true, verbatim: true });

async function resolvePublic(host: string, resolver: Resolver) {
  const bare = host.replace(/^\[|\]$/g, "");
  if (net.isIP(bare)) {
    if (!isPublicAddress(bare)) throw new PolicyError("address not public");
    return { address: bare, family: net.isIP(bare) };
  }
  const addrs = await resolver(bare);
  if (!addrs.length) throw new PolicyError("no address");
  // Reject if ANY address is private: a mixed answer is a rebinding signal.
  for (const a of addrs) if (!isPublicAddress(a.address)) throw new PolicyError("resolves to a non-public address");
  return addrs[0]!;
}

function requestOnce(u: URL, pinned: { address: string; family: number }, headers: Record<string, string>) {
  return new Promise<{ status: number; headers: http.IncomingHttpHeaders; body: Buffer | null; tooLarge: boolean }>((resolve, reject) => {
    const mod = u.protocol === "https:" ? https : http;
    const req = mod.request(
      {
        protocol: u.protocol, hostname: u.hostname, port: u.port || (u.protocol === "https:" ? 443 : 80),
        path: u.pathname + u.search, method: "GET", headers, timeout: TIMEOUT_MS,
        servername: net.isIP(u.hostname) ? undefined : u.hostname,
        // Pin the connection to the validated address.
        // Node's connect path may ask for { all: true } (autoSelectFamily) and then
        // expects an array; answering with a bare string fails as "Invalid IP address".
        lookup: (_h: string, o: { all?: boolean } | undefined, cb: (e: Error | null, a: any, f?: number) => void) =>
          o?.all ? cb(null, [{ address: pinned.address, family: pinned.family }]) : cb(null, pinned.address, pinned.family),
        agent: false,
      },
      (res) => {
        const status = res.statusCode ?? 0;
        if (status >= 300 && status < 400) {
          res.resume();
          return resolve({ status, headers: res.headers, body: null, tooLarge: false });
        }
        const chunks: Buffer[] = [];
        let size = 0;
        res.on("data", (d: Buffer) => {
          size += d.length;
          if (size > MAX_BYTES) {
            req.destroy();
            resolve({ status, headers: res.headers, body: Buffer.concat(chunks), tooLarge: true });
          } else chunks.push(d);
        });
        res.on("end", () => resolve({ status, headers: res.headers, body: Buffer.concat(chunks), tooLarge: false }));
        res.on("error", reject);
      },
    );
    const wall = setTimeout(() => req.destroy(new Error("timeout")), TIMEOUT_MS);
    req.on("close", () => clearTimeout(wall));
    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.on("error", reject);
    req.end();
  });
}

export async function safeFetch(
  rawUrl: string,
  opts: { resolver?: Resolver; etag?: string | null; lastModified?: string | null } = {},
): Promise<FetchResult> {
  const base: FetchResult = {
    outcome: "error", requestedUrl: rawUrl, finalUrl: null, status: null, contentType: null, body: null,
    contentHash: null, etag: null, lastModified: null, detail: null,
  };
  const resolver = opts.resolver ?? defaultResolver;
  let current = rawUrl;
  try {
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      const u = validateUrl(current);
      const pinned = await resolvePublic(u.hostname, resolver);
      const headers: Record<string, string> = {
        "user-agent": USER_AGENT, accept: "text/html,application/json;q=0.9,text/plain;q=0.5", "accept-encoding": "identity",
      };
      if (hop === 0 && opts.etag) headers["if-none-match"] = opts.etag;
      if (hop === 0 && opts.lastModified) headers["if-modified-since"] = opts.lastModified;
      const r = await requestOnce(u, pinned, headers);
      if (r.status >= 300 && r.status < 400 && r.status !== 304) {
        const loc = r.headers.location;
        if (!loc) return { ...base, status: r.status, outcome: "error", detail: "redirect without location" };
        current = new URL(loc, u).toString();
        continue;
      }
      const ct = String(r.headers["content-type"] ?? "").split(";")[0]!.trim().toLowerCase();
      const common = {
        ...base, finalUrl: u.toString(), status: r.status, contentType: ct || null,
        etag: (r.headers.etag as string) ?? null, lastModified: (r.headers["last-modified"] as string) ?? null,
      };
      if (r.status === 304) return { ...common, outcome: "ok", notModified: true };
      if (r.status === 401 || r.status === 403 || r.status === 429) return { ...common, outcome: "blocked", detail: `HTTP ${r.status}` };
      if (r.status === 404 || r.status === 410) return { ...common, outcome: "not_found", detail: `HTTP ${r.status}` };
      if (r.status >= 400) return { ...common, outcome: "error", detail: `HTTP ${r.status}` };
      if (!ALLOWED_TYPES.includes(ct)) return { ...common, outcome: "unsupported", detail: `content type ${ct || "missing"}` };
      const text = (r.body ?? Buffer.alloc(0)).toString("utf8");
      const looksBlocked = /captcha|are you a robot|cf-challenge|access denied/i.test(text.slice(0, 20000));
      return {
        ...common,
        outcome: looksBlocked ? "blocked" : "ok",
        body: text,
        contentHash: createHash("sha256").update(text).digest("hex"),
        detail: [r.tooLarge ? "truncated at 2 MB" : null, looksBlocked ? "challenge page detected" : null].filter(Boolean).join("; ") || null,
      };
    }
    return { ...base, outcome: "error", detail: "too many redirects" };
  } catch (e) {
    if (e instanceof PolicyError) return { ...base, outcome: "denied_by_policy", detail: e.message };
    return { ...base, outcome: "error", detail: (e as Error).message.slice(0, 200) };
  }
}
