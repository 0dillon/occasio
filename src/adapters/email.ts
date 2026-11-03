import type { Db } from "@/db/tx";
import type { EmailPayload } from "@/domain/outbound";

export type SendOutcome =
  | { status: "accepted"; providerMessageId: string | null }
  | { status: "failed"; error: string; transient: boolean }
  | { status: "uncertain"; error: string };

export interface EmailProvider {
  name: string;
  send(c: Db, payload: EmailPayload, idempotencyKey: string): Promise<SendOutcome>;
}

/**
 * Development mail sink. Nothing leaves the machine; messages are visible to
 * the signed-in recipient at /dev/mailbox and to staff at /admin/mail.
 * Never selected in production (see src/config/env.ts).
 */
export const devSink: EmailProvider = {
  name: "dev-sink",
  async send(c, p, key) {
    await c.query(
      "INSERT INTO dev_mail(to_address, subject, text_body, idempotency_key) VALUES ($1,$2,$3,$4) ON CONFLICT (idempotency_key) DO NOTHING",
      [p.to, p.subject, p.text, key],
    );
    return { status: "accepted", providerMessageId: `dev:${key}` };
  },
};

/**
 * Resend adapter (POST https://api.resend.com/emails). Resend documents an
 * Idempotency-Key header honoured for 24 hours; retries reuse the same key.
 * NOT exercised against the live API in this build: no account/key provided.
 */
export function resendProvider(apiKey: string, from: string): EmailProvider {
  return {
    name: "resend",
    async send(_c, p, key) {
      try {
        const r = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json", "idempotency-key": key.slice(0, 256) },
          body: JSON.stringify({ from, to: [p.to], subject: p.subject, text: p.text }),
          signal: AbortSignal.timeout(15_000),
        });
        if (r.ok) {
          const j = (await r.json().catch(() => ({}))) as { id?: string };
          return { status: "accepted", providerMessageId: j.id ?? null };
        }
        const transient = r.status === 429 || r.status >= 500;
        return { status: "failed", error: `HTTP ${r.status}`, transient };
      } catch (e) {
        // A timeout leaves acceptance unknown: reconcile, don't blindly resend with a new key.
        return { status: "uncertain", error: (e as Error).message.slice(0, 200) };
      }
    },
  };
}

export function getEmailProvider(): EmailProvider | null {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;
  if (key && from) return resendProvider(key, from);
  if (process.env.OCCASIO_MODE === "production") return null; // refuse to fake delivery
  return devSink;
}
