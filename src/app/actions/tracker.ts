"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { addTask, deleteTask, saveApplication, toggleTask, updateApplication } from "@/domain/applications";
import { formValues, str, toFormState, type FormState } from "@/server/action";
import { zonedToUtc } from "@/lib/time";
import { asSelf, currentProfile, requireUser } from "@/server/session";

export async function saveApplicationAction(_: FormState, fd: FormData): Promise<FormState> {
  const u = await requireUser();
  let id: string;
  try {
    id = await asSelf(u, (c) => saveApplication(c, u.id, str(fd, "opportunityId")));
  } catch (e) {
    return toFormState(e);
  }
  redirect(`/applications/${id}`);
}

export async function updateApplicationAction(_: FormState, fd: FormData): Promise<FormState> {
  const u = await requireUser();
  const id = str(fd, "id");
  try {
    // datetime-local has no zone: interpret it in the person's profile timezone.
    const raw = str(fd, "targetAt");
    const tz = (await currentProfile())?.timezone ?? "UTC";
    const m = raw.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/);
    const target = m ? zonedToUtc(m[1]!, m[2]!, tz) : null;
    await asSelf(u, (c) => updateApplication(c, u.id, id, {
      revision: Number(str(fd, "revision")),
      status: (str(fd, "status") || undefined) as any,
      confirmSubmitted: fd.get("confirmSubmitted") === "on",
      ...(fd.has("notes") ? { notes: str(fd, "notes") } : {}),
      ...(fd.has("userReference") ? { userReference: str(fd, "userReference") } : {}),
      ...(fd.has("targetAt") ? { targetAt: target } : {}),
    }));
  } catch (e) {
    return toFormState(e, formValues(fd));
  }
  revalidatePath(`/applications/${id}`);
  revalidatePath("/applications");
  return { ok: true, message: "Saved." };
}

export async function addTaskAction(_: FormState, fd: FormData): Promise<FormState> {
  const u = await requireUser();
  const id = str(fd, "applicationId");
  try {
    await asSelf(u, (c) => addTask(c, u.id, id, str(fd, "title"), str(fd, "targetDate") || null));
  } catch (e) {
    return toFormState(e, formValues(fd));
  }
  revalidatePath(`/applications/${id}`);
  return { ok: true };
}

export async function toggleTaskAction(fd: FormData) {
  const u = await requireUser();
  await asSelf(u, (c) => toggleTask(c, u.id, str(fd, "taskId"), str(fd, "done") === "1"));
  revalidatePath(`/applications/${str(fd, "applicationId")}`);
}

export async function deleteTaskAction(fd: FormData) {
  const u = await requireUser();
  await asSelf(u, (c) => deleteTask(c, u.id, str(fd, "taskId")));
  revalidatePath(`/applications/${str(fd, "applicationId")}`);
}

export async function markNotificationsReadAction(fd: FormData) {
  const u = await requireUser();
  const id = str(fd, "id");
  await asSelf(u, (c) => id
    ? c.query("UPDATE notifications SET read_at = now() WHERE id = $1 AND user_id = $2 AND read_at IS NULL", [id, u.id])
    : c.query("UPDATE notifications SET read_at = now() WHERE user_id = $1 AND read_at IS NULL", [u.id]));
  revalidatePath("/", "layout");
}
