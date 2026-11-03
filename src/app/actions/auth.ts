"use server";
import { redirect } from "next/navigation";
import {
  reauthenticate, register, requestPasswordReset, resendVerification, resetPassword, signIn, signOut,
} from "@/domain/auth";
import { safeReturnPath } from "@/lib/urls";
import { formValues, str, toFormState, type FormState } from "@/server/action";
import { appOrigin, clearSessionCookie, clientIp, currentUser, sessionToken, setSessionCookie } from "@/server/session";
import { headers } from "next/headers";

export async function signUpAction(_: FormState, fd: FormData): Promise<FormState> {
  const v = formValues(fd);
  if (fd.get("terms") !== "on") return { error: "Please agree to the terms and privacy notice to continue.", fields: { terms: "Required" }, values: v };
  try {
    const r = await register({ email: str(fd, "email"), password: String(fd.get("password") ?? ""), ip: await clientIp(), origin: await appOrigin() });
    if (r.sessionToken) {
      await setSessionCookie(r.sessionToken);
      redirect("/onboarding");
    }
  } catch (e) {
    return toFormState(e, v);
  }
  // Same response whether or not the address already had an account.
  return { ok: true, message: "Check your email. If this address can be used, we've sent the next step there." };
}

export async function signInAction(_: FormState, fd: FormData): Promise<FormState> {
  const v = formValues(fd);
  let next = "/home";
  try {
    const token = await signIn({ email: str(fd, "email"), password: String(fd.get("password") ?? ""), ip: await clientIp(), userAgent: (await headers()).get("user-agent") });
    await setSessionCookie(token);
    next = safeReturnPath(str(fd, "next"));
  } catch (e) {
    return toFormState(e, v);
  }
  redirect(next);
}

export async function signOutAction() {
  await signOut(await sessionToken());
  await clearSessionCookie();
  redirect("/");
}

export async function resendVerificationAction(_: FormState): Promise<FormState> {
  const u = await currentUser();
  if (!u) redirect("/auth/sign-in");
  try {
    await resendVerification(u, await appOrigin());
    return { ok: true, message: "We sent a new confirmation link." };
  } catch (e) {
    return toFormState(e);
  }
}

export async function requestResetAction(_: FormState, fd: FormData): Promise<FormState> {
  try {
    await requestPasswordReset(str(fd, "email"), await clientIp(), await appOrigin());
  } catch (e) {
    return toFormState(e, formValues(fd));
  }
  return { ok: true, message: "If an account uses that address, a reset link is on its way. It expires in an hour." };
}

export async function resetPasswordAction(_: FormState, fd: FormData): Promise<FormState> {
  try {
    await resetPassword(str(fd, "token"), String(fd.get("password") ?? ""));
  } catch (e) {
    return toFormState(e);
  }
  await clearSessionCookie();
  redirect("/auth/sign-in?reset=1");
}

export async function reauthAction(_: FormState, fd: FormData): Promise<FormState> {
  const u = await currentUser();
  const token = await sessionToken();
  if (!u || !token) redirect("/auth/sign-in");
  try {
    await reauthenticate(u, token, String(fd.get("password") ?? ""));
  } catch (e) {
    return toFormState(e);
  }
  redirect(safeReturnPath(str(fd, "next"), "/settings/account"));
}
