import type { FetchResult } from "../../fetcher/safe-fetch";

export type { FetchResult };

/**
 * Trusted-side client of the restricted fetcher. Workers never fetch
 * untrusted URLs themselves; they ask the fetcher service.
 */
export async function restrictedFetch(url: string, cond: { etag?: string | null; lastModified?: string | null } = {}): Promise<FetchResult> {
  const base = process.env.FETCHER_URL;
  const token = process.env.FETCHER_TOKEN;
  const fail = (detail: string): FetchResult => ({
    outcome: "error", requestedUrl: url, finalUrl: null, status: null, contentType: null, body: null,
    contentHash: null, etag: null, lastModified: null, detail,
  });
  if (!base || !token) return fail("fetcher not configured");
  try {
    const r = await fetch(`${base}/fetch`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ url, etag: cond.etag ?? undefined, lastModified: cond.lastModified ?? undefined }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!r.ok) return fail(`fetcher HTTP ${r.status}`);
    return (await r.json()) as FetchResult;
  } catch (e) {
    return fail(`fetcher unreachable: ${(e as Error).message}`);
  }
}
