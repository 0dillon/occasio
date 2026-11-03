import { randomUUID } from "node:crypto";
import { z } from "zod";
import { processPoster, putObject } from "@/adapters/storage";
import { productRules } from "@/config/product-rules";
import { type Db, many, one, withUser } from "@/db/tx";
import { normalizeUrl, UrlPolicyError } from "@/lib/urls";
import { audit, emit } from "./audit";
import { requireVerified, type SessionUser } from "./auth";
import { CATEGORIES } from "./catalog";
import { DomainError, fail } from "./errors";

export const submissionInput = z.object({
  applicationUrl: z.string().trim().min(8).max(2048),
  note: z.string().trim().max(1000).optional().default(""),
  // Optional details the contributor can see on the poster. Treated as claims
  // to check, never as authoritative facts.
  title: z.string().trim().max(200).optional().default(""),
  organizer: z.string().trim().max(120).optional().default(""),
  category: z.enum(CATEGORIES).optional().catch(undefined),
  deadlineText: z.string().trim().max(200).optional().default(""),
  idempotencyKey: z.string().min(8).max(80),
});
export type SubmissionInput = z.infer<typeof submissionInput>;

export const STATUS_COPY: Record<string, { label: string; body: string }> = {
  received: { label: "Received", body: "Your submission is saved. You can leave this page while we check it." },
  queued: { label: "Queued", body: "Your submission is saved and waiting for a check." },
  fetching: { label: "Checking the source", body: "We're opening the official page." },
  extracting: { label: "Reading the details", body: "We're comparing the page with what you shared." },
  validating: { label: "Confirming dates", body: "We're checking dates and availability." },
  needs_information: { label: "Needs information", body: "We need to confirm a few details before adding this." },
  review_required: { label: "In review", body: "A person is checking the source and details. This can take a little while." },
  accepted: { label: "Accepted", body: "Your opportunity is in. Someone else's next step starts here." },
  duplicate: { label: "Already shared", body: "Someone already shared this edition, so it doesn't earn another credit." },
  rejected: { label: "Not added", body: "We couldn't add this one." },
  failed: { label: "Check failed", body: "Something went wrong on our side. Your submission is kept and we'll retry." },
  withdrawn: { label: "Withdrawn", body: "You withdrew this submission." },
};

