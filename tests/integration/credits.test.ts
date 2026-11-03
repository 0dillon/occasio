import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { withStaff, withUser } from "@/db/tx";
import { acceptSubmission, decideRefund, requestRefund } from "@/domain/exchange";
import { createMatch, redeem } from "@/domain/matching";
import { closePools, ownerQuery, resetDb } from "../helpers/db";
import { draft, makeUser, publish, setBalance } from "../helpers/factory";

const wallet = async (id: string) => (await ownerQuery("SELECT balance, starter_available FROM wallets WHERE user_id = $1", [id]))[0];
const ledgerSum = async (id: string) => Number((await ownerQuery("SELECT coalesce(sum(delta),0) AS s FROM credit_ledger WHERE user_id = $1", [id]))[0].s);

async function submission(userId: string, url: string) {
  const [s] = await ownerQuery(
    `INSERT INTO submissions(user_id, application_url, normalized_url, idempotency_key, status)
     VALUES ($1,$2,$2,$3,'review_required') RETURNING id`,
    [userId, url, `k-${Math.random()}`],
  );
  return s.id as string;
}

beforeEach(resetDb);
afterAll(closePools);

describe("contribution awards", () => {
  it("awards exactly one credit when two reviewers accept the same edition concurrently", async () => {
    const a = await makeUser();
    const b = await makeUser();
    const reviewer = await makeUser({ role: "reviewer" });
    const d = draft();
    const s1 = await submission(a.id, d.applicationUrl);
    const s2 = await submission(b.id, d.applicationUrl);
    const actor = { kind: "staff" as const, id: reviewer.id };
    const results = await Promise.allSettled([
      withStaff(reviewer.id, "reviewer", (c) => acceptSubmission(c, s1, d, actor)),
      withStaff(reviewer.id, "reviewer", (c) => acceptSubmission(c, s2, d, actor)),
    ]);
    const ok = results.filter((r) => r.status === "fulfilled").map((r) => (r as PromiseFulfilledResult<any>).value);
    expect(ok.filter((r) => r.kind === "published")).toHaveLength(1);
    const awards = await ownerQuery("SELECT * FROM contribution_awards");
    expect(awards).toHaveLength(1);
    const total = (await wallet(a.id)).balance + (await wallet(b.id)).balance;
    expect(total).toBe(1);
    expect(await ledgerSum(a.id)).toBe((await wallet(a.id)).balance);
    expect(await ledgerSum(b.id)).toBe((await wallet(b.id)).balance);
  });

  it("does not award again when the same submission is accepted twice", async () => {
    const a = await makeUser();
    const reviewer = await makeUser({ role: "reviewer" });
    const d = draft();
    const s = await submission(a.id, d.applicationUrl);
    const actor = { kind: "staff" as const, id: reviewer.id };
    await withStaff(reviewer.id, "reviewer", (c) => acceptSubmission(c, s, d, actor));
    await expect(withStaff(reviewer.id, "reviewer", (c) => acceptSubmission(c, s, d, actor))).rejects.toThrow(/accepted/);
    expect((await wallet(a.id)).balance).toBe(1);
  });
});

