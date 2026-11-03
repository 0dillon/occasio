"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  correctOpportunity, requireRole, resolveReport, setFlag, setOrganizerTrust, setPublication, setUserRole,
} from "@/domain/admin";
import { createSource, setSourceState } from "@/domain/discovery";
import { acceptSubmission, decideRefund, draftSchema, publishWithoutAward, rejectSubmission } from "@/domain/exchange";
import { fail } from "@/domain/errors";
import { formValues, str, toFormState, type FormState } from "@/server/action";
import { asUser, currentUser } from "@/server/session";
import type { Db } from "@/db/tx";

async function staff(min: "reviewer" | "operator" | "admin") {
  return requireRole(await currentUser(), min);
}
const actor = (u: { id: string }) => ({ kind: "staff" as const, id: u.id });

/** Reads the reviewed canonical facts from the review form. */
function readDraft(fd: FormData) {
  const lines = (k: string) => str(fd, k).split("\n").map((s) => s.trim()).filter(Boolean);
  const rules = lines("rules").map((l) => {
    // Format: type: CODE, CODE | source text   (e.g. residence_country: NG, GH | Open to residents of Nigeria and Ghana)
    const [head, text] = l.split("|").map((s) => s.trim());
    const [type, codes] = (head ?? "").split(":").map((s) => s.trim());
    return { rule_type: type as any, operator: type === "other" ? "note" : "in", operand: (codes ?? "").split(",").map((s) => (type === "residence_country" || type === "citizenship" ? s.trim().toUpperCase() : s.trim().toLowerCase())).filter(Boolean), source_text: text || head || l, is_hard: true };
  });
  return draftSchema.parse({
    title: str(fd, "title"), organizer: str(fd, "organizer"), programme: str(fd, "programme") || str(fd, "title"), editionKey: str(fd, "editionKey"),
    category: str(fd, "category"), summary: str(fd, "summary") || null, description: str(fd, "description") || null,
    tags: str(fd, "tags").split(",").map((s) => s.trim()).filter(Boolean),
    officialUrl: str(fd, "officialUrl") || null, applicationUrl: str(fd, "applicationUrl"),
    locationMode: str(fd, "locationMode") || "unknown", locationText: str(fd, "locationText") || null,
    fee: str(fd, "fee") || "unknown", feeText: str(fd, "feeText") || null, benefitsText: str(fd, "benefitsText") || null,
    requirements: lines("requirements"), availability: str(fd, "availability"),
    deadline: {
      sourceText: str(fd, "deadlineSourceText"), date: str(fd, "deadlineDate") || null, time: str(fd, "deadlineTime") || null,
      timezone: str(fd, "deadlineTimezone") || null, rolling: fd.get("deadlineRolling") === "on",
    },
    rules, eligibilityComplete: fd.get("eligibilityComplete") === "on", eligibilitySummary: str(fd, "eligibilitySummary") || null,
    organizerTrust: str(fd, "organizerTrust") || "unassessed",
    evidenceSnapshotId: str(fd, "evidenceSnapshotId") || null,
    sourceCheckedAt: fd.get("sourceConfirmed") === "on" ? new Date() : null,
  });
}

export async function reviewSubmissionAction(_: FormState, fd: FormData): Promise<FormState> {
  const v = formValues(fd);
  let dest = "/admin/reviews";
  try {
    const u = await staff("reviewer");
    const id = str(fd, "submissionId");
    const decision = str(fd, "decision");
    if (decision === "accept") {
      const d = readDraft(fd);
      const r = await asUser(u, (c) => acceptSubmission(c, id, d, actor(u)));
      dest = `/admin/reviews?done=${r.kind === "duplicate" ? "duplicate" : r.awarded ? "accepted" : "published"}`;
    } else if (decision === "reject" || decision === "needs_information") {
      const reason = str(fd, "reason");
      if (reason.length < 10) fail("invalid", "Write a short, specific reason the contributor will see (10+ characters).");
      await asUser(u, (c) => rejectSubmission(c, id, reason, actor(u), decision === "reject" ? "rejected" : "needs_information",
        decision === "needs_information" ? str(fd, "missing").split(",").map((s) => s.trim()).filter(Boolean) : []));
      dest = `/admin/reviews?done=${decision}`;
    } else fail("invalid", "Choose a decision.");
  } catch (e) {
    return toFormState(e, v);
  }
  revalidatePath("/admin", "layout");
  redirect(dest);
}

export async function publishCandidateAction(_: FormState, fd: FormData): Promise<FormState> {
  const v = formValues(fd);
  try {
    const u = await staff("reviewer");
    const id = str(fd, "candidateId");
    if (str(fd, "decision") === "reject") {
      await asUser(u, async (c: Db) => {
        await c.query("UPDATE discovery_candidates SET state = 'rejected', reason = $2 WHERE id = $1 AND state = 'review_required'", [id, str(fd, "reason") || "Rejected in review"]);
      });
    } else {
      const d = readDraft(fd);
      await asUser(u, async (c: Db) => {
        const cand = (await c.query("SELECT s.is_fixture FROM discovery_candidates d JOIN source_registry s ON s.id = d.source_id WHERE d.id = $1 AND d.state = 'review_required' FOR UPDATE OF d", [id])).rows[0];
        if (!cand) fail("conflict", "This candidate was already handled.");
        const r = await publishWithoutAward(c, d, cand.is_fixture ? "fixture" : "discovery", actor(u), !!cand.is_fixture);
        await c.query("UPDATE discovery_candidates SET state = $2, opportunity_id = $3 WHERE id = $1", [id, r.kind === "duplicate" ? "duplicate" : "published", r.opportunityId]);
      });
    }
  } catch (e) {
    return toFormState(e, v);
  }
  revalidatePath("/admin", "layout");
  redirect("/admin/discovery?done=1");
}