export async function createSubmission(user: SessionUser, raw: SubmissionInput, image: Buffer | null) {
  requireVerified(user);
  const input = submissionInput.parse(raw);
  let normalized: string;
  try {
    normalized = normalizeUrl(input.applicationUrl);
  } catch (e) {
    if (e instanceof UrlPolicyError) throw new DomainError("invalid", e.message, { field: "applicationUrl" });
    throw e;
  }
  if (productRules.proposed.imageRequired && !image) fail("invalid", "Add an image of the poster.", { field: "image" });
  // Validate/re-encode before opening the transaction; never hold a tx during image work.
  const poster = image ? await processPoster(image) : null;

  return withUser(user.id, async (c) => {
    const replay = await one(c, "SELECT id, status FROM submissions WHERE user_id = $1 AND idempotency_key = $2", [
      user.id, input.idempotencyKey,
    ]);
    if (replay) return { id: replay.id as string, status: replay.status as string, replay: true };

    const counts = await one<{ today: number; pending: number }>(
      c,
      `SELECT count(*) FILTER (WHERE created_at > now() - interval '1 day')::int AS today,
              count(*) FILTER (WHERE status IN ('received','queued','fetching','extracting','validating'))::int AS pending
         FROM submissions WHERE user_id = $1`,
      [user.id],
    );
    if ((counts?.today ?? 0) >= productRules.proposed.dailySubmissionCap) {
      fail("rate_limited", `You can share up to ${productRules.proposed.dailySubmissionCap} opportunities a day. Try again tomorrow.`);
    }
    if ((counts?.pending ?? 0) >= productRules.proposed.maxPendingSubmissions) {
      fail("rate_limited", "Wait for your current submissions to finish checking before adding more.");
    }
    const claimed = {
      title: input.title || null, organizer: input.organizer || null,
      category: input.category ?? null, deadline_text: input.deadlineText || null,
    };
    const sub = await one<{ id: string; status: string }>(
      c,
      `INSERT INTO submissions(user_id, application_url, normalized_url, user_note, claimed, status, idempotency_key)
       VALUES ($1,$2,$3,$4,$5,'received',$6) RETURNING id, status`,
      [user.id, input.applicationUrl, normalized, input.note || null, JSON.stringify(claimed), input.idempotencyKey],
    );
    if (poster) {
      const key = `posters/${user.id}/${randomUUID()}.jpg`;
      await putObject(key, poster.data);
      await c.query(
        `INSERT INTO submission_assets(submission_id, owner_id, object_key, mime, width, height, bytes, sha256)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [sub!.id, user.id, key, poster.mime, poster.width, poster.height, poster.bytes, poster.sha256],
      );
    }
    await emit(c, "submission.received.v1", sub!.id, {});
    await audit(c, { kind: "user", id: user.id }, "submission.created", "submission", sub!.id);
    return { id: sub!.id, status: sub!.status, replay: false };
  });
}

export async function getSubmission(c: Db, id: string) {
  if (!/^[0-9a-f-]{36}$/.test(id)) return null;
  const s = await one(
    c,
    `SELECT s.*, o.title AS opportunity_title,
            (SELECT json_agg(json_build_object('id', a.id, 'width', a.width, 'height', a.height)) FROM submission_assets a WHERE a.submission_id = s.id) AS assets,
            (SELECT row_to_json(v) FROM (SELECT checks, decision, extractor, created_at FROM verification_runs
               WHERE submission_id = s.id ORDER BY created_at DESC LIMIT 1) v) AS last_run
       FROM submissions s LEFT JOIN opportunities o ON o.id = s.opportunity_id WHERE s.id = $1`,
    [id],
  );
  return s ?? null;
}

export const listMySubmissions = (c: Db, userId: string, limit = 20) =>
  many(
    c,
    `SELECT s.id, s.application_url, s.status, s.status_reason, s.claimed, s.created_at, s.opportunity_id, o.title AS opportunity_title
       FROM submissions s LEFT JOIN opportunities o ON o.id = s.opportunity_id
      WHERE s.user_id = $1 ORDER BY s.created_at DESC LIMIT $2`,
    [userId, limit],
  );

/** Contributor answers a "needs information" request; re-runs verification. */
export async function addSubmissionInformation(user: SessionUser, id: string, info: { deadlineText?: string; note?: string; title?: string; organizer?: string }) {
  return withUser(user.id, async (c) => {
    const s = await one(c, "SELECT * FROM submissions WHERE id = $1 FOR UPDATE", [id]);
    if (!s) fail("not_found", "Submission not found.");
    if (s.status !== "needs_information") fail("conflict", "This submission isn't waiting for information.");
    const claimed = { ...s.claimed };
    if (info.deadlineText) claimed.deadline_text = info.deadlineText.slice(0, 200);
    if (info.title) claimed.title = info.title.slice(0, 200);
    if (info.organizer) claimed.organizer = info.organizer.slice(0, 120);
    const note = [s.user_note, info.note].filter(Boolean).join("\n").slice(0, 1000);
    await c.query(
      "UPDATE submissions SET claimed = $2, user_note = $3, status = 'received', missing_information = '{}', status_reason = NULL WHERE id = $1",
      [id, JSON.stringify(claimed), note || null],
    );
    await emit(c, "submission.received.v1", id, { resubmitted: true });
    await audit(c, { kind: "user", id: user.id }, "submission.information_added", "submission", id);
  });
}

export async function withdrawSubmission(user: SessionUser, id: string) {
  await withUser(user.id, async (c) => {
    const r = await c.query(
      `UPDATE submissions SET status = 'withdrawn', resolved_at = now()
        WHERE id = $1 AND status IN ('received','queued','needs_information','review_required')`,
      [id],
    );
    if (!r.rowCount) fail("conflict", "This submission can no longer be withdrawn.");
    await audit(c, { kind: "user", id: user.id }, "submission.withdrawn", "submission", id);
  });
}
