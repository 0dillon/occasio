import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { restrictedFetch, type FetchResult } from "@/adapters/fetch-client";
import { productRules } from "@/config/product-rules";
import { type Db, many, one, withWorker } from "@/db/tx";
import { decodeEntities, readHtml } from "@/lib/html";
import { hostOf, normalizeUrl, parsePublicUrl, siteOf } from "@/lib/urls";
import { sha256 } from "@/lib/security";
import { audit, emit } from "./audit";
import { CATEGORIES, type Category } from "./catalog";
import { planningCutoff, type DeadlineRecord } from "./deadlines";
import { publishWithoutAward } from "./exchange";
import { assess, autoDraft, autoPublishBlockers, saveSnapshot } from "./verification";
import { findDeadline, getExtractor, ruleBasedExtractor, type Extraction, type Extractor } from "@/adapters/extractor";

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
  /** Set by structured sources whose record is the official listing (e.g. Devpost). */
  structured: z.enum(["devpost", "lead"]).optional(),
  /** The blog post a lead came from (never published). */
  lead_url: z.string().max(500).optional(),
  period: z.string().max(80).optional(),
  location: z.string().max(120).optional(),
});
export type SourceCandidate = z.infer<typeof candidateSchema>;

async function loadListing(src: any, fetcher: typeof restrictedFetch): Promise<{ result: FetchResult | null; items: SourceCandidate[]; hash: string | null; fixture: boolean }> {
  if (src.adapter === "fixture") {
    // Labelled demo data shipped in the repo. No network.
    const raw = await readFile(join(process.cwd(), "fixtures", "sources", `${src.domain}.json`), "utf8");
    const items = z.array(candidateSchema).parse(JSON.parse(raw));
    return { result: null, items, hash: sha256(raw), fixture: true };
  }
  if (src.adapter === "devpost") return loadDevpost(src, fetcher);
  if (src.adapter === "wordpress_leads") return loadWordpressLeads(src, fetcher);
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
 * Devpost's public hackathon list (robots.txt allows all agents). Each
 * hackathon has its own page on Devpost, which is the organizer's official
 * listing, so the candidate URL is the page we verify. Paged JSON.
 */
const devpostItem = z.object({
  title: z.string(),
  url: z.string().url(),
  open_state: z.string().optional(),
  invite_only: z.boolean().optional(),
  organization_name: z.string().nullable().optional(),
  submission_period_dates: z.string().nullable().optional(),
  displayed_location: z.object({ location: z.string().nullable().optional() }).partial().nullable().optional(),
}).passthrough();

/**
 * Opportunity blogs (e.g. Scholarship Region) rewrite other organizations'
 * listings. A post is only a LEAD: it becomes a candidate when it names a
 * deadline and links out to what looks like the organizer's page, and that
 * page is what gets fetched and checked. The blog's own text is never published.
 */
const LEAD_SKIP_HOSTS = /(^|\.)(scholarsregion\.com|scholarshipregion\.com|intelregion\.com|devsregion\.com|scholarsworld\.ng|opportunitydesk\.org|opportunitiesforafricans\.com|scholars4dev\.com|afterschoolafrica\.com|twitter\.com|x\.com|facebook\.com|whatsapp\.com|wa\.me|t\.me|telegram\.me|linkedin\.com|instagram\.com|youtube\.com|youtu\.be|google\.com|goo\.gl|bit\.ly|amazon\.com)$/i;
const LEAD_SKIP_PATHS = /(login|signin|sign-in|account|register|\/cart|\.pdf$|\.docx?$)/i;
const LEAD_PREFER_TEXT = /(apply|official|website|application|portal|programme page|program page|how to apply)/i;

export function leadFromPost(post: { link?: string; title?: { rendered?: string }; content?: { rendered?: string } }): SourceCandidate | null {
  const html = post.content?.rendered ?? "";
  const title = decodeEntities((post.title?.rendered ?? "").replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim();
  const dl = html.match(/Deadline:\s*(?:<[^>]+>\s*)*([A-Z][a-z]+ \d{1,2}, \d{4})/);
  if (!title || !dl) return null; // listicles and guides carry no deadline
  const links: { href: string; text: string }[] = [];
  for (const m of html.matchAll(/<a\s[^>]*href="(https?:\/\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)) {
    let u: URL;
    try { u = new URL(decodeEntities(m[1]!)); } catch { continue; }
    if (LEAD_SKIP_HOSTS.test(u.hostname) || LEAD_SKIP_PATHS.test(u.pathname) || u.pathname.replace(/\/+$/, "") === "") continue;
    links.push({ href: u.toString(), text: decodeEntities(m[2]!.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim() });
  }
  const pick = links.find((l) => LEAD_PREFER_TEXT.test(l.text)) ?? links[0];
  if (!pick) return null;
  const t = title.toLowerCase();
  const category = /internship/.test(t) ? "internship" : /fellowship/.test(t) ? "fellowship" : /competition|contest|essay|challenge/.test(t) ? "competition"
    : /grant/.test(t) ? "grant" : /scholarship|studentship|bursar|fully funded|masters|phd/.test(t) ? "scholarship" : undefined;
  return {
    title: title.replace(/\s*\|\s*.*$/, "").slice(0, 200), url: pick.href, category, deadline: dl[1]!,
    structured: "lead", lead_url: post.link?.slice(0, 500),
  };
}

async function loadWordpressLeads(src: any, fetcher: typeof restrictedFetch) {
  const items: SourceCandidate[] = [];
  let first: FetchResult | null = null;
  const hashes: string[] = [];
  for (let page = 1; page <= productRules.proposed.discoveryMaxPages; page++) {
    const u = new URL(src.scope_path, src.base_url);
    u.searchParams.set("page", String(page));
    const r = await fetcher(u.toString());
    first ??= r;
    if (r.outcome !== "ok" || !r.body) {
      if (page === 1) return { result: r, items: [], hash: r.contentHash, fixture: false };
      break;
    }
    hashes.push(r.contentHash ?? "");
    let posts: any[] = [];
    try { posts = JSON.parse(r.body); } catch { break; }
    if (!Array.isArray(posts) || !posts.length) break;
    for (const p of posts) { const lead = leadFromPost(p); if (lead) items.push(lead); }
    await new Promise((res) => setTimeout(res, Math.max(1, src.min_interval_seconds) * 1000));
  }
  return { result: first, items: items.slice(0, 100), hash: sha256(hashes.join("|")), fixture: false };
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/**
 * Last day of a Devpost submission period, as shown on devpost.com:
 * "Oct 30 - Dec 04, 2026", "Nov 01 - 10, 2026", "Jul 16, 2026 - Jan 15, 2027", "Nov 08, 2026".
 * Returns YYYY-MM-DD or null when the text isn't in one of those shapes.
 */
export function devpostEndDate(period: string | null | undefined): string | null {
  if (!period) return null;
  const end = period.split(" - ").at(-1)!.trim();
  const m = end.match(/^(?:([A-Z][a-z]{2}) )?(\d{1,2}), (\d{4})$/);
  if (!m) return null;
  const month = m[1] ?? period.trim().match(/^([A-Z][a-z]{2})/)?.[1];
  const mo = month ? MONTHS.indexOf(month) : -1;
  const day = Number(m[2]);
  if (mo < 0 || day < 1 || day > 31) return null;
  return `${m[3]}-${String(mo + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

async function loadDevpost(src: any, fetcher: typeof restrictedFetch) {
  const items: SourceCandidate[] = [];
  let first: FetchResult | null = null;
  const hashes: string[] = [];
  for (let page = 1; page <= productRules.proposed.discoveryMaxPages; page++) {
    const u = new URL(src.scope_path, src.base_url);
    u.searchParams.set("page", String(page));
    const r = await fetcher(u.toString());
    first ??= r;
    if (r.outcome !== "ok" || !r.body) {
      if (page === 1) return { result: r, items: [], hash: r.contentHash, fixture: false };
      break;
    }
    hashes.push(r.contentHash ?? "");
    let list: unknown[] = [];
    try {
      const j = JSON.parse(r.body);
      list = Array.isArray(j?.hackathons) ? j.hackathons : [];
    } catch {
      break;
    }
    if (!list.length) break;
    for (const raw of list) {
      const p = devpostItem.safeParse(raw);
      if (!p.success || p.data.invite_only || (p.data.open_state && p.data.open_state !== "open")) continue;
      const end = devpostEndDate(p.data.submission_period_dates);
      items.push({
        title: p.data.title.slice(0, 200), url: p.data.url, category: "hackathon",
        organizer: /^(n\/?a|none|-+)$/i.test(p.data.organization_name?.trim() ?? "") ? undefined : p.data.organization_name?.trim().slice(0, 120) || undefined,
        deadline: end ?? undefined, structured: "devpost",
        period: p.data.submission_period_dates?.slice(0, 80) || undefined,
        location: p.data.displayed_location?.location?.slice(0, 120) || undefined,
      });
    }
    await new Promise((res) => setTimeout(res, Math.max(1, src.min_interval_seconds) * 1000));
  }
  return { result: first, items: items.slice(0, 100), hash: sha256(hashes.join("|")), fixture: false };
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

/**
 * D14: there is no review queue. Each new candidate's own page is fetched
 * through the restricted fetcher, read by the extractor and checked by the
 * same gate as shared links. Clean ones are published (they never mint
 * credits); the rest are recorded as skipped, with the reasons.
 */
export async function triageCandidates(limit = 5, fetcher = restrictedFetch, now = new Date(), extractorOverride?: Extractor) {
  const rows = await withWorker((c) => many<{ id: string; url: string; payload: any }>(c,
    `UPDATE discovery_candidates SET lease_until = now() + interval '5 minutes'
      WHERE id IN (SELECT id FROM discovery_candidates
                    WHERE state = 'pending' AND (lease_until IS NULL OR lease_until < now())
                    ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT $1)
      RETURNING id, url, payload`, [limit]));
  let published = 0;
  for (const r of rows) {
    try {
      if (await processCandidate(r, fetcher, now, extractorOverride)) published++;
    } catch (e) {
      await withWorker((c) => c.query("UPDATE discovery_candidates SET state = 'error', reason = $2, lease_until = NULL WHERE id = $1",
        [r.id, (e as Error).message.slice(0, 300)]));
    }
  }
  return { processed: rows.length, published };
}

async function existingFor(urls: string[]) {
  const norm = urls.flatMap((u) => { try { return [normalizeUrl(u)]; } catch { return []; } });
  if (!norm.length) return null;
  const r = await withWorker((c) => one<{ id: string }>(c,
    `SELECT o.id FROM url_aliases a JOIN opportunities o ON o.id = a.opportunity_id
      WHERE a.normalized_url = ANY($1) AND o.availability <> 'closed' LIMIT 1`, [norm]));
  return r?.id ?? null;
}

/** Evidence and extraction built from a Devpost list record (the platform's own data for its hosted hackathon). */
function devpostRecord(r: { url: string; payload: any }) {
  const p = r.payload;
  const body = JSON.stringify({ source: "devpost.com/api/hackathons", title: p.title, url: r.url, organization_name: p.organizer ?? null, submission_period_dates: p.period ?? null, location: p.location ?? null });
  const fetch: FetchResult = {
    outcome: "ok", requestedUrl: r.url, finalUrl: r.url, status: 200, contentType: "application/json", body,
    contentHash: sha256(body), etag: null, lastModified: null, detail: "Devpost list record (hackathon page refuses automated requests)",
  } as FetchResult;
  const online = (p.location ?? "").toLowerCase() === "online";
  const extraction = (now: Date): Extraction => {
    const date = p.deadline && /^\d{4}-\d{2}-\d{2}$/.test(p.deadline) ? p.deadline : null;
    const passed = date ? new Date(`${date}T23:59:59Z`).getTime() < now.getTime() : false;
    return {
      schema_version: "1", extractor: "devpost-record-v1",
      title: { value: String(p.title).slice(0, 200), origin: "source_page", excerpt: p.title },
      organizer: { value: (p.organizer || "Devpost").slice(0, 120), origin: "source_page" },
      category: { value: "hackathon", origin: "source_page" },
      deadline: {
        source_text: p.period ? `Submission period on Devpost: ${p.period}` : null, local_date: date, local_time: null, timezone: null,
        rolling: false, origin: date ? "source_page" : "none", excerpt: p.period ?? null,
      },
      location_mode: online ? "remote" : p.location ? "on_site" : "unknown",
      fee: { status: "unknown", text: null, excerpt: null },
      summary: [online ? "Online" : p.location, p.period ? `Submissions ${p.period}` : null].filter(Boolean).join(" · ").slice(0, 600) || null,
      conflicts: passed ? ["The deadline found appears to have passed"] : [],
      missing_information: date ? ["deadline_timezone"] : ["deadline"],
      risk_flags: [],
    };
  };
  return { fetch, extraction };
}

async function processCandidate(r: { id: string; url: string; payload: any }, fetcher: typeof restrictedFetch, now: Date, extractorOverride?: Extractor) {
  const mark = (state: string, reason: string | null, opp: string | null = null) => withWorker((c) =>
    c.query("UPDATE discovery_candidates SET state = $2, reason = $3, opportunity_id = $4, lease_until = NULL WHERE id = $1",
      [r.id, state, reason?.slice(0, 500) ?? null, opp]));
  if (r.payload?.fixture) { await mark("rejected", "Sample source; never published"); return false; }
  const early = await existingFor([r.url]);
  if (early) { await mark("duplicate", "Already on the board", early); return false; }

  let f = await fetcher(r.url);
  // Network hiccups (DNS, timeouts) and rate limits aren't verdicts on the page:
  // try again later, up to three times, instead of rejecting.
  const transient = f.outcome === "error" ||f.status === 429 || (f.status ?? 0) >= 500;
  const tries = Number(r.payload?.fetch_attempts ?? 0) + 1;
  if (transient && r.payload?.structured !== "devpost" && tries < 3) {
    await withWorker((c) => c.query(
      `UPDATE discovery_candidates SET state = 'pending', lease_until = now() + interval '30 minutes',
              payload = jsonb_set(payload, '{fetch_attempts}', to_jsonb($2::int)), reason = $3 WHERE id = $1`,
      [r.id, tries, `Retrying after: ${f.outcome}${f.status ? ` ${f.status}` : ""}${f.detail ? ` (${f.detail.slice(0, 120)})` : ""}`]));
    return false;
  }
  const page = f.outcome === "ok" && f.body && (f.contentType ?? "").includes("html") ? readHtml(f.body, f.finalUrl ?? undefined) : null;
  // Devpost refuses automated requests for hackathon pages (HTTP 403). We don't
  // get around that; its own public list record is the official listing instead.
  const fromRecord = r.payload?.structured === "devpost" && f.outcome !== "ok" ? devpostRecord(r) : null;
  if (fromRecord) f = fromRecord.fetch;
  const flags = await withWorker((c) => many<{ key: string; value: unknown }>(c, "SELECT key, value FROM app_flags"));
  const flag = (k: string) => flags.find((x) => x.key === k)?.value === true;
  const cat = (CATEGORIES as readonly string[]).includes(r.payload?.category) ? (r.payload.category as Category) : null;
  // Listing details are leads only; the extractor marks anything not on the page as a claim.
  const claims = { title: r.payload?.title ?? null, organizer: r.payload?.organizer ?? null, category: cat, deadline_text: r.payload?.deadline ?? null };
  const extractor = extractorOverride ?? await getExtractor({ aiEnabled: flag("ai_extraction_enabled") });
  let x: Extraction;
  if (fromRecord) x = fromRecord.extraction(now);
  else {
    try {
      x = await extractor.extract({ page, pageUrl: f.finalUrl, claims, hasPoster: false, now });
    } catch {
      x = await ruleBasedExtractor.extract({ page, pageUrl: f.finalUrl, claims, hasPoster: false, now });
    }
  }
  const dup = await existingFor([r.url, f.finalUrl].filter(Boolean) as string[]);

  return withWorker(async (c) => {
    const known = await one(c, "SELECT 1 FROM organizers WHERE trust = 'supported' AND $1 = ANY(domains)", [siteOf(hostOf(f.finalUrl ?? r.url))]);
    const { checks, decision } = assess(f, x, { duplicateOf: dup, knownOrganizerDomain: !!known, now });
    const set = (state: string, reason: string | null, opp: string | null = null) =>
      c.query("UPDATE discovery_candidates SET state = $2, reason = $3, opportunity_id = $4, lease_until = NULL WHERE id = $1",
        [r.id, state, reason?.slice(0, 500) ?? null, opp]);
    if (decision === "duplicate") { await set("duplicate", "Already on the board", dup); return false; }
    if (decision !== "review_required") {
      await set("rejected", checks.filter((k) => k.status === "fail").map((k) => `${k.check}: ${k.detail}`).join("; ") || decision);
      return false;
    }
    const blockers = flag("auto_publish_enabled") ? autoPublishBlockers(f, x, checks, now) : ["Auto-publish is off"];
    if (blockers.length) { await set("rejected", `Not published: ${blockers.join("; ")}`); return false; }
    const snap = await saveSnapshot(c, f, page?.title ?? null, x.deadline.excerpt ?? page?.text.slice(0, 600) ?? null);
    const draft = autoDraft({ application_url: r.url }, x, f, snap, now);
    const res = await publishWithoutAward(c, draft, "discovery", { kind: "worker" });
    await set(res.kind === "published" ? "published" : "duplicate", null, res.opportunityId);
    await audit(c, { kind: "worker" }, "discovery.auto_published", "discovery_candidate", r.id, { changes: { opportunity: res.opportunityId, extractor: x.extractor } });
    return res.kind === "published";
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
