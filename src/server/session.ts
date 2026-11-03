import "server-only";
import { cookies, headers } from "next/headers";
import { forbidden, redirect } from "next/navigation";
import { cache } from "react";
import { productRules } from "@/config/product-rules";
import { withStaff, withUser, type Db } from "@/db/tx";
import { sessionUser, type SessionUser } from "@/domain/auth";
import { getProfile } from "@/domain/profile";

export const SESSION_COOKIE = "occasio_session";

/** Reads and verifies the session from the httpOnly cookie, once per request. */
export const currentUser = cache(async (): Promise<SessionUser | null> => {
  const jar = await cookies();
  return sessionUser(jar.get(SESSION_COOKIE)?.value);
});

export async function sessionToken() {
  return (await cookies()).get(SESSION_COOKIE)?.value;
}

export async function setSessionCookie(token: string) {
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: productRules.proposed.sessionDays * 86_400,
  });
}

export async function clearSessionCookie() {
  (await cookies()).delete(SESSION_COOKIE);
}

/** For pages: redirects to sign-in (with a safe return path) when signed out. */
export async function requireUser(returnTo = "/home"): Promise<SessionUser> {
  const u = await currentUser();
  if (!u) redirect(`/auth/sign-in?next=${encodeURIComponent(returnTo)}`);
  return u;
}

const RANK = { member: 0, reviewer: 1, operator: 2, admin: 3 } as const;
export async function requireStaff(min: "reviewer" | "operator" | "admin" = "reviewer"): Promise<SessionUser> {
  const u = await requireUser("/admin");
  if (RANK[u.role] < RANK[min]) forbidden();
  return u;
}

/** Runs a query in the signed-in user's row-security context. */
export function asUser<T>(u: SessionUser, fn: (c: Db) => Promise<T>) {
  return u.role === "member" ? withUser(u.id, fn) : withStaff(u.id, u.role, fn);
}
/** Member context even for staff accounts (their own data only). */
export function asSelf<T>(u: SessionUser, fn: (c: Db) => Promise<T>) {
  return withUser(u.id, fn);
}

export const currentProfile = cache(async () => {
  const u = await currentUser();
  if (!u) return null;
  return withUser(u.id, (c) => getProfile(c, u.id));
});

export async function clientIp() {
  const h = await headers();
  return (h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || "local").slice(0, 64);
}

export async function appOrigin() {
  return process.env.APP_ORIGIN ?? "http://localhost:3000";
}
