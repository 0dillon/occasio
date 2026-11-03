"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRecentAuth } from "@/domain/auth";
import { exportAccount, requestDeletion } from "@/domain/privacy";
import { updateNotifications, updateProfile } from "@/domain/profile";
import { formValues, str, toFormState, type FormState } from "@/server/action";
import { asSelf, clearSessionCookie, currentUser, requireUser } from "@/server/session";

const orNull = (s: string) => (s === "" ? null : s);

function readProfile(fd: FormData) {
  const interests = str(fd, "interests").split(",").map((s) => s.trim()).filter(Boolean);
  const citizenships = str(fd, "citizenships").split(",").map((s) => s.trim()).filter(Boolean);
  return {
    displayName: orNull(str(fd, "displayName")),
    country: orNull(str(fd, "country")),
    timezone: str(fd, "timezone") || undefined,
    categories: fd.getAll("categories").map(String) as any,
    interests,
    remoteOk: fd.get("remoteOk") === "on",
    freeOnly: fd.get("freeOnly") === "on",
    residenceCountry: orNull(str(fd, "residenceCountry")),
    citizenships: citizenships.length ? citizenships : null,
    educationLevel: orNull(str(fd, "educationLevel")) as any,
    ageBand: orNull(str(fd, "ageBand")) as any,
    experienceLevel: orNull(str(fd, "experienceLevel")) as any,
  };
}

export async function saveProfileAction(_: FormState, fd: FormData): Promise<FormState> {
  const u = await requireUser();
  const onboarding = fd.get("onboarding") === "1";
  try {
    await asSelf(u, (c) => updateProfile(c, u.id, { ...readProfile(fd), completeOnboarding: onboarding || undefined }));
  } catch (e) {
    return toFormState(e, formValues(fd));
  }
  revalidatePath("/", "layout");
  if (onboarding) redirect("/home?welcome=1");
  return { ok: true, message: "Saved. Matching uses these answers from now on." };
}

export async function skipOnboardingAction() {
  const u = await requireUser();
  await asSelf(u, (c) => updateProfile(c, u.id, { completeOnboarding: true }));
  redirect("/home");
}

export async function saveNotificationsAction(_: FormState, fd: FormData): Promise<FormState> {
  const u = await requireUser();
  try {
    await asSelf(u, (c) => updateNotifications(c, u.id, {
      emailEnabled: fd.get("emailEnabled") === "on",
      inAppEnabled: fd.get("inAppEnabled") === "on",
      quietStart: orNull(str(fd, "quietStart")),
      quietEnd: orNull(str(fd, "quietEnd")),
      offsets: fd.getAll("offsets").map(Number),
    }));
  } catch (e) {
    return toFormState(e, formValues(fd));
  }
  revalidatePath("/settings/notifications");
  return { ok: true, message: "Saved. Your reminders were rescheduled." };
}

export async function deleteAccountAction(_: FormState, fd: FormData): Promise<FormState> {
  const u = await requireUser();
  if (str(fd, "confirm") !== "DELETE") return { error: "Type DELETE to confirm.", fields: { confirm: "Type DELETE" } };
  try {
    requireRecentAuth(u);
    await asSelf(u, (c) => requestDeletion(c, u.id));
  } catch (e) {
    const s = toFormState(e);
    if (s.details?.reauth) redirect("/auth/reauth?next=/settings/account");
    return s;
  }
  await clearSessionCookie();
  redirect("/?deleted=1");
}

export async function exportAccountData() {
  const u = await currentUser();
  if (!u) return null;
  return asSelf(u, (c) => exportAccount(c, u.id));
}
