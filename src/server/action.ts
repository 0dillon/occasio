import "server-only";
import { unstable_rethrow } from "next/navigation";
import { ZodError } from "zod";
import { UploadRejected } from "@/adapters/storage";
import { DomainError } from "@/domain/errors";
import { UrlPolicyError } from "@/lib/urls";

export type FormState = {
  ok?: boolean;
  message?: string;
  error?: string;
  fields?: Record<string, string>;
  /** Echoed values so a failed form keeps what the person typed. */
  values?: Record<string, string>;
  details?: Record<string, unknown>;
};

/** Turns expected failures into calm, specific form messages. Unexpected errors are logged, not shown. */
export function toFormState(e: unknown, values?: Record<string, string>): FormState {
  unstable_rethrow(e);
  if (e instanceof DomainError) return { error: e.message, details: e.details, values };
  if (e instanceof UrlPolicyError || e instanceof UploadRejected) return { error: e.message, values };
  if (e instanceof ZodError) {
    const fields: Record<string, string> = {};
    for (const i of e.issues) fields[String(i.path[0] ?? "form")] ??= i.message;
    return { error: "Check the highlighted fields.", fields, values };
  }
  console.error("[action] unexpected error", e);
  return { error: "Something went wrong on our side. Your data is safe; try again in a moment.", values };
}

export function formValues(fd: FormData): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of fd.entries()) if (typeof v === "string" && !k.startsWith("$") && !/password/i.test(k)) out[k] = v;
  return out;
}

export const str = (fd: FormData, k: string) => {
  const v = fd.get(k);
  return typeof v === "string" ? v.trim() : "";
};
