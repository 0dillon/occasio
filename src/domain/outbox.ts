import { many, one, withWorker } from "@/db/tx";
import { notify } from "./audit";
import { planApplication, replanForOpportunity } from "./reminders";

type Handler = (e: { id: string; event_type: string; aggregate_id: string; payload: any }) => Promise<void>;

/**
 * Consumers are idempotent: a receipt row (consumer, event_id) is written in
 * the same transaction as the effect, so a redelivered event is a no-op.
 */
const consumers: Record<string, { name: string; run: Handler }[]> = {
  "application.changed.v1": [{
    name: "reminder-planner",
    run: (e) => withWorker(async (c) => { await planApplication(c, e.aggregate_id); }),
  }],
  "opportunity.changed.v1": [{
    name: "reminder-replanner",
    run: (e) => withWorker(async (c) => { await replanForOpportunity(c, e.aggregate_id); }),
  }, {
    name: "affected-user-alerts",
    run: (e) => withWorker(async (c) => {
      if (!["deadline_corrected", "hidden", "withdrawn"].includes(e.payload?.change)) return;
      const o = await one(c, "SELECT title FROM opportunities WHERE id = $1", [e.aggregate_id]);
      const users = await many<{ user_id: string; id: string }>(c, "SELECT user_id, id FROM applications WHERE opportunity_id = $1 AND status IN ('saved','preparing')", [e.aggregate_id]);
      for (const u of users) {
        await notify(c, u.user_id, {
          kind: "opportunity_changed",
          title: e.payload.change === "deadline_corrected" ? "Deadline changed" : "Opportunity withdrawn",
          body: e.payload.change === "deadline_corrected"
            ? `The deadline for ${o?.title} was corrected. Review your preparation target.`
            : `${o?.title} is no longer available for new applications. ${e.payload.reason ?? ""}`.trim(),
          link: `/applications/${u.id}`, dedupeKey: `opp-change:${e.id}:${u.user_id}`,
        });
      }
    }),
  }],
};

export async function dispatchOutbox(batch = 50) {
  const events = await withWorker((c) =>
    many(c, `UPDATE domain_events SET lease_until = now() + interval '2 minutes'
              WHERE id IN (SELECT id FROM domain_events WHERE dispatched_at IS NULL AND (lease_until IS NULL OR lease_until < now())
                            ORDER BY occurred_at FOR UPDATE SKIP LOCKED LIMIT $1)
              RETURNING id, event_type, aggregate_id, payload`, [batch]),
  );
  let handled = 0;
  for (const e of events) {
    for (const consumer of consumers[e.event_type] ?? []) {
      const done = await withWorker((c) => one(c, "SELECT 1 FROM processed_events WHERE consumer = $1 AND event_id = $2", [consumer.name, e.id]));
      if (done) continue;
      await consumer.run(e);
      await withWorker((c) => c.query("INSERT INTO processed_events(consumer, event_id) VALUES ($1,$2) ON CONFLICT DO NOTHING", [consumer.name, e.id]));
      handled++;
    }
    await withWorker((c) => c.query("UPDATE domain_events SET dispatched_at = now() WHERE id = $1", [e.id]));
  }
  return { events: events.length, handled };
}

/** Wallet vs ledger reconciliation. Never edits history; reports mismatches. */
export async function reconcileLedger() {
  return withWorker((c) =>
    many<{ user_id: string; balance: number; ledger_sum: number }>(
      c,
      `SELECT w.user_id, w.balance, coalesce(sum(l.delta), 0)::int AS ledger_sum
         FROM wallets w LEFT JOIN credit_ledger l ON l.user_id = w.user_id
        GROUP BY w.user_id, w.balance HAVING w.balance <> coalesce(sum(l.delta), 0)`,
    ),
  );
}
