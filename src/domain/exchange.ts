import { z } from "zod";
import { productRules } from "@/config/product-rules";
import { type Db, many, one } from "@/db/tx";
import { normalizeUrl, hostOf } from "@/lib/urls";
import { isValidTimeZone } from "@/lib/time";
import { audit, emit, notify, type Actor } from "./audit";
import { CATEGORIES } from "./catalog";
import { buildDeadline } from "./deadlines";
import { fail } from "./errors";

/* ------------------------------------------------------------------ drafts */

const ruleSchema = z.object({
  rule_type: z.enum(["residence_country", "citizenship", "education_level", "age_band", "experience_level", "other"]),
  operator: z.enum(["in", "not_in", "note"]),
  operand: z.array(z.string().max(40)).max(250).default([]),
  source_text: z.string().min(1).max(500),
  is_hard: z.boolean().default(true),
});

/** Reviewed canonical facts. Everything not confirmed stays null/unknown. */
export const draftSchema = z.object({
  title: z.string().trim().min(3).max(200),
  organizer: z.string().trim().min(2).max(120),
  programme: z.string().trim().min(2).max(160),
  editionKey: z.string().trim().min(1).max(60).regex(/^[a-z0-9-]+$/, "Use lowercase letters, numbers and dashes"),
  category: z.enum(CATEGORIES),
  summary: z.string().trim().max(600).nullable().default(null),
  description: z.string().trim().max(5000).nullable().default(null),
  tags: z.array(z.string().trim().toLowerCase().max(40)).max(12).default([]),
  officialUrl: z.string().url().nullable().default(null),
  applicationUrl: z.string().url(),
  locationMode: z.enum(["remote", "hybrid", "on_site", "unknown"]).default("unknown"),
  locationText: z.string().max(200).nullable().default(null),
  fee: z.enum(["free", "paid", "unknown"]).default("unknown"),
  feeText: z.string().max(300).nullable().default(null),
  benefitsText: z.string().max(600).nullable().default(null),
  requirements: z.array(z.string().max(200)).max(20).default([]),
  availability: z.enum(["upcoming", "open", "closed", "rolling", "unknown"]),
  deadline: z.object({
    sourceText: z.string().max(300),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
    time: z.string().regex(/^\d{2}:\d{2}$/).nullable(),
    timezone: z.string().nullable().refine((t) => t === null || isValidTimeZone(t), "Unknown IANA timezone"),
    rolling: z.boolean().default(false),
  }),
  rules: z.array(ruleSchema).max(20).default([]),
  eligibilityComplete: z.boolean().default(false),
  eligibilitySummary: z.string().max(300).nullable().default(null),
  organizerTrust: z.enum(["unassessed", "supported", "concern", "blocked"]).default("unassessed"),
  evidenceSnapshotId: z.string().uuid().nullable().default(null),
  sourceCheckedAt: z.coerce.date().nullable().default(null),
});
export type Draft = z.infer<typeof draftSchema>;

const norm = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, " ").trim();

/** Things that keep a published record out of credit redemption, in words. */
export function redemptionBlockers(d: Draft, now = new Date()): string[] {
  const b: string[] = [];
  if (!["open", "rolling"].includes(d.availability)) b.push("Availability is not confirmed as open");
  if (!d.sourceCheckedAt) b.push("No successful source check recorded");
  if (!d.eligibilityComplete) b.push("Eligibility rules not confirmed as complete");
  if (d.organizerTrust === "concern" || d.organizerTrust === "blocked") b.push("Organizer identity needs review");
  if (!d.deadline.rolling && !d.deadline.date) b.push("Deadline not confirmed");
  if (d.deadline.date) {
    const dl = buildDeadline({ sourceText: d.deadline.sourceText, date: d.deadline.date, time: d.deadline.time, timezone: d.deadline.timezone });
    const end = dl.utc_instant ?? new Date(`${d.deadline.date}T09:59:59Z`);
    if (end.getTime() < now.getTime()) b.push("Deadline has passed");
  }
  return b;
}

