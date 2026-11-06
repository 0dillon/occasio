import { z } from "zod";
import { productRules } from "@/config/product-rules";
import { type Db, many, one } from "@/db/tx";
import { notify } from "./audit";
import { CATEGORIES, CATEGORY_LABEL } from "./catalog";
import { DomainError } from "./errors";
import { queueEmail } from "./outbound";

/**
 * Contributor perks (D13). A perk is reached by credits EARNED from shared
 * opportunities over the account's lifetime; reaching one never spends a
 * credit, and later spending never takes a perk away.
 */
const T = () => productRules.proposed.perkThresholds;

export type Perks = {
  earned: number;
  contributorBadge: boolean;
  personalAlerts: boolean;
  thresholds: { contributorBadge: number; personalAlerts: number };
};

export async function earnedCredits(c: Db, userId: string): Promise<number> {
  const r = await one<{ n: number }>(
    c,
    "SELECT coalesce(sum(delta), 0)::int AS n FROM credit_ledger WHERE user_id = $1 AND reason = 'contribution_award'",
    [userId],
  );
  return r?.n ?? 0;
}

export function perksFor(earned: number): Perks {
  const t = T();
  return {
    earned,
    contributorBadge: earned >= t.contributorBadge,
    personalAlerts: earned >= t.personalAlerts,
    thresholds: { ...t },
  };
}

export async function getPerks(c: Db, userId: string) {
  return perksFor(await earnedCredits(c, userId));
}

/** True when this member's share created this listing. */
export async function sharedBy(c: Db, opportunityId: string, userId: string) {
  return !!(await one(c, "SELECT 1 FROM contribution_awards WHERE opportunity_id = $1 AND user_id = $2", [opportunityId, userId]));
}

// ------------------------------------------------------------------ alerts

export const alertQuerySchema = z.object({
  q: z.string().trim().max(120).optional().default(""),
  category: z.enum(CATEGORIES).optional().catch(undefined),
  remote: z.enum(["1"]).optional().catch(undefined),
  free: z.enum(["1"]).optional().catch(undefined),
  open: z.enum(["1"]).optional().catch(undefined),
});
export type AlertQuery = z.infer<typeof alertQuerySchema>;

/** Plain-words description of an alert's filters. */
export function describeAlert(q: AlertQuery) {
  const parts = [
    q.category ? CATEGORY_LABEL[q.category] + "s" : "Any kind",
    q.q ? `matching "${q.q}"` : null,
    q.remote ? "remote" : null,
    q.free ? "no fee" : null,
    q.open ? "open now" : null,
  ].filter(Boolean);
  return parts.join(", ");
}

function normalise(q: AlertQuery) {
  const out: Record<string, string> = {};
  if (q.q) out.q = q.q;
  for (const k of ["category", "remote", "free", "open"] as const) if (q[k]) out[k] = q[k]!;
  return out;
}

export async function listAlerts(c: Db, userId: string) {
  return many<{ id: string; query: AlertQuery; label: string | null; created_at: Date }>(
    c, "SELECT id, query, label, created_at FROM saved_searches WHERE user_id = $1 AND alerts_enabled ORDER BY created_at", [userId],
  );
}

export async function createAlert(c: Db, userId: string, raw: unknown) {
  const perks = await getPerks(c, userId);
  if (!perks.personalAlerts) {
    throw new DomainError("forbidden", `Alerts open up once ${perks.thresholds.personalAlerts} of your shared opportunities have been added. You're at ${perks.earned}.`);
  }
  const q = normalise(alertQuerySchema.parse(raw));
  if (!Object.keys(q).length) throw new DomainError("invalid", "Pick at least one filter or search term, or the alert would fire for everything.");
  const existing = await listAlerts(c, userId);
  if (existing.some((a) => JSON.stringify(normalise(a.query)) === JSON.stringify(q))) return existing.find((a) => JSON.stringify(normalise(a.query)) === JSON.stringify(q))!.id;
  if (existing.length >= productRules.proposed.maxAlertSearches) {
    throw new DomainError("invalid", `You can keep up to ${productRules.proposed.maxAlertSearches} alerts. Remove one first.`);
  }
  const r = await one<{ id: string }>(
    c, "INSERT INTO saved_searches(user_id, query, label, alerts_enabled) VALUES ($1, $2, $3, true) RETURNING id",
    [userId, JSON.stringify(q), describeAlert(q as AlertQuery).slice(0, 120)],
  );
  return r!.id;
}

export async function deleteAlert(c: Db, userId: string, id: string) {
  await c.query("DELETE FROM saved_searches WHERE id = $1 AND user_id = $2", [id, userId]);
}

/**
 * Worker: when a listing is published, tell each member whose alert matches.
 * One notice per member per listing (dedupe key). Members below the alerts
 * threshold, inactive accounts and the person who shared it are skipped.
 */
export async function alertForPublishedOpportunity(c: Db, opportunityId: string) {
  const rows = await many<{ user_id: string; email: string; label: string | null; title: string; email_enabled: boolean | null; in_app_enabled: boolean | null }>(
    c,
    `SELECT DISTINCT ON (s.user_id) s.user_id, u.email, s.label, o.title, np.email_enabled, np.in_app_enabled
       FROM saved_searches s
       JOIN users u ON u.id = s.user_id AND u.state = 'active' AND u.email_verified_at IS NOT NULL
       JOIN opportunities o ON o.id = $1 AND o.publication = 'published'
       LEFT JOIN notification_preferences np ON np.user_id = s.user_id
      WHERE s.alerts_enabled
        AND (coalesce(s.query->>'q', '') = '' OR o.search @@ websearch_to_tsquery('english', s.query->>'q'))
        AND (s.query->>'category' IS NULL OR o.category::text = s.query->>'category')
        AND (s.query->>'remote' IS NULL OR o.location_mode = 'remote')
        AND (s.query->>'free' IS NULL OR o.fee = 'free')
        AND (s.query->>'open' IS NULL OR o.availability IN ('open', 'rolling'))
        AND NOT EXISTS (SELECT 1 FROM contribution_awards a WHERE a.opportunity_id = o.id AND a.user_id = s.user_id)
        AND (SELECT coalesce(sum(l.delta), 0) FROM credit_ledger l
              WHERE l.user_id = s.user_id AND l.reason = 'contribution_award') >= $2
      ORDER BY s.user_id, s.created_at`,
    [opportunityId, T().personalAlerts],
  );
  for (const r of rows) {
    const body = `${r.title} was just added and matches your alert${r.label ? ` (${r.label})` : ""}.`;
    if (r.in_app_enabled !== false) {
      await notify(c, r.user_id, { kind: "alert", title: "New match for your alert", body, link: `/opportunities/${opportunityId}`, dedupeKey: `alert:${opportunityId}:${r.user_id}` });
    }
    if (r.email_enabled !== false) {
      const origin = process.env.APP_ORIGIN ?? "";
      await queueEmail(c, {
        userId: r.user_id, to: r.email, kind: "alert", dedupe: `alert:${opportunityId}:${r.user_id}`,
        subject: `New on OCCASIO · ${r.title}`.slice(0, 180),
        text: `${body}\n\nSee it: ${origin}/opportunities/${opportunityId}\n\nManage your alerts: ${origin}/credits`,
      });
    }
  }
  return { alerted: rows.length };
}
