/**
 * Minimal, dependency-free reading of untrusted HTML. Output is plain text and
 * data; nothing here is rendered as HTML or treated as instructions.
 */
const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ndash: "–", mdash: "—", rsquo: "’", lsquo: "‘", hellip: "…" };

export function decodeEntities(s: string) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const n = e[1]?.toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n < 0x10ffff ? String.fromCodePoint(n) : "";
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

export type PageData = {
  title: string | null;
  meta: Record<string, string>;
  jsonld: unknown[];
  text: string;
  links: { href: string; text: string }[];
};

export function readHtml(html: string, baseUrl?: string): PageData {
  const src = html.slice(0, 1_500_000);
  const meta: Record<string, string> = {};
  for (const m of src.matchAll(/<meta\s+[^>]*>/gi)) {
    const tag = m[0];
    const key = tag.match(/\b(?:property|name)\s*=\s*["']([^"']+)["']/i)?.[1]?.toLowerCase();
    const content = tag.match(/\bcontent\s*=\s*["']([^"']*)["']/i)?.[1];
    if (key && content !== undefined && !(key in meta)) meta[key] = decodeEntities(content).trim().slice(0, 500);
  }
  const jsonld: unknown[] = [];
  for (const m of src.matchAll(/<script[^>]+type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const v = JSON.parse(m[1]!);
      jsonld.push(...(Array.isArray(v) ? v : [v]));
    } catch {
      /* ignore malformed */
    }
  }
  const title = decodeEntities(src.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "").replace(/\s+/g, " ").trim() || null;
  const links: PageData["links"] = [];
  for (const m of src.matchAll(/<a\s[^>]*href\s*=\s*["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    try {
      const href = new URL(decodeEntities(m[1]!), baseUrl).toString();
      if (/^https?:/.test(href)) links.push({ href, text: decodeEntities(m[2]!.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim().slice(0, 200) });
    } catch {
      /* skip */
    }
    if (links.length > 500) break;
  }
  const text = decodeEntities(
    src
      .replace(/<(script|style|noscript|svg|template)[\s\S]*?<\/\1>/gi, " ")
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/tr|\/section)[^>]*>/gi, "\n")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/[ \t\f\r]+/g, " ")
    .replace(/\n\s*\n+/g, "\n")
    .trim()
    .slice(0, 200_000);
  return { title, meta, jsonld, text, links };
}

/** A short, bounded excerpt around a match for evidence display. */
export function excerptAround(text: string, index: number, radius = 160) {
  const start = Math.max(0, index - radius);
  return (start > 0 ? "…" : "") + text.slice(start, index + radius).replace(/\s+/g, " ").trim() + (index + radius < text.length ? "…" : "");
}