type PublishResult =
  | { kind: "published"; opportunityId: string; awarded: boolean }
  | { kind: "duplicate"; opportunityId: string };

/**
 * Creates the canonical edition, its deadline, rules, sources and aliases.
 * Uniqueness on (programme, edition) resolves races: if another submission or
 * the crawler created the same edition first, this returns "duplicate".
 */
async function createEdition(c: Db, draft: Draft, origin: "user_submission" | "discovery" | "operator" | "fixture", actor: Actor, isFixture = false): Promise<{ id: string } | { duplicateOf: string }> {
  const org = await one<{ id: string; trust: string }>(
    c,
    `INSERT INTO organizers(name, normalized_name, domains, trust) VALUES ($1,$2,$3,$4)
     ON CONFLICT (normalized_name) DO UPDATE SET domains = (
       SELECT array(SELECT DISTINCT unnest(organizers.domains || EXCLUDED.domains)))
     RETURNING id, trust`,
    [draft.organizer, norm(draft.organizer), [hostOf(draft.officialUrl ?? draft.applicationUrl)].filter(Boolean), draft.organizerTrust],
  );
  if (draft.organizerTrust !== "unassessed" && org!.trust !== draft.organizerTrust) {
    await c.query("UPDATE organizers SET trust = $2 WHERE id = $1", [org!.id, draft.organizerTrust]);
  }
  const prog = await one<{ id: string }>(
    c,
    `INSERT INTO programmes(organizer_id, name, normalized_key) VALUES ($1,$2,$3)
     ON CONFLICT (organizer_id, normalized_key) DO UPDATE SET name = programmes.name RETURNING id`,
    [org!.id, draft.programme, norm(draft.programme)],
  );
  const blockers = redemptionBlockers(draft);
  const opp = await one<{ id: string }>(
    c,
    `INSERT INTO opportunities(programme_id, organizer_id, edition_key, title, category, summary, description, tags,
        official_url, application_url, location_mode, location_text, fee, fee_text, benefits_text, requirements,
        availability, availability_checked_at, last_successful_check_at, next_check_at, publication,
        redemption_blockers, origin, is_fixture, published_at, eligibility_complete, eligibility_summary)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$18, now() + interval '24 hours',
        'published',$19,$20,$21, now(), $22, $23)
     ON CONFLICT (programme_id, edition_key) DO NOTHING RETURNING id`,
    [prog!.id, org!.id, draft.editionKey, draft.title, draft.category, draft.summary, draft.description, draft.tags,
     draft.officialUrl, draft.applicationUrl, draft.locationMode, draft.locationText, draft.fee, draft.feeText,
     draft.benefitsText, draft.requirements, draft.availability, draft.sourceCheckedAt, blockers, origin, isFixture,
     draft.eligibilityComplete, draft.eligibilitySummary],
  );
  if (!opp) {
    const existing = await one<{ id: string }>(c, "SELECT id FROM opportunities WHERE programme_id = $1 AND edition_key = $2", [prog!.id, draft.editionKey]);
    return { duplicateOf: existing!.id };
  }
  const id = opp.id;
  const dl = buildDeadline({
    sourceText: draft.deadline.sourceText || "Not stated", date: draft.deadline.date, time: draft.deadline.time,
    timezone: draft.deadline.timezone, rolling: draft.deadline.rolling,
  });
  await c.query(
    `INSERT INTO opportunity_deadlines(opportunity_id, kind, source_text, source_local_date, source_local_time, timezone, utc_instant, precision, evidence_id, verified_at)
     VALUES ($1,'application',$2,$3,$4,$5,$6,$7,$8,$9)`,
    [id, dl.source_text, dl.source_local_date, dl.source_local_time, dl.timezone, dl.utc_instant, dl.precision, draft.evidenceSnapshotId, draft.sourceCheckedAt],
  );
  for (const r of draft.rules) {
    await c.query(
      `INSERT INTO eligibility_rules(opportunity_id, rule_type, operator, operand, source_text, is_hard, evidence_id) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [id, r.rule_type, r.operator, JSON.stringify(r.operand), r.source_text, r.is_hard, draft.evidenceSnapshotId],
    );
  }
  const srcs: [string, string][] = [[draft.applicationUrl, "application"]];
  if (draft.officialUrl) srcs.push([draft.officialUrl, "official"]);
  for (const [url, role] of srcs) {
    await c.query(
      `INSERT INTO opportunity_sources(opportunity_id, url, role, latest_evidence_id) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING`,
      [id, url, role, draft.evidenceSnapshotId],
    );
    try {
      await c.query("INSERT INTO url_aliases(normalized_url, opportunity_id) VALUES ($1,$2) ON CONFLICT DO NOTHING", [normalizeUrl(url), id]);
    } catch {
      /* non-public URL in fixture data: no alias */
    }
  }
  await emit(c, "opportunity.published.v1", id, { origin }, 1);
  await audit(c, actor, "opportunity.published", "opportunity", id, { changes: { origin, edition: draft.editionKey, blockers } });
  return { id };
}

/**
 * Accepts a reviewed submission: publish + award + contributor access in ONE
 * transaction. The award is protected three ways: unique
 * contribution_awards(opportunity_id), unique contribution_awards(submission_id)
 * and unique ledger business_key "award:<opportunity>".
 */
export async function acceptSubmission(c: Db, submissionId: string, draft: Draft, actor: Actor): Promise<PublishResult> {
  const sub = await one(c, "SELECT * FROM submissions WHERE id = $1 FOR UPDATE", [submissionId]);
  if (!sub) fail("not_found", "Submission not found.");
  if (!["review_required", "validating", "needs_information"].includes(sub.status)) {
    fail("conflict", `Submission is ${sub.status}; it can't be accepted now.`);
  }
  const created = await createEdition(c, draft, "user_submission", actor);
  if ("duplicateOf" in created) {
    await c.query(
      "UPDATE submissions SET status = 'duplicate', opportunity_id = $2, resolved_at = now(), status_reason = $3 WHERE id = $1",
      [submissionId, created.duplicateOf, "This edition is already in the bank, so it doesn't earn another credit."],
    );
    await emit(c, "submission.resolved.v1", submissionId, { status: "duplicate" });
    await notify(c, sub.user_id, {
      kind: "submission_duplicate", title: "Already shared",
      body: "Someone already added this edition. It doesn't earn another credit, but thank you for passing it on.",
      link: `/submissions/${submissionId}`, dedupeKey: `sub-resolved:${submissionId}`,
    });
    return { kind: "duplicate", opportunityId: created.duplicateOf };
  }
  const oppId = created.id;
  let awarded = false;
  const creditable = productRules.proposed.creditsPerAcceptedEdition > 0;
  if (creditable) {
    // Lock the wallet; then insert the ledger entry whose unique business key
    // makes any retry or concurrent award collide harmlessly.
    await c.query("SELECT 1 FROM wallets WHERE user_id = $1 FOR UPDATE", [sub.user_id]);
    const entry = await one<{ id: string }>(
      c,
      `INSERT INTO credit_ledger(user_id, delta, reason, business_key, reference_id, actor_kind, actor_id, note)
       VALUES ($1,$2,'contribution_award',$3,$4,$5,$6,'Accepted new opportunity') ON CONFLICT (business_key) DO NOTHING RETURNING id`,
      [sub.user_id, productRules.proposed.creditsPerAcceptedEdition, `award:${oppId}`, oppId, actor.kind, actor.id ?? null],
    );
    if (entry) {
      await c.query(
        "INSERT INTO contribution_awards(opportunity_id, user_id, submission_id, ledger_entry_id) VALUES ($1,$2,$3,$4)",
        [oppId, sub.user_id, submissionId, entry.id],
      );
      await c.query("UPDATE wallets SET balance = balance + $2, updated_at = now() WHERE user_id = $1", [
        sub.user_id, productRules.proposed.creditsPerAcceptedEdition,
      ]);
      awarded = true;
      await emit(c, "contribution.awarded.v1", oppId, { submission_id: submissionId });
    }
  }
  // Contributors keep access to what they shared, free of charge.
  await c.query(
    "INSERT INTO entitlements(user_id, opportunity_id, via) VALUES ($1,$2,'contribution') ON CONFLICT (user_id, opportunity_id) DO NOTHING",
    [sub.user_id, oppId],
  );
  await c.query(
    "UPDATE submissions SET status = 'accepted', opportunity_id = $2, resolved_at = now(), status_reason = NULL WHERE id = $1",
    [submissionId, oppId],
  );
  // Record the reviewed fields as operator-approved evidence.
  await c.query(
    `INSERT INTO field_evidence(submission_id, opportunity_id, field_path, value, origin, snapshot_id)
     VALUES ($1,$2,'canonical',$3,'operator',$4)`,
    [submissionId, oppId, JSON.stringify(draft), draft.evidenceSnapshotId],
  );
  await emit(c, "submission.resolved.v1", submissionId, { status: "accepted" });
  await notify(c, sub.user_id, {
    kind: "submission_accepted", title: "Your opportunity is in.",
    body: awarded ? "Someone else's next step starts here. You earned 1 credit." : "Someone else's next step starts here.",
    link: `/submissions/${submissionId}`, dedupeKey: `sub-resolved:${submissionId}`,
  });
  await audit(c, actor, "submission.accepted", "submission", submissionId, { changes: { opportunity: oppId, awarded } });
  return { kind: "published", opportunityId: oppId, awarded };
}

/** Publishes a discovery candidate or operator entry. Never mints user credits. */
export async function publishWithoutAward(
  c: Db, draft: Draft, origin: "discovery" | "operator" | "fixture", actor: Actor, isFixture = false,
): Promise<PublishResult> {
  const created = await createEdition(c, draft, origin, actor, isFixture);
  if ("duplicateOf" in created) return { kind: "duplicate", opportunityId: created.duplicateOf };
  return { kind: "published", opportunityId: created.id, awarded: false };
}

export async function rejectSubmission(c: Db, submissionId: string, reason: string, actor: Actor, status: "rejected" | "needs_information" = "rejected", missing: string[] = []) {
  const sub = await one(c, "SELECT user_id, status FROM submissions WHERE id = $1 FOR UPDATE", [submissionId]);
  if (!sub) fail("not_found", "Submission not found.");
  if (["accepted", "duplicate", "rejected", "withdrawn"].includes(sub.status)) fail("conflict", `Submission is already ${sub.status}.`);
  await c.query(
    `UPDATE submissions SET status = $2::submission_status, status_reason = $3, missing_information = $4,
            resolved_at = CASE WHEN $2::submission_status = 'rejected' THEN now() ELSE NULL END WHERE id = $1`,
    [submissionId, status, reason, missing],
  );
  // Rejected posters are purged after the retention window.
  if (status === "rejected") {
    await c.query(
      "UPDATE submission_assets SET retention_until = now() + make_interval(days => $2) WHERE submission_id = $1",
      [submissionId, productRules.proposed.rejectedAssetRetentionDays],
    );
  }
  await emit(c, "submission.resolved.v1", submissionId, { status });
  await notify(c, sub.user_id, {
    kind: `submission_${status}`,
    title: status === "rejected" ? "We couldn't add this one" : "We need a few more details",
    body: reason, link: `/submissions/${submissionId}`, dedupeKey: `sub-${status}:${submissionId}:${Date.now()}`,
  });
  await audit(c, actor, `submission.${status}`, "submission", submissionId, { reason });
}

/* ------------------------------------------------------------------ wallet */

export async function walletSummary(c: Db, userId: string) {
  const w = await one(c, "SELECT balance, starter_available, frozen FROM wallets WHERE user_id = $1", [userId]);
  const ledger = await many(
    c,
    `SELECT l.id, l.delta, l.reason, l.note, l.created_at, l.reference_id, o.title AS opportunity_title
       FROM credit_ledger l
       LEFT JOIN entitlements e ON e.ledger_entry_id = l.id
       LEFT JOIN opportunities o ON o.id = coalesce(e.opportunity_id, CASE WHEN l.reason = 'contribution_award' THEN l.reference_id END)
      WHERE l.user_id = $1 ORDER BY l.created_at DESC LIMIT 100`,
    [userId],
  );
  return { balance: w?.balance ?? 0, starterAvailable: !!w?.starter_available, frozen: !!w?.frozen, ledger };
}

/* ------------------------------------------------------------------ refunds */

export async function requestRefund(c: Db, userId: string, entitlementId: string, reason: "expired_at_redemption" | "duplicate" | "clearly_ineligible", detail: string) {
  const e = await one(c, "SELECT * FROM entitlements WHERE id = $1 AND user_id = $2", [entitlementId, userId]);
  if (!e) fail("not_found", "We couldn't find that unlock.");
  if (e.via !== "credit") fail("conflict", "Only opportunities unlocked with a credit can be refunded.");
  const r = await one(
    c,
    `INSERT INTO refund_requests(entitlement_id, user_id, reason, detail) VALUES ($1,$2,$3,$4)
     ON CONFLICT (entitlement_id) DO NOTHING RETURNING id`,
    [entitlementId, userId, reason, detail.slice(0, 1000)],
  );
  if (!r) fail("conflict", "You've already asked about this unlock.");
  await audit(c, { kind: "user", id: userId }, "refund.requested", "entitlement", entitlementId, { reason });
  return r!.id as string;
}

/** Approving issues ONE compensating entry; historic rows are never edited. */
export async function decideRefund(c: Db, refundId: string, approve: boolean, reason: string, actor: Actor) {
  const r = await one(c, "SELECT * FROM refund_requests WHERE id = $1 FOR UPDATE", [refundId]);
  if (!r) fail("not_found", "Refund request not found.");
  if (r.state !== "open") fail("conflict", "This request was already decided.");
  let ledgerId: string | null = null;
  if (approve) {
    const ent = await one(c, "SELECT ledger_entry_id FROM entitlements WHERE id = $1", [r.entitlement_id]);
    await c.query("SELECT 1 FROM wallets WHERE user_id = $1 FOR UPDATE", [r.user_id]);
    const entry = await one<{ id: string }>(
      c,
      `INSERT INTO credit_ledger(user_id, delta, reason, business_key, reference_id, actor_kind, actor_id, note)
       VALUES ($1, 1, 'refund', $2, $3, $4, $5, $6) ON CONFLICT (business_key) DO NOTHING RETURNING id`,
      [r.user_id, `refund:${ent?.ledger_entry_id ?? r.entitlement_id}`, r.entitlement_id, actor.kind, actor.id ?? null, `Refund: ${r.reason.replace(/_/g, " ")}`],
    );
    if (entry) {
      await c.query("UPDATE wallets SET balance = balance + 1, updated_at = now() WHERE user_id = $1", [r.user_id]);
      ledgerId = entry.id;
    }
  }
  await c.query(
    "UPDATE refund_requests SET state = $2, decided_by = $3, decision_reason = $4, decided_at = now(), ledger_entry_id = $5 WHERE id = $1",
    [refundId, approve ? "approved" : "rejected", actor.id ?? null, reason, ledgerId],
  );
  await notify(c, r.user_id, {
    kind: "refund_decided", title: approve ? "Credit returned" : "Refund request reviewed",
    body: approve ? "We returned your credit for that match." : reason, link: "/credits", dedupeKey: `refund:${refundId}`,
  });
  await audit(c, actor, approve ? "refund.approved" : "refund.rejected", "refund_request", refundId, { reason });
}
