import { z } from "zod";
import { productRules } from "@/config/product-rules";
import { type Db, one, withAnon } from "@/db/tx";
import { hashPassword, newToken, sha256, verifyPassword } from "@/lib/security";
import { audit } from "./audit";
import { DomainError, fail } from "./errors";
import { queueEmail } from "./outbound";

export const emailSchema = z.string().trim().toLowerCase().email().max(254);
export const passwordSchema = z
  .string()
  .min(10, "Use at least 10 characters.")
  .max(200, "Use at most 200 characters.");

export type SessionUser = {
  id: string;
  email: string;
  role: "member" | "reviewer" | "operator" | "admin";
  emailVerified: boolean;
  state: "active" | "frozen" | "deleted";
  authenticatedAt: Date;
};

/**
 * Counts an attempt in its own committed transaction, so a failed attempt
 * (which rolls back the caller's transaction) is still counted.
 */
export async function countAttempt(bucket: string, limit: number, windowSeconds: number) {
  await withAnon((c) => rateLimit(c, bucket, limit, windowSeconds));
}

/** Fixed-window limiter stored in Postgres so it survives restarts and scales across instances. */
export async function rateLimit(c: Db, bucket: string, limit: number, windowSeconds: number) {
  const r = await one<{ count: number }>(
    c,
    `INSERT INTO rate_limits(bucket, window_start, count)
     VALUES ($1, to_timestamp(floor(extract(epoch FROM now()) / $2) * $2), 1)
     ON CONFLICT (bucket, window_start) DO UPDATE SET count = rate_limits.count + 1
     RETURNING count`,
    [bucket, windowSeconds],
  );
  if ((r?.count ?? 0) > limit) {
    fail("rate_limited", "Too many attempts. Wait a few minutes and try again.", { retryAfterSeconds: windowSeconds });
  }
}

async function createAuthToken(c: Db, userId: string, kind: "verify_email" | "reset_password", minutes: number) {
  const token = newToken();
  await c.query(
    `INSERT INTO auth_tokens(user_id, kind, token_hash, expires_at) VALUES ($1,$2,$3, now() + make_interval(mins => $4))`,
    [userId, kind, sha256(token), minutes],
  );
  return token;
}

/**
 * Registers an account. To avoid revealing whether an address is registered,
 * the caller always shows the same "check your email" response.
 */
export async function register(input: { email: string; password: string; ip: string; origin: string }) {
  const email = emailSchema.parse(input.email);
  const password = passwordSchema.parse(input.password);
  const hash = await hashPassword(password);
  return withAnon(async (c) => {
    await rateLimit(c, `register:ip:${input.ip}`, 10, 3600);
    const created = await one<{ id: string }>(
      c,
      `INSERT INTO users(email, password_hash) VALUES ($1,$2) ON CONFLICT (email) DO NOTHING RETURNING id`,
      [email, hash],
    );
    if (!created) {
      const existing = await one<{ id: string }>(c, "SELECT id FROM users WHERE email = $1", [email]);
      if (existing) {
        await queueEmail(c, {
          userId: existing.id, to: email, kind: "account_exists",
          subject: "Someone tried to create an OCCASIO account with your email",
          text: `An account already exists for this address. If this was you, sign in at ${input.origin}/auth/sign-in or reset your password at ${input.origin}/auth/reset.`,
          dedupe: `account_exists:${existing.id}:${new Date().toISOString().slice(0, 13)}`,
        });
      }
      return { userId: null as string | null, sessionToken: null as string | null };
    }
    const id = created.id;
    // Wallet/profile rows are created with the user; RLS requires the identity.
    await c.query("SELECT set_config('occasio.user_id', $1, true)", [id]);
    await c.query("INSERT INTO profiles(user_id) VALUES ($1)", [id]);
    await c.query("INSERT INTO user_preferences(user_id) VALUES ($1)", [id]);
    await c.query("INSERT INTO user_eligibility(user_id) VALUES ($1)", [id]);
    await c.query(
      "INSERT INTO notification_preferences(user_id, offsets_minutes) VALUES ($1,$2)",
      [id, productRules.proposed.reminderOffsetsMinutes],
    );
    await c.query("INSERT INTO wallets(user_id, starter_available) VALUES ($1,$2)", [
      id, productRules.proposed.starterMatchEnabled,
    ]);
    await c.query(
      "INSERT INTO user_consents(user_id, kind, version) VALUES ($1,'terms_and_privacy','draft-2026-11-03')",
      [id],
    );
    const token = await createAuthToken(c, id, "verify_email", 60 * 24);
    await queueEmail(c, {
      userId: id, to: email, kind: "verify_email",
      subject: "Confirm your email for OCCASIO",
      text: `Confirm your email to start sharing and finding opportunities:\n${input.origin}/auth/verify?token=${token}\n\nThis link expires in 24 hours. If you didn't sign up, ignore this email.`,
      dedupe: `verify:${sha256(token)}`,
    });
    await audit(c, { kind: "user", id }, "account.registered", "user", id);
    const sessionToken = await createSession(c, id, null);
    return { userId: id, sessionToken };
  });
}

