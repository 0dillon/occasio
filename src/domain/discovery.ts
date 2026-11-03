import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { restrictedFetch, type FetchResult } from "@/adapters/fetch-client";
import { productRules } from "@/config/product-rules";
import { type Db, many, one, withWorker } from "@/db/tx";
import { readHtml } from "@/lib/html";
import { normalizeUrl, parsePublicUrl } from "@/lib/urls";
import { sha256 } from "@/lib/security";
import { audit, emit } from "./audit";
import { planningCutoff, type DeadlineRecord } from "./deadlines";
import { saveSnapshot } from "./verification";
import { findDeadline } from "@/adapters/extractor";

export const sourceInput = z.object({
  name: z.string().trim().min(2).max(120),
  baseUrl: z.string().url(),
  adapter: z.enum(["json_feed", "html_listing"]),
  scopePath: z.string().trim().startsWith("/").max(200).default("/"),
  accessReview: z.string().trim().min(20, "Record the terms/robots/access review (20+ characters).").max(2000),
  minIntervalSeconds: z.coerce.number().int().min(5).max(3600).default(5),
  dailyFetchBudget: z.coerce.number().int().min(1).max(1000).default(50),
  crawlEveryMinutes: z.coerce.number().int().min(60).max(10080).default(720),
});

/** A candidate as a source adapter describes it. Third-party listings are leads, not proof. */
const candidateSchema = z.object({
  title: z.string().min(3).max(200),
  url: z.string().url(),
  organizer: z.string().max(120).optional(),
  category: z.string().max(40).optional(),
  deadline: z.string().max(40).optional(),
  timezone: z.string().max(60).optional(),
  summary: z.string().max(600).optional(),
});
export type SourceCandidate = z.infer<typeof candidateSchema>;

async function loadListing(src: any, fetcher: typeof restrictedFetch): Promise<{ result: FetchResult | null; items: SourceCandidate[]; hash: string | null; fixture: boolean }> {
  if (src.adapter === "fixture") {
    // Labelled demo data shipped in the repo. No network.
    const raw = await readFile(join(process.cwd(), "fixtures", "sources", `${src.domain}.json`), "utf8");
    const items = z.array(candidateSchema).parse(JSON.parse(raw));
    return { result: null, items, hash: sha256(raw), fixture: true };
  }
  const r = await fetcher(new URL(src.scope_path, src.base_url).toString(), { etag: src.last_etag, lastModified: src.last_modified });
  if (r.outcome !== "ok" || r.notModified || !r.body) return { result: r, items: [], hash: r.contentHash, fixture: false };
  let items: SourceCandidate[] = [];
  if (src.adapter === "json_feed") {
    try {
      const j = JSON.parse(r.body);
      const arr = Array.isArray(j) ? j : Array.isArray(j.items) ? j.items : [];
      items = arr.flatMap((x: unknown) => {
        const p = candidateSchema.safeParse(x);
        return p.success ? [p.data] : [];
      });
    } catch {
      items = [];
    }
  } else {
    const page = readHtml(r.body, r.finalUrl ?? undefined);
    const scopeHost = new URL(src.base_url).hostname;
    items = page.links
      .filter((l) => { try { const u = new URL(l.href); return u.hostname === scopeHost && u.pathname.startsWith(src.scope_path) && l.text.length >= 8; } catch { return false; } })
      .slice(0, 40)
      .map((l) => ({ title: l.text.slice(0, 200), url: l.href }));
  }
  return { result: r, items: items.slice(0, 100), hash: r.contentHash, fixture: false };
}

/**
 * Crawls due, approved, enabled sources within their budgets. Candidates are
 * stored for the same review/publication gate as user contributions and never
 * mint credits.
 */
