import { restrictedFetch, type FetchResult } from "@/adapters/fetch-client";
import { getExtractor, ruleBasedExtractor, type Extraction, type Extractor } from "@/adapters/extractor";
import { type Db, many, one, withWorker } from "@/db/tx";
import { readHtml } from "@/lib/html";
import { hostOf, normalizeUrl, siteOf } from "@/lib/urls";
import { productRules, RULES_VERSION } from "@/config/product-rules";
import { audit, emit, notify } from "./audit";
import { acceptSubmission, draftSchema, rejectSubmission, type Draft } from "./exchange";

export type CheckResult = { check: string; status: "pass" | "fail" | "unknown"; detail: string };

/** Saves bounded evidence about one retrieval. */
export async function saveSnapshot(c: Db, f: FetchResult, title: string | null, excerpt: string | null) {
  const r = await one<{ id: string }>(
    c,
    `INSERT INTO evidence_snapshots(requested_url, final_url, http_status, content_type, content_hash, title, excerpt, outcome, error_detail)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
    [f.requestedUrl, f.finalUrl, f.status, f.contentType, f.contentHash, title?.slice(0, 300) ?? null, excerpt?.slice(0, 4000) ?? null, f.outcome, f.detail],
  );
  return r!.id;
}

/**
 * Deterministic publication gate (master plan §10.2). Model or rule output
 * never overrides a failed check; anything uncertain goes to a human.
 */
export function assess(f: FetchResult, x: Extraction, ctx: { duplicateOf: string | null; knownOrganizerDomain: boolean; now: Date }) {
  const checks: CheckResult[] = [];
  checks.push({
    check: "Source reachable",
    status: f.outcome === "ok" ? "pass" : f.outcome === "not_found" || f.outcome === "denied_by_policy" ? "fail" : "unknown",
    detail: f.outcome === "ok" ? `Loaded ${f.finalUrl}` : `${f.outcome.replace(/_/g, " ")}${f.detail ? `: ${f.detail}` : ""}`,
  });
  checks.push({
    check: "Not already in the bank", status: ctx.duplicateOf ? "fail" : "pass",
    detail: ctx.duplicateOf ? "A current edition with this link already exists" : "No matching link found",
  });
  checks.push({
    check: "Deadline identified",
    status: x.deadline.rolling ? "pass" : x.deadline.local_date ? "pass" : "unknown",
    detail: x.deadline.rolling ? "Rolling applications" : x.deadline.source_text ? `Found "${x.deadline.source_text}" (${x.deadline.origin.replace("_", " ")})` : "No deadline found",
  });
  checks.push({
    check: "Deadline timezone", status: x.deadline.timezone ? "pass" : "unknown",
    detail: x.deadline.timezone ?? "The organizer hasn't specified a timezone",
  });
  const closed = x.conflicts.some((c) => c.includes("passed"));
  checks.push({ check: "Still open", status: closed ? "fail" : x.deadline.local_date || x.deadline.rolling ? "pass" : "unknown", detail: closed ? "The deadline found appears to have passed" : "No sign it has closed" });
  checks.push({ check: "Organizer identity", status: ctx.knownOrganizerDomain ? "pass" : "unknown", detail: ctx.knownOrganizerDomain ? "Domain belongs to a reviewed organizer" : "New organizer domain: needs a person to review" });
  checks.push({ check: "Application fee", status: x.fee.status === "unknown" ? "unknown" : "pass", detail: x.fee.text ?? "Not stated" });
  checks.push({ check: "Conflicts between poster and page", status: x.conflicts.filter((c) => !c.includes("passed")).length ? "fail" : "pass", detail: x.conflicts.join("; ") || "None found" });
  checks.push({ check: "Risk signals", status: x.risk_flags.length ? "fail" : "pass", detail: x.risk_flags.join("; ") || "None found" });

  let decision: "duplicate" | "rejected_closed" | "rejected_unreachable" | "needs_information" | "review_required";
  if (ctx.duplicateOf) decision = "duplicate";
  else if (f.outcome === "not_found" || f.outcome === "denied_by_policy") decision = "rejected_unreachable";
  else if (closed && f.outcome === "ok" && x.deadline.origin === "source_page") decision = "rejected_closed";
  else if (x.missing_information.includes("deadline_year") && f.outcome !== "ok") decision = "needs_information";
  // At launch every acceptance goes through a person (new organizers, rule-based extraction).
  else decision = "review_required";
  return { checks, decision };
}

/**
 * Auto-publish gate (decision D9). A submission skips the review queue only
 * when an AI extractor read the page AND every check is clean. Anything
 * missing, conflicting, risky or near its deadline goes to a person.
 * Returns the reasons it can't auto-publish (empty = publish).
 */
export function autoPublishBlockers(f: FetchResult, x: Extraction, checks: CheckResult[], now: Date): string[] {
  const why: string[] = [];
  if (!x.extractor.startsWith("claude:") || x.extractor.includes("rule-based")) why.push("Page not read by the AI extractor");
  if (f.outcome !== "ok") why.push("Official page didn't load");
  for (const c of checks) {
    if (c.check === "Organizer identity" || c.check === "Application fee") continue; // allowed to be unknown; shown as such
    if (c.status !== "pass") why.push(`${c.check}: ${c.status}`);
  }
  if (x.deadline.origin !== "source_page" && !x.deadline.rolling) why.push("Deadline not taken from the official page");
  if (!x.deadline.rolling && !(x.deadline.local_date && x.deadline.timezone)) why.push("Deadline needs a date and timezone");
  if (x.deadline.local_date && !x.deadline.rolling) {
    const hoursLeft = (new Date(`${x.deadline.local_date}T00:00:00Z`).getTime() - now.getTime()) / 3_600_000;
    if (hoursLeft < productRules.proposed.ambiguousDeadlineExclusionHours) why.push("Deadline is too close to publish without a person");
  }
  if (!x.title.value || x.title.origin !== "source_page") why.push("Title not confirmed on the page");
  if (!x.organizer.value) why.push("Organizer not identified");
  if (!x.category.value) why.push("Category not identified");
  if (x.missing_information.length) why.push(`Missing: ${x.missing_information.join(", ")}`);
  return why;
}

/** Canonical draft for an auto-published submission. Eligibility stays unconfirmed (browse-only, not redeemable). */
function autoDraft(sub: any, x: Extraction, f: FetchResult, snapshotId: string, now: Date): Draft {
  return draftSchema.parse({
    title: x.title.value, organizer: x.organizer.value, programme: x.title.value,
    editionKey: (x.deadline.local_date ?? now.toISOString()).slice(0, 4),
    category: x.category.value, summary: x.summary, applicationUrl: f.finalUrl ?? sub.application_url,
    officialUrl: f.finalUrl ?? null, locationMode: x.location_mode, fee: x.fee.status, feeText: x.fee.text,
    availability: x.deadline.rolling ? "rolling" : "open",
    deadline: { sourceText: x.deadline.source_text ?? "Rolling", date: x.deadline.local_date, time: x.deadline.local_time, timezone: x.deadline.timezone, rolling: x.deadline.rolling },
    eligibilityComplete: false, evidenceSnapshotId: snapshotId, sourceCheckedAt: now,
  });
}

async function findDuplicate(c: Db, urls: string[]) {
  const norm = urls.flatMap((u) => { try { return [normalizeUrl(u)]; } catch { return []; } });
  if (!norm.length) return null;
  const r = await one<{ id: string }>(
    c,
    `SELECT o.id FROM url_aliases a JOIN opportunities o ON o.id = a.opportunity_id
      WHERE a.normalized_url = ANY($1) AND a.valid_to IS NULL
        AND o.publication IN ('published','review_required') AND o.availability <> 'closed' LIMIT 1`,
    [norm],
  );
  return r?.id ?? null;
}

/**
 * Worker step: claim one queued submission (lease + SKIP LOCKED), fetch the
 * source through the restricted fetcher, extract, assess, and record. The
 * network call happens OUTSIDE any database transaction.
 */
export async function processNextSubmission(fetcher = restrictedFetch, now = new Date(), extractorOverride?: Extractor): Promise<string | null> {
  const claimed = await withWorker((c) =>
    one<{ id: string }>(
      c,
      `UPDATE submissions SET status = 'fetching', attempts = attempts + 1, lease_until = now() + interval '5 minutes'
        WHERE id = (SELECT id FROM submissions
                     WHERE status IN ('received','queued') OR (status IN ('fetching','extracting','validating') AND lease_until < now())
                     ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1)
        RETURNING id`,
    ),
  );
  if (!claimed) return null;
  const id = claimed.id;
  const sub = await withWorker((c) => one(c, "SELECT * FROM submissions WHERE id = $1", [id]));
  if (sub.attempts > 4) {
    await withWorker((c) => c.query("UPDATE submissions SET status = 'review_required', status_reason = 'Automatic checks failed repeatedly; a person will review it.', lease_until = NULL WHERE id = $1", [id]));
    return id;
  }
  const f = await fetcher(sub.application_url);
  const page = f.outcome === "ok" && f.body && (f.contentType ?? "").includes("html") ? readHtml(f.body, f.finalUrl ?? undefined) : null;
  const flags = await withWorker((c) => many<{ key: string; value: unknown }>(c, "SELECT key, value FROM app_flags"));
  const flag = (k: string) => flags.find((r) => r.key === k)?.value === true;
  const extractor = extractorOverride ?? await getExtractor({ aiEnabled: flag("ai_extraction_enabled") });
  let x: Extraction;
  try {
    x = await extractor.extract({ page, pageUrl: f.finalUrl, claims: sub.claimed, hasPoster: false, now });
  } catch (e) {
    // Provider outage or error: fall back to rule-based; the gate then routes it to a person.
    console.error(`[verify] ${extractor.name} failed: ${(e as Error).message}`);
    x = await ruleBasedExtractor.extract({ page, pageUrl: f.finalUrl, claims: sub.claimed, hasPoster: false, now });
  }

  await withWorker(async (c) => {
    const snap = await saveSnapshot(c, f, page?.title ?? null, x.deadline.excerpt ?? page?.text.slice(0, 600) ?? null);
    const dup = await findDuplicate(c, [sub.application_url, f.finalUrl].filter(Boolean) as string[]);
    const host = hostOf(f.finalUrl ?? sub.application_url);
    const known = await one(c, "SELECT 1 FROM organizers WHERE trust = 'supported' AND $1 = ANY(domains)", [siteOf(host)]);
    const { checks, decision } = assess(f, x, { duplicateOf: dup, knownOrganizerDomain: !!known, now });
    const blockers = decision !== "review_required" ? [] : flag("auto_publish_enabled") ? autoPublishBlockers(f, x, checks, now) : ["Auto-publish is off"];
    if (decision === "review_required") {
      checks.push({ check: "Auto-publish", status: blockers.length ? "unknown" : "pass", detail: blockers.join("; ") || "All checks clean" });
    }
    await c.query(
      "INSERT INTO verification_runs(submission_id, ruleset_version, extractor, checks, decision) VALUES ($1,$2,$3,$4,$5)",
      [id, RULES_VERSION, x.extractor, JSON.stringify(checks), decision],
    );
    for (const [path, value, excerpt] of [
      ["title", x.title.value, x.title.excerpt], ["deadline", x.deadline, x.deadline.excerpt], ["fee", x.fee, x.fee.excerpt],
    ] as const) {
      await c.query(
        "INSERT INTO field_evidence(submission_id, field_path, value, origin, snapshot_id, excerpt) VALUES ($1,$2,$3,$4,$5,$6)",
        [id, path, JSON.stringify(value), path === "title" ? x.title.origin === "user_claim" ? "user_claim" : "source_page" : "source_page", snap, excerpt?.slice(0, 600) ?? null],
      );
    }
    await c.query("UPDATE submissions SET candidate = $2, lease_until = NULL WHERE id = $1", [id, JSON.stringify({ extraction: x, snapshotId: snap })]);
    const actor = { kind: "worker" as const };
    if (decision === "duplicate") {
      await c.query("UPDATE submissions SET status = 'duplicate', opportunity_id = $2, resolved_at = now(), status_reason = 'This opportunity is already in the bank, so it doesn''t earn another credit.' WHERE id = $1", [id, dup]);
      await emit(c, "submission.resolved.v1", id, { status: "duplicate" });
      await notify(c, sub.user_id, { kind: "submission_duplicate", title: "Already shared", body: "This one is already in the bank. Thanks for passing it on.", link: `/submissions/${id}`, dedupeKey: `sub-resolved:${id}` });
    } else if (decision === "rejected_closed") {
      await c.query("UPDATE submissions SET status = 'review_required' WHERE id = $1", [id]);
      await rejectSubmission(c, id, "The official page shows this deadline has passed. We kept the evidence in case it was extended.", actor);
    } else if (decision === "rejected_unreachable") {
      await c.query("UPDATE submissions SET status = 'review_required' WHERE id = $1", [id]);
      await rejectSubmission(c, id, "We couldn't load the application link (it may be removed or private). Check the link and share it again.", actor, "needs_information", ["working_link"]);
    } else if (decision === "needs_information") {
      await c.query("UPDATE submissions SET status = 'review_required' WHERE id = $1", [id]);
      await rejectSubmission(c, id, "We need the deadline year. Add the full date from the poster or official page.", actor, "needs_information", x.missing_information);
    } else {
      await c.query("UPDATE submissions SET status = 'review_required', status_reason = 'A person is checking the source and details.' WHERE id = $1", [id]);
      let draft: Draft | null = null;
      if (!blockers.length) {
        try { draft = autoDraft(sub, x, f, snap, now); } catch (e) { console.error(`[verify] auto-publish draft invalid for ${id}: ${(e as Error).message.slice(0, 200)}`); }
      }
      if (draft) {
        const r = await acceptSubmission(c, id, draft, actor);
        await audit(c, actor, "submission.auto_published", "submission", id, { changes: { opportunity: r.opportunityId, kind: r.kind } });
      }
    }
    await audit(c, actor, "submission.verified", "submission", id, { changes: { decision } });
  });
  return id;
}
