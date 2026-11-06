"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { DomainError } from "@/domain/errors";
import { createAlert, deleteAlert } from "@/domain/perks";
import { str } from "@/server/action";
import { asSelf, requireUser } from "@/server/session";

/** Saves the current Discover filters as an alert. Errors come back on the page as ?alert=… */
export async function createAlertAction(fd: FormData) {
  const u = await requireUser("/discover");
  const query = { q: str(fd, "q"), category: str(fd, "category") || undefined, remote: str(fd, "remote") || undefined, free: str(fd, "free") || undefined, open: str(fd, "open") || undefined };
  let msg = "saved";
  try {
    await asSelf(u, (c) => createAlert(c, u.id, query));
  } catch (e) {
    if (!(e instanceof DomainError)) throw e;
    msg = e.message;
  }
  revalidatePath("/credits");
  const p = new URLSearchParams(Object.entries(query).filter(([, v]) => v) as [string, string][]);
  p.set("alert", msg);
  redirect(`/discover?${p.toString()}`);
}

export async function deleteAlertAction(fd: FormData) {
  const u = await requireUser("/credits");
  await asSelf(u, (c) => deleteAlert(c, u.id, str(fd, "id")));
  revalidatePath("/credits");
}