export async function crawlDueSources(fetcher = restrictedFetch, now = new Date()) {
  const flag = await withWorker((c) => one<{ value: boolean }>(c, "SELECT value FROM app_flags WHERE key = 'discovery_enabled'"));
  if (flag?.value === false) return { sources: 0, candidates: 0, stopped: true };
  const due = await withWorker((c) =>
    many(c, `SELECT * FROM source_registry WHERE enabled AND approved_at IS NOT NULL AND (next_crawl_at IS NULL OR next_crawl_at <= $1) ORDER BY next_crawl_at NULLS FIRST LIMIT 5`, [now]),
  );
  let total = 0;
  for (const src of due) {
    const used = await withWorker((c) => one<{ n: number }>(c, "SELECT count(*)::int AS n FROM crawl_runs WHERE source_id = $1 AND started_at > now() - interval '1 day'", [src.id]));
    const run = await withWorker((c) => one<{ id: string }>(c, "INSERT INTO crawl_runs(source_id) VALUES ($1) RETURNING id", [src.id]));
    if ((used?.n ?? 0) >= src.daily_fetch_budget) {
      await withWorker((c) => c.query("UPDATE crawl_runs SET finished_at = now(), result = 'budget_exhausted' WHERE id = $1", [run!.id]));
      continue;
    }
    let result: string;
    let candidates = 0;
    let detail: string | null = null;
    try {
      const listing = await loadListing(src, fetcher);
      if (listing.result && listing.result.outcome === "blocked") { result = "blocked"; detail = listing.result.detail; }
      else if (listing.result && listing.result.outcome !== "ok") { result = "error"; detail = `${listing.result.outcome}: ${listing.result.detail ?? ""}`; }
      else if (listing.result?.notModified) result = "unchanged";
      else {
        result = "changed";
        await withWorker(async (c) => {
          for (const item of listing.items) {
            let key: string;
            try { key = normalizeUrl(item.url); } catch { if (!listing.fixture) continue; key = item.url; }
            const ins = await c.query(
              `INSERT INTO discovery_candidates(source_id, dedupe_key, url, payload) VALUES ($1,$2,$3,$4) ON CONFLICT (dedupe_key) DO NOTHING`,
              [src.id, `${key}#${item.deadline ?? ""}`, item.url, JSON.stringify({ ...item, fixture: listing.fixture })],
            );
            candidates += ins.rowCount ?? 0;
          }
        });
      }
      await withWorker((c) => c.query(
        `UPDATE source_registry SET last_crawl_at = now(), next_crawl_at = now() + make_interval(mins => crawl_every_minutes),
                last_etag = coalesce($2, last_etag), last_modified = coalesce($3, last_modified) WHERE id = $1`,
        [src.id, listing.result?.etag ?? null, listing.result?.lastModified ?? null],
      ));
      await withWorker((c) => c.query("UPDATE crawl_runs SET finished_at = now(), result = $2, http_status = $3, content_hash = $4, candidates = $5, detail = $6 WHERE id = $1",
        [run!.id, result, listing.result?.status ?? null, listing.hash, candidates, detail]));
    } catch (e) {
      await withWorker((c) => c.query("UPDATE crawl_runs SET finished_at = now(), result = 'error', detail = $2 WHERE id = $1", [run!.id, (e as Error).message.slice(0, 300)]));
      await withWorker((c) => c.query("UPDATE source_registry SET next_crawl_at = now() + interval '1 hour' WHERE id = $1", [src.id]));
    }
    total += candidates;
  }
  return { sources: due.length, candidates: total, stopped: false };
}

/** Moves new candidates into review (the same human gate as contributions). */
export async function triageCandidates(limit = 20) {
  return withWorker(async (c) => {
    const rows = await many(c, `SELECT id, url FROM discovery_candidates WHERE state = 'pending' ORDER BY created_at LIMIT $1 FOR UPDATE SKIP LOCKED`, [limit]);
    for (const r of rows) {
      let dup: { id: string } | undefined;
      try {
        dup = await one(c, `SELECT o.id FROM url_aliases a JOIN opportunities o ON o.id = a.opportunity_id
                             WHERE a.normalized_url = $1 AND o.availability <> 'closed' LIMIT 1`, [normalizeUrl(r.url)]);
      } catch { /* fixture URL */ }
      if (dup) await c.query("UPDATE discovery_candidates SET state = 'duplicate', opportunity_id = $2, reason = 'Already in the bank' WHERE id = $1", [r.id, dup.id]);
      else await c.query("UPDATE discovery_candidates SET state = 'review_required' WHERE id = $1", [r.id]);
    }
    return rows.length;
  });
}

function nextCheckHours(d: DeadlineRecord | null, availability: string, now: Date) {
  const h = productRules.proposed.recheckHours;
  if (availability === "rolling" || !d || d.precision === "rolling" || d.precision === "unknown") return h.rolling;
  const cut = planningCutoff(d);
  if (!cut) return h.rolling;
  const left = (cut.at.getTime() - now.getTime()) / 3_600_000;
  if (left < 48) return h.closing;
  if (left < 14 * 24) return h.near;
  return h.farOpen;
}

/**
 * Freshness rechecks for published records. Unchanged content (same hash or
 * 304) is a successful check without any extraction cost. Repeated failures
 * back off and mark the record stale — never automatically "expired".
 * Deterministic closure (recorded deadline passed) closes the record.
 */