export async function correctOpportunityAction(_: FormState, fd: FormData): Promise<FormState> {
  try {
    const u = await staff("operator");
    const id = str(fd, "id");
    const deadlineDate = str(fd, "deadlineDate");
    const rolling = fd.get("deadlineRolling") === "on";
    await asUser(u, (c) => correctOpportunity(c, u, id, {
      title: str(fd, "title") || undefined, summary: fd.has("summary") ? str(fd, "summary") || null : undefined,
      availability: (str(fd, "availability") || undefined) as any, fee: (str(fd, "fee") || undefined) as any,
      eligibilityComplete: fd.get("eligibilityComplete") === "on",
      deadline: fd.get("changeDeadline") === "on"
        ? { sourceText: str(fd, "deadlineSourceText"), date: deadlineDate || null, time: str(fd, "deadlineTime") || null, timezone: str(fd, "deadlineTimezone") || null, rolling }
        : undefined,
      markChecked: fd.get("markChecked") === "on",
      reason: str(fd, "reason"),
    }));
  } catch (e) {
    return toFormState(e, formValues(fd));
  }
  revalidatePath("/admin/catalog");
  return { ok: true, message: "Saved as a new revision. Affected reminders are replanned and people tracking it are told." };
}

export async function publicationAction(_: FormState, fd: FormData): Promise<FormState> {
  try {
    const u = await staff("operator");
    await asUser(u, (c) => setPublication(c, u, str(fd, "id"), str(fd, "state") as any, str(fd, "reason")));
  } catch (e) {
    return toFormState(e, formValues(fd));
  }
  revalidatePath("/admin/catalog");
  return { ok: true, message: "Publication updated." };
}

export async function organizerTrustAction(_: FormState, fd: FormData): Promise<FormState> {
  try {
    const u = await staff("operator");
    const reason = str(fd, "reason");
    if (reason.length < 5) fail("invalid", "Give a reason for the audit trail.");
    await asUser(u, (c) => setOrganizerTrust(c, u, str(fd, "organizerId"), str(fd, "trust") as any, reason));
  } catch (e) {
    return toFormState(e, formValues(fd));
  }
  revalidatePath("/admin/catalog");
  return { ok: true, message: "Organizer status updated." };
}

export async function resolveReportAction(_: FormState, fd: FormData): Promise<FormState> {
  try {
    const u = await staff("reviewer");
    await asUser(u, (c) => resolveReport(c, u, str(fd, "id"), str(fd, "state") as any, str(fd, "resolution")));
  } catch (e) {
    return toFormState(e, formValues(fd));
  }
  revalidatePath("/admin/reports");
  return { ok: true, message: "Report resolved." };
}

export async function decideRefundAction(_: FormState, fd: FormData): Promise<FormState> {
  try {
    const u = await staff("operator");
    const reason = str(fd, "reason");
    if (reason.length < 5) fail("invalid", "Give a reason the member will see.");
    await asUser(u, (c) => decideRefund(c, str(fd, "id"), str(fd, "decision") === "approve", reason, actor(u)));
  } catch (e) {
    return toFormState(e, formValues(fd));
  }
  revalidatePath("/admin/refunds");
  return { ok: true, message: "Decision recorded." };
}

export async function createSourceAction(_: FormState, fd: FormData): Promise<FormState> {
  try {
    const u = await staff("operator");
    await asUser(u, (c) => createSource(c, u.id, {
      name: str(fd, "name"), baseUrl: str(fd, "baseUrl"), adapter: str(fd, "adapter") as any, scopePath: str(fd, "scopePath") || "/",
      accessReview: str(fd, "accessReview"), minIntervalSeconds: Number(str(fd, "minIntervalSeconds") || 5),
      dailyFetchBudget: Number(str(fd, "dailyFetchBudget") || 50), crawlEveryMinutes: Number(str(fd, "crawlEveryMinutes") || 720),
    }));
  } catch (e) {
    return toFormState(e, formValues(fd));
  }
  revalidatePath("/admin/sources");
  return { ok: true, message: "Source added. It stays off until it's approved and enabled." };
}

export async function sourceStateAction(_: FormState, fd: FormData): Promise<FormState> {
  try {
    const u = await staff(str(fd, "action") === "approve" ? "admin" : "operator");
    await asUser(u, (c) => setSourceState(c, u.id, str(fd, "id"), str(fd, "action") as any, str(fd, "reason") || str(fd, "action")));
  } catch (e) {
    return toFormState(e);
  }
  revalidatePath("/admin/sources");
  return { ok: true, message: "Source updated." };
}

export async function setRoleAction(_: FormState, fd: FormData): Promise<FormState> {
  try {
    const u = await staff("admin");
    const reason = str(fd, "reason");
    if (reason.length < 5) fail("invalid", "Give a reason for the audit trail.");
    await asUser(u, (c) => setUserRole(c, u, str(fd, "userId"), str(fd, "role") as any, reason));
  } catch (e) {
    return toFormState(e, formValues(fd));
  }
  revalidatePath("/admin/users");
  return { ok: true, message: "Role changed. Their sessions were ended so the change applies immediately." };
}

export async function setFlagAction(_: FormState, fd: FormData): Promise<FormState> {
  try {
    const u = await staff("admin");
    const reason = str(fd, "reason");
    if (reason.length < 5) fail("invalid", "Give a reason for the audit trail.");
    await asUser(u, (c) => setFlag(c, u, str(fd, "key"), str(fd, "value") === "true", reason));
  } catch (e) {
    return toFormState(e, formValues(fd));
  }
  revalidatePath("/admin/flags");
  return { ok: true, message: "Flag updated." };
}
