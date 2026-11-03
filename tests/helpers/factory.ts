import { randomUUID } from "node:crypto";
import { withWorker } from "@/db/tx";
import { register } from "@/domain/auth";
import { draftSchema, publishWithoutAward, type Draft } from "@/domain/exchange";
import { ownerQuery } from "./db";

/** Test-only data on reserved example domains. Never real opportunities. */
export async function makeUser(opts: { verified?: boolean; role?: string } = {}) {
  const email = `t-${randomUUID().slice(0, 8)}@example.test`;
  const r = await register({ email, password: "correct horse battery", ip: `10.0.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`, origin: "http://localhost:3000" });
  const id = r.userId!;
  if (opts.verified !== false) await ownerQuery("UPDATE users SET email_verified_at = now() WHERE id = $1", [id]);
  if (opts.role) await ownerQuery("UPDATE users SET role = $2 WHERE id = $1", [id, opts.role]);
  return { id, email, sessionToken: r.sessionToken! };
}

export function draft(over: Partial<Draft> & { daysLeft?: number } = {}): Draft {
  const days = over.daysLeft ?? 30;
  const d = new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
  const key = randomUUID().slice(0, 8);
  return draftSchema.parse({
    title: `Test fixture opportunity ${key}`,
    organizer: "Example Test Organizer",
    programme: `Test programme ${key}`,
    editionKey: "2026",
    category: "hackathon",
    summary: "Test fixture. Not a real opportunity.",
    applicationUrl: `https://apply.example.com/${key}`,
    locationMode: "remote",
    fee: "free",
    availability: "open",
    deadline: { sourceText: `Applications close ${d} 23:59 UTC`, date: d, time: "23:59", timezone: "UTC", rolling: false },
    eligibilityComplete: true,
    organizerTrust: "supported",
    sourceCheckedAt: new Date(),
    ...over,
  });
}

export async function publish(d: Draft = draft()) {
  const r = await withWorker((c) => publishWithoutAward(c, d, "fixture", { kind: "system" }, true));
  return r.opportunityId;
}

export async function setBalance(userId: string, balance: number, starter = false) {
  // Test setup only: keep the ledger consistent by appending a grant entry.
  if (balance > 0) {
    await ownerQuery(
      `INSERT INTO credit_ledger(user_id, delta, reason, business_key, actor_kind, note)
       VALUES ($1,$2,'correction',$3,'system','test grant')`,
      [userId, balance, `test-grant:${randomUUID()}`],
    );
  }
  await ownerQuery("UPDATE wallets SET balance = $2, starter_available = $3 WHERE user_id = $1", [userId, balance, starter]);
}
