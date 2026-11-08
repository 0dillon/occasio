import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { withStaff, withUser } from "@/db/tx";
import { acceptSubmission } from "@/domain/exchange";
import { dispatchOutbox } from "@/domain/outbox";
import { createAlert, getPerks, listAlerts, sharedBy } from "@/domain/perks";
import { closePools, ownerQuery, resetDb } from "../helpers/db";
import { draft, makeUser, publish } from "../helpers/factory";

beforeEach(resetDb);
afterAll(closePools);

/** Test setup: record n contribution awards in the ledger (as the worker would). */
async function earn(userId: string, n: number) {
  for (let i = 0; i < n; i++) {
    await ownerQuery(
      `INSERT INTO credit_ledger(user_id, delta, reason, business_key, actor_kind) VALUES ($1, 1, 'contribution_award', $2, 'system')`,
      [userId, `test-award:${randomUUID()}`],
    );
  }
  await ownerQuery("UPDATE wallets SET balance = balance + $2 WHERE user_id = $1", [userId, n]);
}

describe("contributor perks (D13)", () => {
  it("perks follow credits earned, not the balance", async () => {
    const u = await makeUser();
    expect(await withUser(u.id, (c) => getPerks(c, u.id))).toMatchObject({ earned: 0, contributorBadge: false, personalAlerts: false });
    await earn(u.id, 3);
    await ownerQuery("UPDATE wallets SET balance = 0 WHERE user_id = $1", [u.id]); // spending later keeps the perk
    expect(await withUser(u.id, (c) => getPerks(c, u.id))).toMatchObject({ earned: 3, contributorBadge: true, personalAlerts: true });
  });

  it("refuses alerts below the threshold and for an empty filter", async () => {
    const u = await makeUser();
    await earn(u.id, 2);
    await expect(withUser(u.id, (c) => createAlert(c, u.id, { category: "hackathon" }))).rejects.toThrow(/open up at 3 credits/);
    await earn(u.id, 1);
    await expect(withUser(u.id, (c) => createAlert(c, u.id, {}))).rejects.toThrow(/at least one filter/);
    const a = await withUser(u.id, (c) => createAlert(c, u.id, { category: "hackathon", remote: "1" }));
    const again = await withUser(u.id, (c) => createAlert(c, u.id, { remote: "1", category: "hackathon" }));
    expect(again).toBe(a);
    expect(await withUser(u.id, (c) => listAlerts(c, u.id))).toHaveLength(1);
  });

  it("alerts matching members once when a listing is published, and nobody else", async () => {
    const fan = await makeUser();
    const other = await makeUser();
    const below = await makeUser();
    await earn(fan.id, 3);
    await earn(other.id, 3);
    await withUser(fan.id, (c) => createAlert(c, fan.id, { category: "hackathon" }));
    await withUser(other.id, (c) => createAlert(c, other.id, { category: "job" }));
    // A saved search left over from before the member reached the threshold must not fire.
    await ownerQuery("INSERT INTO saved_searches(user_id, query) VALUES ($1, '{\"category\":\"hackathon\"}')", [below.id]);

    const opp = await publish(draft({ category: "hackathon" }));
    await dispatchOutbox();
    await dispatchOutbox();
    const notes = await ownerQuery("SELECT user_id FROM notifications WHERE kind = 'alert'");
    expect(notes.map((n) => n.user_id)).toEqual([fan.id]);
    const mails = await ownerQuery("SELECT user_id, payload FROM notification_attempts WHERE idempotency_key LIKE 'email:alert:%'");
    expect(mails).toHaveLength(1);
    expect(mails[0].payload.text).toContain(`/opportunities/${opp}`);
  });

  it("marks a listing as shared by the member whose submission created it", async () => {
    const sharer = await makeUser();
    const viewer = await makeUser();
    const reviewer = await makeUser({ role: "reviewer" });
    const d = draft();
    const [s] = await ownerQuery(
      `INSERT INTO submissions(user_id, application_url, normalized_url, idempotency_key, status)
       VALUES ($1,$2,$2,$3,'review_required') RETURNING id`, [sharer.id, d.applicationUrl, `k-${randomUUID()}`]);
    const r: any = await withStaff(reviewer.id, "reviewer", (c) => acceptSubmission(c, s.id, d, { kind: "staff", id: reviewer.id }));
    expect(await withUser(sharer.id, (c) => sharedBy(c, r.opportunityId, sharer.id))).toBe(true);
    expect(await withUser(viewer.id, (c) => sharedBy(c, r.opportunityId, viewer.id))).toBe(false);
  });
});