export async function createSession(c: Db, userId: string, userAgent: string | null) {
  const token = newToken();
  await c.query(
    `INSERT INTO sessions(token_hash, user_id, expires_at, user_agent)
     VALUES ($1,$2, now() + make_interval(days => $3), $4)`,
    [sha256(token), userId, productRules.proposed.sessionDays, userAgent?.slice(0, 200) ?? null],
  );
  return token;
}

export async function signIn(input: { email: string; password: string; ip: string; userAgent: string | null }) {
  const parsed = emailSchema.safeParse(input.email);
  await countAttempt(`signin:ip:${input.ip}`, 30, 900);
  if (parsed.success) await countAttempt(`signin:email:${parsed.data}`, 10, 900);
  return withAnon(async (c) => {
    const user = parsed.success
      ? await one<{ id: string; password_hash: string | null; state: string }>(
          c, "SELECT id, password_hash, state FROM users WHERE email = $1", [parsed.data])
      : undefined;
    const ok = await verifyPassword(input.password, user?.password_hash ?? null);
    if (!user || !ok || user.state === "deleted") {
      fail("unauthenticated", "That email and password don't match an account.");
    }
    await audit(c, { kind: "user", id: user!.id }, "session.created", "user", user!.id);
    return createSession(c, user!.id, input.userAgent);
  });
}

export async function sessionUser(token: string | undefined): Promise<SessionUser | null> {
  if (!token || token.length > 100) return null;
  return withAnon(async (c) => {
    const row = await one(
      c,
      `SELECT u.id, u.email, u.role, u.email_verified_at, u.state, s.authenticated_at
         FROM sessions s JOIN users u ON u.id = s.user_id
        WHERE s.token_hash = $1 AND s.expires_at > now() AND u.state <> 'deleted'`,
      [sha256(token)],
    );
    if (!row) return null;
    return {
      id: row.id, email: row.email, role: row.role, emailVerified: !!row.email_verified_at,
      state: row.state, authenticatedAt: row.authenticated_at,
    };
  });
}

export async function signOut(token: string | undefined) {
  if (!token) return;
  await withAnon((c) => c.query("DELETE FROM sessions WHERE token_hash = $1", [sha256(token)]));
}

export async function verifyEmail(token: string) {
  return withAnon(async (c) => {
    const row = await one<{ user_id: string }>(
      c,
      `UPDATE auth_tokens SET used_at = now()
        WHERE token_hash = $1 AND kind = 'verify_email' AND used_at IS NULL AND expires_at > now()
        RETURNING user_id`,
      [sha256(token)],
    );
    if (!row) fail("invalid", "This confirmation link is invalid or has expired.");
    await c.query("UPDATE users SET email_verified_at = coalesce(email_verified_at, now()) WHERE id = $1", [row!.user_id]);
    await audit(c, { kind: "user", id: row!.user_id }, "account.email_verified", "user", row!.user_id);
    return row!.user_id;
  });
}