describe("redemption", () => {
  it("charges once when the same user redeems two matches with one credit concurrently", async () => {
    const u = await makeUser();
    await setBalance(u.id, 1, false);
    const o1 = await publish(draft({ category: "hackathon" }));
    const o2 = await publish(draft({ category: "grant" }));
    const m1 = await withUser(u.id, (c) => createMatch(c, u.id, { query: "", category: "hackathon" } as any));
    const m2 = await withUser(u.id, (c) => createMatch(c, u.id, { query: "", category: "grant" } as any));
    const sel = await ownerQuery("SELECT selected_opportunity_id AS o FROM match_requests WHERE id = ANY($1) ORDER BY created_at", [[m1, m2]]);
    expect(new Set(sel.map((r) => r.o))).toEqual(new Set([o1, o2]));
    const [r1, r2] = await Promise.allSettled([
      withUser(u.id, (c) => redeem(c, u.id, m1)),
      withUser(u.id, (c) => redeem(c, u.id, m2)),
    ]);
    const charged = [r1, r2].filter((r) => r.status === "fulfilled" && (r.value as any).charged);
    expect(charged).toHaveLength(1);
    expect((await wallet(u.id)).balance).toBe(0);
    expect(await ledgerSum(u.id)).toBe(0);
    const failed = [r1, r2].find((r) => r.status === "rejected") as PromiseRejectedResult | undefined;
    expect(String(failed?.reason?.message)).toMatch(/need a credit/i);
    expect(await ownerQuery("SELECT 1 FROM entitlements WHERE user_id = $1", [u.id])).toHaveLength(1);
  });

  it("replaying a redemption never charges twice", async () => {
    const u = await makeUser();
    await setBalance(u.id, 2, false);
    await publish();
    const m = await withUser(u.id, (c) => createMatch(c, u.id, { query: "" } as any));
    const results = await Promise.all([1, 2, 3].map(() => withUser(u.id, (c) => redeem(c, u.id, m)).catch((e) => e)));
    const charged = results.filter((r) => r && r.charged === true);
    expect(charged).toHaveLength(1);
    expect((await wallet(u.id)).balance).toBe(1);
  });

  it("uses the starter match first and never debits a credit for it", async () => {
    const u = await makeUser();
    await publish();
    const m = await withUser(u.id, (c) => createMatch(c, u.id, { query: "" } as any));
    const r = await withUser(u.id, (c) => redeem(c, u.id, m));
    expect(r.via).toBe("starter");
    expect(r.charged).toBe(false);
    const w = await wallet(u.id);
    expect(w.balance).toBe(0);
    expect(w.starter_available).toBe(false);
  });

  it("no match means no charge", async () => {
    const u = await makeUser();
    await setBalance(u.id, 1, false);
    const m = await withUser(u.id, (c) => createMatch(c, u.id, { query: "scholarship" } as any));
    const [mr] = await ownerQuery("SELECT state FROM match_requests WHERE id = $1", [m]);
    expect(mr.state).toBe("no_match");
    await expect(withUser(u.id, (c) => redeem(c, u.id, m))).rejects.toThrow();
    expect((await wallet(u.id)).balance).toBe(1);
  });

  it("does not charge when the opportunity closed between match and unlock", async () => {
    const u = await makeUser();
    await setBalance(u.id, 1, false);
    const opp = await publish();
    const m = await withUser(u.id, (c) => createMatch(c, u.id, { query: "" } as any));
    await ownerQuery("UPDATE opportunities SET availability = 'closed' WHERE id = $1", [opp]);
    await expect(withUser(u.id, (c) => redeem(c, u.id, m))).rejects.toThrow(/weren't charged/);
    expect((await wallet(u.id)).balance).toBe(1);
    expect(await ownerQuery("SELECT 1 FROM entitlements WHERE user_id = $1", [u.id])).toHaveLength(0);
  });

  it("excludes stale, ineligible-unknown and close date-only deadlines from matching", async () => {
    const u = await makeUser();
    await setBalance(u.id, 1, false);
    const stale = draft({ sourceCheckedAt: new Date(Date.now() - 100 * 3_600_000) });
    const closeDateOnly = draft({ daysLeft: 2 });
    closeDateOnly.deadline = { ...closeDateOnly.deadline, time: null, timezone: null };
    const incomplete = draft({ eligibilityComplete: false });
    await publish(stale);
    await publish(closeDateOnly);
    await publish(incomplete);
    const m = await withUser(u.id, (c) => createMatch(c, u.id, { query: "" } as any));
    const [mr] = await ownerQuery("SELECT state, explanation FROM match_requests WHERE id = $1", [m]);
    expect(mr.state).toBe("no_match");
    expect(Object.keys(mr.explanation.excluded).length).toBeGreaterThan(0);
  });

  it("an approved refund appends one compensating entry and never edits history", async () => {
    const u = await makeUser();
    const admin = await makeUser({ role: "admin" });
    await setBalance(u.id, 1, false);
    await publish();
    const m = await withUser(u.id, (c) => createMatch(c, u.id, { query: "" } as any));
    const r = await withUser(u.id, (c) => redeem(c, u.id, m));
    const refund = await withUser(u.id, (c) => requestRefund(c, u.id, r.entitlementId, "duplicate", "test"));
    const actor = { kind: "staff" as const, id: admin.id };
    await withStaff(admin.id, "admin", (c) => decideRefund(c, refund, true, "ok", actor));
    await expect(withStaff(admin.id, "admin", (c) => decideRefund(c, refund, true, "again", actor))).rejects.toThrow(/already/);
    expect((await wallet(u.id)).balance).toBe(1);
    expect(await ledgerSum(u.id)).toBe(1);
    await expect(ownerQuery("UPDATE credit_ledger SET delta = 5")).rejects.toThrow();
    await expect(ownerQuery("DELETE FROM credit_ledger")).rejects.toThrow();
  });
});
