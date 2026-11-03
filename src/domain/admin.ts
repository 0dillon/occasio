import { z } from "zod";
import { type Db, many, one } from "@/db/tx";
import { audit, emit } from "./audit";
import { buildDeadline } from "./deadlines";
import { fail } from "./errors";
import type { SessionUser } from "./auth";
import { redemptionBlockers, type Draft } from "./exchange";

export type StaffRole = "reviewer" | "operator" | "admin";
const RANK: Record<string, number> = { member: 0, reviewer: 1, operator: 2, admin: 3 };

/** Roles come from the users table only, never from profile input or the browser. */
export function requireRole(user: SessionUser | null, min: StaffRole) {
  if (!user) fail("unauthenticated", "Sign in to continue.");
  if ((RANK[user!.role] ?? 0) < RANK[min]!) fail("forbidden", "You don't have access to this area.");
  return user!;
}

export const reviewQueue = (c: Db) =>
  many(
    c,
    `SELECT s.id, s.application_url, s.status, s.created_at, s.claimed, s.attempts,
            (s.candidate->'extraction'->'title'->>'value') AS extracted_title,
            (SELECT count(*)::int FROM submission_assets a WHERE a.submission_id = s.id) AS assets
       FROM submissions s WHERE s.status IN ('review_required','needs_information','failed')
      ORDER BY s.created_at LIMIT 100`,
  );

export const discoveryQueue = (c: Db) =>
  many(
    c,
    `SELECT d.id, d.url, d.payload, d.state, d.created_at, s.name AS source_name, s.is_fixture
       FROM discovery_candidates d JOIN source_registry s ON s.id = d.source_id
      WHERE d.state = 'review_required' ORDER BY d.created_at LIMIT 100`,
  );

export async function opsCounts(c: Db) {
  return one(
    c,
    `SELECT (SELECT count(*)::int FROM submissions WHERE status = 'review_required') AS reviews,
            (SELECT count(*)::int FROM submissions WHERE status IN ('received','queued','fetching','extracting','validating')) AS verifying,
            (SELECT min(created_at) FROM submissions WHERE status IN ('received','queued')) AS oldest_queued,
            (SELECT count(*)::int FROM discovery_candidates WHERE state = 'review_required') AS discovery,
            (SELECT count(*)::int FROM reports WHERE state = 'open') AS reports,
            (SELECT count(*)::int FROM refund_requests WHERE state = 'open') AS refunds,
            (SELECT min(due_at) FROM reminders WHERE state = 'scheduled' AND due_at <= now()) AS oldest_due_reminder,
            (SELECT count(*)::int FROM notification_attempts WHERE status IN ('failed','uncertain')) AS failed_notifications,
            (SELECT count(*)::int FROM domain_events WHERE dispatched_at IS NULL) AS pending_events,
            (SELECT count(*)::int FROM opportunities WHERE publication = 'published') AS published`,
  );
}

/** Builds a pre-filled review draft from the extraction and the contributor's claims. */
export function draftFromSubmission(s: any): Partial<Draft> & { notes: string[] } {
  const x = s.candidate?.extraction;
  const notes: string[] = [];
  if (!x) notes.push("No automatic extraction yet.");
  else {
    notes.push(`Extractor: ${x.extractor}`);
    for (const m of x.missing_information ?? []) notes.push(`Missing: ${m.replace(/_/g, " ")}`);
    for (const k of x.conflicts ?? []) notes.push(`Conflict: ${k}`);
    for (const r of x.risk_flags ?? []) notes.push(`Risk: ${r}`);
  }
  const year = x?.deadline?.local_date?.slice(0, 4) ?? String(new Date().getFullYear());
  return {
    title: x?.title?.value ?? s.claimed?.title ?? "",
    organizer: x?.organizer?.value ?? s.claimed?.organizer ?? "",
    programme: x?.title?.value ?? s.claimed?.title ?? "",
    editionKey: year,
    category: x?.category?.value ?? s.claimed?.category ?? "other",
    summary: x?.summary ?? null,
    applicationUrl: s.application_url,
    locationMode: x?.location_mode ?? "unknown",
    fee: x?.fee?.status ?? "unknown",
    availability: "unknown",
    deadline: {
      sourceText: x?.deadline?.source_text ?? s.claimed?.deadline_text ?? "",
      date: x?.deadline?.local_date ?? null, time: x?.deadline?.local_time ?? null,
      timezone: x?.deadline?.timezone ?? null, rolling: !!x?.deadline?.rolling,
    },
    evidenceSnapshotId: s.candidate?.snapshotId ?? null,
    notes,
  };
}

const correctionSchema = z.object({
  title: z.string().trim().min(3).max(200).optional(),
  summary: z.string().max(600).nullable().optional(),
  availability: z.enum(["upcoming", "open", "closed", "rolling", "unknown"]).optional(),
  fee: z.enum(["free", "paid", "unknown"]).optional(),
  eligibilityComplete: z.boolean().optional(),
  deadline: z.object({
    sourceText: z.string().max(300), date: z.string().nullable(), time: z.string().nullable(), timezone: z.string().nullable(), rolling: z.boolean(),
  }).optional(),
  markChecked: z.boolean().optional(),
  reason: z.string().trim().min(5, "Give a reason for the audit trail").max(500),
});

