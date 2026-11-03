import { getEmailProvider, type EmailProvider } from "@/adapters/email";
import { productRules } from "@/config/product-rules";
import { many, one, withWorker } from "@/db/tx";

/**
 * Email dispatcher. Each attempt row carries a frozen payload and a stable
 * idempotency key. The provider call happens outside any transaction.
 * Provider accepted ≠ delivered ≠ read; statuses say exactly which we know.
 */
export async function dispatchEmails(provider: EmailProvider | null = getEmailProvider(), batch = 25) {
  const flag = await withWorker((c) => one<{ value: boolean }>(c, "SELECT value FROM app_flags WHERE key = 'email_enabled'"));
  if (!provider || flag?.value === false) return { claimed: 0, accepted: 0, failed: 0, uncertain: 0, skipped: true };
  const delays = productRules.proposed.notificationRetryDelaysSeconds;
  const rows = await withWorker((c) =>
    many<{ id: string; idempotency_key: string; payload: any; attempt_no: number }>(
      c,
      `UPDATE notification_attempts SET provider = $1, updated_at = now(),
              error = NULL, status = 'pending'
        WHERE id IN (SELECT id FROM notification_attempts
                      WHERE channel = 'email' AND (
                        (status = 'pending' AND (provider = 'pending' OR updated_at < now() - interval '5 minutes'))
                        OR (status = 'failed' AND error LIKE 'transient:%' AND updated_at < now() - make_interval(secs => $3)
                            AND created_at > now() - interval '23 hours')
                        -- Uncertain acceptance: retry with the SAME key only inside the
                        -- provider's 24h idempotency window; afterwards it stays for review.
                        OR (status = 'uncertain' AND updated_at < now() - interval '10 minutes'
                            AND created_at > now() - interval '23 hours'))
                      ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT $2)
        RETURNING id, idempotency_key, payload, 0 AS attempt_no`,
      [provider.name, batch, delays[0] ?? 30],
    ),
  );
  const out = { claimed: rows.length, accepted: 0, failed: 0, uncertain: 0, skipped: false };
  for (const r of rows) {
    const res = await withWorker((c) => provider.send(c, r.payload, r.idempotency_key));
    await withWorker(async (c) => {
      if (res.status === "accepted") {
        // Drop one-time links from the stored payload once the provider has it.
        await c.query(
          `UPDATE notification_attempts SET status = 'accepted', provider_message_id = $2,
                  payload = jsonb_set(payload, '{text}', to_jsonb(regexp_replace(payload->>'text', 'token=[A-Za-z0-9_-]+', 'token=[sent]', 'g'))),
                  updated_at = now() WHERE id = $1`,
          [r.id, res.providerMessageId],
        );
        out.accepted++;
      } else if (res.status === "uncertain") {
        await c.query("UPDATE notification_attempts SET status = 'uncertain', error = $2, updated_at = now() WHERE id = $1", [r.id, res.error]);
        out.uncertain++;
      } else {
        await c.query("UPDATE notification_attempts SET status = 'failed', error = $2, updated_at = now() WHERE id = $1", [
          r.id, `${res.transient ? "transient" : "permanent"}: ${res.error}`,
        ]);
        out.failed++;
      }
    });
  }
  return out;
}
