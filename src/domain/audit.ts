import type { Db } from "@/db/tx";

export type Actor = { kind: "user" | "staff" | "worker" | "system"; id?: string | null };

const REDACT = /(password|token|secret|^notes?$|email)/i;
function redact(v: unknown): unknown {
  if (!v || typeof v !== "object") return v;
  if (Array.isArray(v)) return v.map(redact);
  return Object.fromEntries(
    Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, REDACT.test(k) ? "[redacted]" : redact(x)]),
  );
}

/** Append-only audit trail. The runtime roles cannot UPDATE or DELETE it. */
export async function audit(
  c: Db, actor: Actor, action: string, targetType: string, targetId: string | null,
  opts: { reason?: string; changes?: unknown; correlationId?: string } = {},
) {
  await c.query(
    `INSERT INTO audit_events(actor_kind, actor_id, action, target_type, target_id, reason, changes, correlation_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [actor.kind, actor.id ?? null, action, targetType, targetId, opts.reason ?? null,
     opts.changes === undefined ? null : JSON.stringify(redact(opts.changes)), opts.correlationId ?? null],
  );
}

/** Transactional outbox: written in the same transaction as the state change. */
export async function emit(
  c: Db, type: string, aggregateId: string, payload: Record<string, unknown> = {},
  revision?: number, correlationId?: string,
) {
  await c.query(
    `INSERT INTO domain_events(event_type, aggregate_id, aggregate_revision, payload, correlation_id)
     VALUES ($1,$2,$3,$4,$5)`,
    [type, aggregateId, revision ?? null, JSON.stringify(payload), correlationId ?? null],
  );
}

/** In-app notification, deduplicated by key. */
export async function notify(
  c: Db, userId: string, n: { kind: string; title: string; body: string; link?: string; dedupeKey?: string },
) {
  await c.query(
    `INSERT INTO notifications(user_id, kind, title, body, link, dedupe_key)
     VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (dedupe_key) DO NOTHING`,
    [userId, n.kind, n.title, n.body, n.link ?? null, n.dedupeKey ?? null],
  );
}
