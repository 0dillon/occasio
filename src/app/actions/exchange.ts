"use server";
import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { productRules } from "@/config/product-rules";
import { createReport } from "@/domain/admin";
import { requireVerified } from "@/domain/auth";
import { requestRefund } from "@/domain/exchange";
import { createDirectMatch, createMatch, matchFeedback, redeem } from "@/domain/matching";
import { addSubmissionInformation, createSubmission, withdrawSubmission } from "@/domain/submissions";
import { formValues, str, toFormState, type FormState } from "@/server/action";
import { asSelf, requireUser } from "@/server/session";

export async function submitOpportunityAction(_: FormState, fd: FormData): Promise<FormState> {
  const u = await requireUser("/contribute");
  const v = formValues(fd);
  let id: string;
  try {
    const file = fd.get("image");
    let image: Buffer | null = null;
    if (file && typeof file !== "string" && file.size > 0) {
      if (file.size > productRules.proposed.maxUploadBytes) return { error: "Images must be 8 MB or smaller.", fields: { image: "Too large" }, values: v };
      image = Buffer.from(await file.arrayBuffer());
    }
    const r = await createSubmission(u, {
      applicationUrl: str(fd, "applicationUrl"), note: str(fd, "note"), title: str(fd, "title"), organizer: str(fd, "organizer"),
      category: (str(fd, "category") || undefined) as any, deadlineText: str(fd, "deadlineText"),
      idempotencyKey: str(fd, "idempotencyKey") || randomUUID(),
    }, image);
    id = r.id;
  } catch (e) {
    const s = toFormState(e, v);
    if (s.details?.field) s.fields = { [String(s.details.field)]: s.error ?? "Check this field" };
    return s;
  }
  revalidatePath("/home");
  redirect(`/submissions/${id}?new=1`);
}

export async function addInfoAction(_: FormState, fd: FormData): Promise<FormState> {
  const u = await requireUser();
  const id = str(fd, "id");
  try {
    await addSubmissionInformation(u, id, { deadlineText: str(fd, "deadlineText"), note: str(fd, "note"), title: str(fd, "title"), organizer: str(fd, "organizer") });
  } catch (e) {
    return toFormState(e, formValues(fd));
  }
  revalidatePath(`/submissions/${id}`);
  return { ok: true, message: "Thanks. We're checking it again." };
}

export async function withdrawSubmissionAction(fd: FormData) {
  const u = await requireUser();
  const id = str(fd, "id");
  await withdrawSubmission(u, id).catch(() => {});
  revalidatePath(`/submissions/${id}`);
}

export async function requestMatchAction(_: FormState, fd: FormData): Promise<FormState> {
  const u = await requireUser("/matches");
  let id: string;
  try {
    requireVerified(u);
    id = await asSelf(u, (c) => createMatch(c, u.id, {
      query: str(fd, "query"), category: (str(fd, "category") || undefined) as any,
      remoteOnly: fd.get("remoteOnly") === "on", freeOnly: fd.get("freeOnly") === "on",
    }));
  } catch (e) {
    return toFormState(e, formValues(fd));
  }
  redirect(`/matches/${id}`);
}

export async function redeemAction(_: FormState, fd: FormData): Promise<FormState> {
  const u = await requireUser();
  const id = str(fd, "matchId");
  let opp: string;
  try {
    requireVerified(u);
    const r = await asSelf(u, (c) => redeem(c, u.id, id));
    opp = r.opportunityId;
  } catch (e) {
    return toFormState(e);
  }
  revalidatePath("/", "layout");
  redirect(`/opportunities/${opp}?unlocked=1`);
}

export async function matchFeedbackAction(fd: FormData) {
  const u = await requireUser();
  const fb = str(fd, "feedback") === "useful" ? "useful" : "not_interested";
  await asSelf(u, (c) => matchFeedback(c, u.id, str(fd, "matchId"), fb));
  revalidatePath(`/matches/${str(fd, "matchId")}`);
}

export async function refundAction(_: FormState, fd: FormData): Promise<FormState> {
  const u = await requireUser();
  try {
    const reason = str(fd, "reason") as "expired_at_redemption" | "duplicate" | "clearly_ineligible";
    if (!["expired_at_redemption", "duplicate", "clearly_ineligible"].includes(reason)) return { error: "Choose a reason." };
    await asSelf(u, (c) => requestRefund(c, u.id, str(fd, "entitlementId"), reason, str(fd, "detail")));
  } catch (e) {
    return toFormState(e, formValues(fd));
  }
  revalidatePath("/credits");
  return { ok: true, message: "Thanks. A person will look at this and you'll get a notification with the outcome." };
}

export async function reportAction(_: FormState, fd: FormData): Promise<FormState> {
  const u = await requireUser();
  try {
    const reason = str(fd, "reason");
    if (!reason) return { error: "Choose what's wrong." };
    await asSelf(u, (c) => createReport(c, u.id, str(fd, "opportunityId"), reason, str(fd, "detail")));
  } catch (e) {
    return toFormState(e, formValues(fd));
  }
  return { ok: true, message: "Thanks for flagging this. We'll check the source." };
}

export async function directMatchAction(_: FormState, fd: FormData): Promise<FormState> {
  const u = await requireUser();
  let id: string;
  try {
    requireVerified(u);
    id = await asSelf(u, (c) => createDirectMatch(c, u.id, str(fd, "opportunityId")));
  } catch (e) {
    return toFormState(e);
  }
  redirect(`/matches/${id}`);
}
