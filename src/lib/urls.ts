const TRACKING = /^(utm_[a-z]+|fbclid|gclid|dclid|msclkid|mc_cid|mc_eid|igshid|ref|ref_src|source|_hsenc|_hsmi|si)$/i;

export class UrlPolicyError extends Error {}

/** Parses a user/source URL and enforces the basic policy: public http(s), no credentials. */
export function parsePublicUrl(raw: string): URL {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    throw new UrlPolicyError("Enter a complete link that starts with https://");
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") throw new UrlPolicyError("Only http and https links are supported.");
  if (u.username || u.password) throw new UrlPolicyError("Links with embedded credentials aren't accepted.");
  if (!u.hostname.includes(".") || u.hostname.endsWith(".local") || u.hostname.endsWith(".internal") || u.hostname === "localhost") {
    throw new UrlPolicyError("That link doesn't point to a public website.");
  }
  if (u.port && !["80", "443"].includes(u.port)) throw new UrlPolicyError("Links on unusual ports aren't accepted.");
  return u;
}

/**
 * Canonical form for duplicate detection. Not a canonical identity: one URL
 * can be reused across editions, so aliases are matched with edition context.
 */
export function normalizeUrl(raw: string): string {
  const u = parsePublicUrl(raw);
  u.hash = "";
  u.hostname = u.hostname.toLowerCase().replace(/^www\./, "");
  u.protocol = "https:";
  u.port = "";
  // "/apply/" and "/apply" are treated as the same page for duplicate checks.
  u.pathname = u.pathname.replace(/\/+$/, "") || "/";
  const kept = [...u.searchParams.entries()].filter(([k]) => !TRACKING.test(k)).sort(([a], [b]) => a.localeCompare(b));
  u.search = "";
  for (const [k, v] of kept) u.searchParams.append(k, v);
  return u.toString().replace(/\/$/, "");
}

export const hostOf = (raw: string) => {
  try {
    return new URL(raw).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
};

/** Registrable-ish domain (last two labels, or three for common 2nd-level ccTLDs). */
export function siteOf(host: string): string {
  const parts = host.split(".");
  const sld = parts.at(-2) ?? "";
  if (parts.length >= 3 && ["co", "com", "org", "ac", "edu", "gov", "net"].includes(sld) && (parts.at(-1) ?? "").length === 2) {
    return parts.slice(-3).join(".");
  }
  return parts.slice(-2).join(".");
}

/** Only allow relative in-app return paths (no open redirects). */
export function safeReturnPath(p: string | null | undefined, fallback = "/home"): string {
  if (!p || !p.startsWith("/") || p.startsWith("//") || p.startsWith("/\\")) return fallback;
  return p;
}