/**
 * Operator correction: new revision, revision history row, deadline
 * revision (old one kept, marked not current), outbox event → reminders are
 * replanned and affected applicants are told.
 */
export async function correctOpportunity(c: Db, actor: SessionUser, id: string, raw: z.input<typeof correctionSchema>) {
  const input = correctionSchema.parse(raw);
  const before = await one(c, "SELECT * FROM opportunities WHERE id = $1 FOR UPDATE", [id]);
  if (!before) fail("not_found", "Opportunity not found.");
  const changed: string[] = [];
  const sets: string[] = [];
  const vals: unknown[] = [id];
  const add = (col: string, v: unknown) => { vals.push(v); sets.push(`${col} = $${vals.length}`); changed.push(col); };
  if (input.title && input.title !== before.title) add("title", input.title);
  if (input.summary !== undefined && input.summary !== before.summary) add("summary", input.summary);
  if (input.availability && input.availability !== before.availability) add("availability", input.availability);
  if (input.fee && input.fee !== before.fee) add("fee", input.fee);
  if (input.eligibilityComplete !== undefined && input.eligibilityComplete !== before.eligibility_complete) add("eligibility_complete", input.eligibilityComplete);
  if (input.markChecked) { add("last_successful_check_at", new Date()); add("availability_checked_at", new Date()); }
  let deadlineChanged = false;
  if (input.deadline) {
    const cur = await one(c, "SELECT * FROM opportunity_deadlines WHERE opportunity_id = $1 AND is_current AND kind = 'application' FOR UPDATE", [id]);
    const next = buildDeadline({ sourceText: input.deadline.sourceText, date: input.deadline.date, time: input.deadline.time, timezone: input.deadline.timezone, rolling: input.deadline.rolling });
    const same = cur && cur.precision === next.precision && String(cur.source_local_date ?? "") === String(next.source_local_date ?? "")
      && (cur.source_local_time ?? "").slice(0, 5) === (next.source_local_time ?? "").slice(0, 5) && (cur.timezone ?? "") === (next.timezone ?? "");
    if (!same) {
      const rev = (cur?.revision ?? 0) + 1;
      if (cur) await c.query("UPDATE opportunity_deadlines SET is_current = false WHERE id = $1", [cur.id]);
      await c.query(
        `INSERT INTO opportunity_deadlines(opportunity_id, kind, source_text, source_local_date, source_local_time, timezone, utc_instant, precision, verified_at, revision)
         VALUES ($1,'application',$2,$3,$4,$5,$6,$7, now(), $8)`,
        [id, next.source_text, next.source_local_date, next.source_local_time, next.timezone, next.utc_instant, next.precision, rev],
      );
      deadlineChanged = true;
      changed.push("deadline");
    }
  }
  if (!changed.length) return before.revision as number;
  // Recompute redemption blockers from the corrected facts.
  const after = { ...before, ...Object.fromEntries(sets.map((s, i) => [s.split(" = ")[0], vals[i + 1]])) };
  const dl = await one(c, "SELECT * FROM opportunity_deadlines WHERE opportunity_id = $1 AND is_current AND kind = 'application'", [id]);
  const org = await one(c, "SELECT trust FROM organizers WHERE id = $1", [before.organizer_id]);
  const blockers = redemptionBlockers({
    availability: after.availability, sourceCheckedAt: after.last_successful_check_at, eligibilityComplete: after.eligibility_complete,
    organizerTrust: org?.trust ?? "unassessed",
    deadline: { sourceText: dl?.source_text ?? "", date: dl?.source_local_date ? new Date(dl.source_local_date).toISOString().slice(0, 10) : null, time: dl?.source_local_time?.slice(0, 5) ?? null, timezone: dl?.timezone ?? null, rolling: dl?.precision === "rolling" },
  } as Draft);
  add("redemption_blockers", blockers);
  sets.push("revision = revision + 1");
  const r = await one<{ revision: number }>(c, `UPDATE opportunities SET ${sets.join(", ")} WHERE id = $1 RETURNING revision`, vals);
  await c.query(
    "INSERT INTO opportunity_revisions(opportunity_id, revision, changed_fields, before, after, actor_kind, actor_id, reason) VALUES ($1,$2,$3,$4,$5,'staff',$6,$7)",
    [id, r!.revision, changed, JSON.stringify(before), JSON.stringify(input), actor.id, input.reason],
  );
  await emit(c, "opportunity.changed.v1", id, { change: deadlineChanged ? "deadline_corrected" : "corrected", fields: changed }, r!.revision);
  await audit(c, { kind: "staff", id: actor.id }, "opportunity.corrected", "opportunity", id, { reason: input.reason, changes: { fields: changed } });
  return r!.revision;
}