export async function recheckDue(fetcher = restrictedFetch, now = new Date(), limit = 10) {
  const due = await withWorker((c) =>
    many(c, `SELECT o.id, o.application_url, o.official_url, o.availability, o.is_fixture, o.revision, o.consecutive_check_failures,
                    (SELECT row_to_json(d) FROM opportunity_deadlines d WHERE d.opportunity_id = o.id AND d.is_current AND d.kind = 'application') AS deadline,
                    (SELECT e.content_hash FROM opportunity_sources s JOIN evidence_snapshots e ON e.id = s.latest_evidence_id
                      WHERE s.opportunity_id = o.id ORDER BY (s.role = 'official') DESC LIMIT 1) AS last_hash
               FROM opportunities o
              WHERE o.publication = 'published' AND o.availability <> 'closed' AND (o.next_check_at IS NULL OR o.next_check_at <= $1)
              ORDER BY o.next_check_at NULLS FIRST LIMIT $2`, [now, limit]),
  );
  const summary = { checked: 0, unchanged: 0, changed: 0, failed: 0, closed: 0 };
  for (const o of due) {
    summary.checked++;
    const cut = o.deadline ? planningCutoff(o.deadline) : null;
    if (cut && cut.at.getTime() <= now.getTime()) {
      await withWorker(async (c) => {
        await c.query("UPDATE opportunities SET availability = 'closed', revision = revision + 1, next_check_at = NULL WHERE id = $1", [o.id]);
        await emit(c, "opportunity.changed.v1", o.id, { change: "closed_by_deadline" }, o.revision + 1);
        await audit(c, { kind: "worker" }, "opportunity.closed", "opportunity", o.id, { reason: "Recorded deadline passed" });
      });
      summary.closed++;
      continue;
    }
    const hours = nextCheckHours(o.deadline, o.availability, now);
    if (o.is_fixture) {
      // Fixture records are demo data; their "check" is labelled as such.
      await withWorker((c) => c.query("UPDATE opportunities SET last_successful_check_at = $2, availability_checked_at = $2, next_check_at = $2::timestamptz + make_interval(hours => $3) WHERE id = $1", [o.id, now, hours]));
      summary.unchanged++;
      continue;
    }
    const url = o.official_url ?? o.application_url;
    const f = await fetcher(url);
    await withWorker(async (c) => {
      if (f.outcome === "ok") {
        const page = f.body ? readHtml(f.body, f.finalUrl ?? undefined) : null;
        const snap = await saveSnapshot(c, f, page?.title ?? null, page?.text.slice(0, 600) ?? null);
        await c.query("UPDATE opportunity_sources SET latest_evidence_id = $2 WHERE opportunity_id = $1 AND url = $3", [o.id, snap, url]);
        const changed = !f.notModified && f.contentHash !== o.last_hash;
        await c.query(
          `UPDATE opportunities SET last_successful_check_at = $2, availability_checked_at = $2, consecutive_check_failures = 0,
                  next_check_at = $2::timestamptz + make_interval(hours => $3) WHERE id = $1`, [o.id, now, hours]);
        if (changed && page) {
          summary.changed++;
          const found = findDeadline(page.text);
          const current = o.deadline as DeadlineRecord | null;
          if (found?.date && current?.source_local_date && found.date !== current.source_local_date) {
            // Possible deadline change: a person confirms before facts change.
            await c.query(
              `INSERT INTO reports(opportunity_id, reason, detail) VALUES ($1,'wrong_deadline',$2)`,
              [o.id, `Automatic recheck: the source now shows "${found.text}" (recorded: ${current.source_text}). Confirm and correct if the organizer changed it.`],
            );
          }
        } else summary.unchanged++;
      } else {
        summary.failed++;
        const fails = o.consecutive_check_failures + 1;
        const backoff = Math.min(productRules.proposed.recheckHours.maxBackoff, 2 ** fails);
        await c.query(
          `UPDATE opportunities SET consecutive_check_failures = $2, availability_checked_at = $3, next_check_at = $3::timestamptz + make_interval(hours => $4) WHERE id = $1`,
          [o.id, fails, now, backoff],
        );
        if (f.outcome === "not_found") {
          await c.query(`INSERT INTO reports(opportunity_id, reason, detail) VALUES ($1,'broken_link',$2)`, [o.id, `Automatic recheck: ${url} returned ${f.detail ?? "not found"}.`]);
        }
      }
    });
  }
  return summary;
}

export async function createSource(c: Db, actorId: string, raw: z.input<typeof sourceInput>) {
  const s = sourceInput.parse(raw);
  const u = parsePublicUrl(s.baseUrl);
  const r = await one<{ id: string }>(
    c,
    `INSERT INTO source_registry(name, base_url, domain, adapter, scope_path, access_review, min_interval_seconds, daily_fetch_budget, crawl_every_minutes)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
    [s.name, u.origin, u.hostname, s.adapter, s.scopePath, s.accessReview, s.minIntervalSeconds, s.dailyFetchBudget, s.crawlEveryMinutes],
  );
  await audit(c, { kind: "staff", id: actorId }, "source.created", "source", r!.id, { changes: s });
  return r!.id;
}

export async function setSourceState(c: Db, actorId: string, id: string, action: "approve" | "enable" | "stop", reason: string) {
  if (action === "approve") await c.query("UPDATE source_registry SET approved_by = $2, approved_at = now() WHERE id = $1", [id, actorId]);
  if (action === "enable") await c.query("UPDATE source_registry SET enabled = true, next_crawl_at = now() WHERE id = $1 AND approved_at IS NOT NULL", [id]);
  if (action === "stop") await c.query("UPDATE source_registry SET enabled = false WHERE id = $1", [id]);
  await audit(c, { kind: "staff", id: actorId }, `source.${action}`, "source", id, { reason });
}
