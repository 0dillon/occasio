import type { Db } from "@/db/tx";

export type EmailPayload = { to: string; subject: string; text: string; kind: string };

/**
 * Queues a transactional email as a frozen notification attempt. The worker
 * sends it (provider adapter) outside any request transaction and records the
 * provider's answer. The idempotency key is reused on retries.
 */
export async function queueEmail(
  c: Db,
  e: { userId: string | null; to: string; subject: string; text: string; kind: string; dedupe: string; reminderId?: string },
) {
  await c.query(
    `INSERT INTO notification_attempts(reminder_id, user_id, channel, provider, idempotency_key, payload)
     VALUES ($1,$2,'email','pending',$3,$4) ON CONFLICT (idempotency_key) DO NOTHING`,
    [e.reminderId ?? null, e.userId, `email:${e.dedupe}`, JSON.stringify({ to: e.to, subject: e.subject, text: e.text, kind: e.kind })],
  );
}