export async function setPublication(c: Db, actor: SessionUser, id: string, state: "published" | "hidden" | "archived", reason: string) {
  if (reason.trim().length < 5) fail("invalid", "Give a reason for the audit trail.");
  const r = await one<{ revision: number }>(c, "UPDATE opportunities SET publication = $2, revision = revision + 1 WHERE id = $1 RETURNING revision", [id, state]);
  if (!r) fail("not_found", "Opportunity not found.");
  await emit(c, state === "published" ? "opportunity.changed.v1" : "opportunity.hidden.v1", id, { change: state === "published" ? "republished" : "hidden", reason }, r!.revision);
  if (state !== "published") await emit(c, "opportunity.changed.v1", id, { change: "hidden", reason }, r!.revision);
  await audit(c, { kind: "staff", id: actor.id }, `opportunity.${state}`, "opportunity", id, { reason });
}

export async function setOrganizerTrust(c: Db, actor: SessionUser, organizerId: string, trust: "unassessed" | "supported" | "concern" | "blocked", reason: string) {
  await c.query("UPDATE organizers SET trust = $2, trust_note = $3 WHERE id = $1", [organizerId, trust, reason]);
  if (trust === "concern" || trust === "blocked") {
    await c.query(
      "UPDATE opportunities SET redemption_blockers = array_append(redemption_blockers, 'Organizer identity needs review') WHERE organizer_id = $1 AND NOT ('Organizer identity needs review' = ANY(redemption_blockers))",
      [organizerId],
    );
  } else {
    await c.query("UPDATE opportunities SET redemption_blockers = array_remove(redemption_blockers, 'Organizer identity needs review') WHERE organizer_id = $1", [organizerId]);
  }
  await audit(c, { kind: "staff", id: actor.id }, "organizer.trust_changed", "organizer", organizerId, { reason, changes: { trust } });
}

export async function resolveReport(c: Db, actor: SessionUser, id: string, state: "actioned" | "dismissed", resolution: string) {
  if (resolution.trim().length < 5) fail("invalid", "Describe the resolution.");
  await c.query("UPDATE reports SET state = $2, resolution = $3, resolved_by = $4, resolved_at = now() WHERE id = $1 AND state = 'open'", [id, state, resolution, actor.id]);
  await audit(c, { kind: "staff", id: actor.id }, `report.${state}`, "report", id, { reason: resolution });
}

export async function setUserRole(c: Db, actor: SessionUser, userId: string, role: "member" | "reviewer" | "operator" | "admin", reason: string) {
  if (actor.role !== "admin") fail("forbidden", "Only administrators can change roles.");
  if (userId === actor.id) fail("invalid", "You can't change your own role.");
  await c.query("UPDATE users SET role = $2 WHERE id = $1", [userId, role]);
  await c.query("DELETE FROM sessions WHERE user_id = $1", [userId]);
  await audit(c, { kind: "staff", id: actor.id }, "user.role_changed", "user", userId, { reason, changes: { role } });
}

export async function setFlag(c: Db, actor: SessionUser, key: string, value: boolean, reason: string) {
  if (!["discovery_enabled", "ai_extraction_enabled", "email_enabled", "auto_publish_enabled"].includes(key)) fail("invalid", "Unknown flag.");
  await c.query("UPDATE app_flags SET value = $2, updated_by = $3, updated_at = now() WHERE key = $1", [key, JSON.stringify(value), actor.id]);
  await audit(c, { kind: "staff", id: actor.id }, "flag.changed", "flag", key, { reason, changes: { value } });
}

export async function createReport(c: Db, userId: string, opportunityId: string, reason: string, detail: string) {
  const ok = ["suspected_scam", "wrong_deadline", "closed", "wrong_eligibility", "broken_link", "other"];
  if (!ok.includes(reason)) fail("invalid", "Choose a reason.");
  const recent = await one<{ n: number }>(c, "SELECT count(*)::int AS n FROM reports WHERE reporter_id = $1 AND created_at > now() - interval '1 day'", [userId]);
  if ((recent?.n ?? 0) >= 10) fail("rate_limited", "You've sent a lot of reports today. Thank you — we'll get to them.");
  const r = await one<{ id: string }>(c, "INSERT INTO reports(reporter_id, opportunity_id, reason, detail) VALUES ($1,$2,$3,$4) RETURNING id", [userId, opportunityId, reason, detail.slice(0, 2000)]);
  // A scam report hides the record from NEW matching immediately, pending review.
  if (reason === "suspected_scam") {
    await c.query("UPDATE opportunities SET redemption_blockers = array_append(redemption_blockers, 'Under review after a report') WHERE id = $1 AND NOT ('Under review after a report' = ANY(redemption_blockers))", [opportunityId]);
  }
  await audit(c, { kind: "user", id: userId }, "report.created", "opportunity", opportunityId, { changes: { reason } });
  return r!.id;
}
