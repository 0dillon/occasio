import { randomBytes } from "node:crypto";
import { productRules } from "@/config/product-rules";
import { type Db, many, one } from "@/db/tx";
import { audit, emit, notify } from "./audit";

/**
 * D14: members earn credits by bringing people to OCCASIO. A referral counts
 * when the invited person confirms their email; the worker awards it, once
 * per invited account, within a monthly limit per referrer.
 */
export const REFERRAL_COOKIE = "occasio_ref";
const CODE = /^[a-z0-9]{6,16}$/;

export const isReferralCode = (s: string | null | undefined): s is string => !!s && CODE.test(s);

function newCode() {
  const alphabet = "abcdefghjkmnpqrstuvwxyz23456789"; // no look-alikes
  const bytes = randomBytes(8);
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
}

/** The member's invite code, created on first use. */
export async function referralCode(c: Db, userId: string): Promise<string> {
  const existing = await one<{ code: string }>(c, "SELECT code FROM referral_codes WHERE user_id = $1", [userId]);
  if (existing) return existing.code;
  for (let i = 0; i < 5; i++) {
    const r = await one<{ code: string }>(
      c, "INSERT INTO referral_codes(user_id, code) VALUES ($1,$2) ON CONFLICT DO NOTHING RETURNING code", [userId, newCode()],
    );
    if (r) return r.code;
    const again = await one<{ code: string }>(c, "SELECT code FROM referral_codes WHERE user_id = $1", [userId]);
    if (again) return again.code;
  }
  throw new Error("could not create a referral code");
}

/** Called inside registration, with the new account's identity set. Unknown or own codes are ignored. */
export async function recordReferral(c: Db, referredId: string, code: string | null | undefined) {
  if (!isReferralCode(code)) return false;
  const owner = await one<{ user_id: string }>(c, "SELECT user_id FROM referral_codes WHERE code = $1", [code]);
  if (!owner || owner.user_id === referredId) return false;
  const r = await c.query(
    "INSERT INTO referrals(referred_id, referrer_id) VALUES ($1,$2) ON CONFLICT (referred_id) DO NOTHING", [referredId, owner.user_id],
  );
  return (r.rowCount ?? 0) > 0;
}

export async function referralSummary(c: Db, userId: string) {
  const rows = await many<{ joined: number; confirmed: number; credited: number }>(
    c,
    `SELECT count(*)::int AS joined,
            count(*) FILTER (WHERE u.email_verified_at IS NOT NULL)::int AS confirmed,
            count(*) FILTER (WHERE r.awarded_at IS NOT NULL)::int AS credited
       FROM referrals r JOIN users u ON u.id = r.referred_id
      WHERE r.referrer_id = $1`,
    [userId],
  );
  return rows[0] ?? { joined: 0, confirmed: 0, credited: 0 };
}

/**
 * Worker: award the referrer when the invited person confirms their email.
 * The ledger's unique business key makes retries and duplicates no-ops.
 */
export async function awardReferral(c: Db, referredId: string) {
  const ref = await one<{ referrer_id: string; awarded_at: Date | null }>(
    c, "SELECT referrer_id, awarded_at FROM referrals WHERE referred_id = $1 FOR UPDATE", [referredId],
  );
  if (!ref || ref.awarded_at) return { awarded: false, reason: ref ? "already" : "none" };
  const people = await one<{ ok: boolean }>(
    c,
    `SELECT (a.state = 'active' AND b.state = 'active' AND b.email_verified_at IS NOT NULL) AS ok
       FROM users a, users b WHERE a.id = $1 AND b.id = $2`,
    [ref.referrer_id, referredId],
  );
  if (!people?.ok) return { awarded: false, reason: "inactive" };
  const month = await one<{ n: number }>(
    c,
    `SELECT count(*)::int AS n FROM credit_ledger
      WHERE user_id = $1 AND reason = 'referral_award' AND created_at >= date_trunc('month', now())`,
    [ref.referrer_id],
  );
  const rules = productRules.proposed;
  if ((month?.n ?? 0) >= rules.maxReferralAwardsPerMonth) {
    await c.query("UPDATE referrals SET award_note = 'Monthly referral limit reached' WHERE referred_id = $1", [referredId]);
    return { awarded: false, reason: "limit" };
  }
  await c.query("SELECT 1 FROM wallets WHERE user_id = $1 FOR UPDATE", [ref.referrer_id]);
  const entry = await one<{ id: string }>(
    c,
    `INSERT INTO credit_ledger(user_id, delta, reason, business_key, reference_id, actor_kind, note)
     VALUES ($1,$2,'referral_award',$3,$4,'worker','Someone you invited joined')
     ON CONFLICT (business_key) DO NOTHING RETURNING id`,
    [ref.referrer_id, rules.creditsPerReferral, `referral:${referredId}`, referredId],
  );
  if (!entry) return { awarded: false, reason: "already" };
  await c.query("UPDATE wallets SET balance = balance + $2, updated_at = now() WHERE user_id = $1", [ref.referrer_id, rules.creditsPerReferral]);
  await c.query("UPDATE referrals SET awarded_at = now(), award_note = NULL WHERE referred_id = $1", [referredId]);
  await emit(c, "referral.awarded.v1", ref.referrer_id, { referred: referredId });
  await audit(c, { kind: "worker" }, "referral.awarded", "user", ref.referrer_id, { changes: { referred: referredId } });
  await notify(c, ref.referrer_id, {
    kind: "referral_awarded", title: "Someone you invited joined",
    body: `You earned ${rules.creditsPerReferral} credit${rules.creditsPerReferral === 1 ? "" : "s"}. Thanks for spreading the word.`,
    link: "/credits", dedupeKey: `referral:${referredId}`,
  });
  return { awarded: true, reason: null };
}