export async function resendVerification(user: SessionUser, origin: string) {
  if (user.emailVerified) return;
  await withAnon(async (c) => {
    await rateLimit(c, `verify-resend:${user.id}`, 3, 3600);
    const token = await createAuthToken(c, user.id, "verify_email", 60 * 24);
    await queueEmail(c, {
      userId: user.id, to: user.email, kind: "verify_email",
      subject: "Confirm your email for OCCASIO",
      text: `Confirm your email:\n${origin}/auth/verify?token=${token}\n\nThis link expires in 24 hours.`,
      dedupe: `verify:${sha256(token)}`,
    });
  });
}

/** Always succeeds from the caller's view; never reveals whether the address exists. */
export async function requestPasswordReset(email: string, ip: string, origin: string) {
  const parsed = emailSchema.safeParse(email);
  await withAnon(async (c) => {
    await rateLimit(c, `reset:ip:${ip}`, 10, 3600);
    if (!parsed.success) return;
    await rateLimit(c, `reset:email:${parsed.data}`, 3, 3600);
    const user = await one<{ id: string }>(c, "SELECT id FROM users WHERE email = $1 AND state <> 'deleted'", [parsed.data]);
    if (!user) return;
    const token = await createAuthToken(c, user.id, "reset_password", 60);
    await queueEmail(c, {
      userId: user.id, to: parsed.data, kind: "reset_password",
      subject: "Reset your OCCASIO password",
      text: `Use this link within an hour to choose a new password:\n${origin}/auth/reset?token=${token}\n\nIf you didn't ask for this, you can ignore it.`,
      dedupe: `reset:${sha256(token)}`,
    });
  });
}

export async function resetPassword(token: string, password: string) {
  const pw = passwordSchema.parse(password);
  const hash = await hashPassword(pw);
  await withAnon(async (c) => {
    const row = await one<{ user_id: string }>(
      c,
      `UPDATE auth_tokens SET used_at = now()
        WHERE token_hash = $1 AND kind = 'reset_password' AND used_at IS NULL AND expires_at > now()
        RETURNING user_id`,
      [sha256(token)],
    );
    if (!row) fail("invalid", "This reset link is invalid or has expired.");
    await c.query("UPDATE users SET password_hash = $1, email_verified_at = coalesce(email_verified_at, now()) WHERE id = $2", [hash, row!.user_id]);
    // Recovering an account ends every existing session.
    await c.query("DELETE FROM sessions WHERE user_id = $1", [row!.user_id]);
    await audit(c, { kind: "user", id: row!.user_id }, "account.password_reset", "user", row!.user_id);
  });
}

/** Sensitive actions (deletion, email change) need a recent password check. */
export async function reauthenticate(user: SessionUser, sessionToken: string, password: string) {
  await countAttempt(`reauth:${user.id}`, 10, 900);
  await withAnon(async (c) => {
    const row = await one<{ password_hash: string }>(c, "SELECT password_hash FROM users WHERE id = $1", [user.id]);
    if (!(await verifyPassword(password, row?.password_hash ?? null))) fail("unauthenticated", "That password isn't right.");
    await c.query("UPDATE sessions SET authenticated_at = now() WHERE token_hash = $1", [sha256(sessionToken)]);
  });
}

export function requireRecentAuth(user: SessionUser) {
  const age = Date.now() - user.authenticatedAt.getTime();
  if (age > productRules.proposed.recentAuthMinutes * 60_000) {
    throw new DomainError("forbidden", "Confirm your password to continue.", { reauth: true });
  }
}

export function requireVerified(user: SessionUser) {
  if (!user.emailVerified) fail("forbidden", "Confirm your email address first.", { verifyEmail: true });
  if (user.state === "frozen") fail("frozen", "Your account is paused while we review it. Contact support.");
}

export const isStaff = (u: SessionUser) => u.role !== "member";
