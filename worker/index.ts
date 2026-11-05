import { pathToFileURL } from "node:url";
import { closePools } from "@/db/pool";
import { one, withWorker } from "@/db/tx";
import { crawlDueSources, recheckDue, triageCandidates } from "@/domain/discovery";
import { dispatchEmails } from "@/domain/dispatch";
import { dispatchOutbox, reconcileLedger } from "@/domain/outbox";
import { processDeletions, purgeExpiredAssets } from "@/domain/privacy";
import { dispatchDueReminders } from "@/domain/reminders";
import { processNextSubmission } from "@/domain/verification";

/**
 * Trusted, long-running worker. Database rows are the source of truth for
 * every schedule (no in-memory timers per deadline); this loop only claims
 * due work with leases, so restarts and multiple instances are safe.
 * Queues are prioritised: user-facing verification and reminders run every
 * tick; crawling and rechecks run less often and cannot starve them.
 */
type Job = { name: string; everyMs: number; run: () => Promise<unknown>; last?: number };

const jobs: Job[] = [
  { name: "verify-submissions", everyMs: 2_000, run: async () => { let n = 0; while (n < 5 && (await processNextSubmission())) n++; return { processed: n }; } },
  { name: "outbox", everyMs: 2_000, run: () => dispatchOutbox() },
  { name: "reminders", everyMs: 15_000, run: () => dispatchDueReminders() },
  { name: "email", everyMs: 5_000, run: () => dispatchEmails() },
  { name: "discovery-crawl", everyMs: 60_000, run: () => crawlDueSources() },
  { name: "discovery-triage", everyMs: 30_000, run: () => triageCandidates() },
  { name: "freshness-recheck", everyMs: 60_000, run: () => recheckDue() },
  { name: "privacy-erasure", everyMs: 60_000, run: () => processDeletions() },
  { name: "retention-purge", everyMs: 3_600_000, run: () => purgeExpiredAssets() },
  { name: "ledger-reconcile", everyMs: 3_600_000, run: async () => {
    const bad = await reconcileLedger();
    if (bad.length) throw new Error(`wallet/ledger mismatch for ${bad.length} wallet(s): ${bad.map((b) => b.user_id).join(", ")}`);
    return { mismatches: 0 };
  } },
];

async function record(name: string, fn: () => Promise<unknown>) {
  const run = await withWorker((c) => one<{ id: number }>(c, "INSERT INTO job_runs(job) VALUES ($1) RETURNING id", [name]));
  try {
    const out = await fn();
    const items = out && typeof out === "object" ? Object.values(out as Record<string, unknown>).find((v) => typeof v === "number") ?? 0 : 0;
    await withWorker((c) => c.query("UPDATE job_runs SET finished_at = now(), status = 'ok', items = $2, detail = $3 WHERE id = $1", [run!.id, items, JSON.stringify(out).slice(0, 500)]));
  } catch (e) {
    console.error(`[worker] ${name} failed:`, (e as Error).message);
    await withWorker((c) => c.query("UPDATE job_runs SET finished_at = now(), status = 'error', detail = $2 WHERE id = $1", [run!.id, (e as Error).message.slice(0, 500)]));
  }
}

let stopping = false;
export async function tick(now = Date.now()) {
  for (const j of jobs) {
    if (stopping) return;
    if (j.last && now - j.last < j.everyMs) continue;
    j.last = now;
    await record(j.name, j.run);
  }
}

async function main() {
  console.log("[worker] started");
  // Keep only recent job records so the operations view stays useful.
  await withWorker((c) => c.query("DELETE FROM job_runs WHERE started_at < now() - interval '7 days'"));
  while (!stopping) {
    await tick();
    await new Promise((r) => setTimeout(r, 1_000));
  }
  await closePools();
  console.log("[worker] stopped cleanly");
}

for (const sig of ["SIGINT", "SIGTERM"] as const) process.on(sig, () => { stopping = true; });
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) void main();
