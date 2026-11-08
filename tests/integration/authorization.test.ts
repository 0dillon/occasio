import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { withAnon, withUser } from "@/db/tx";
import { getDetail, getPreview } from "@/domain/catalog";
import { createMatch, redeem } from "@/domain/matching";
import { saveApplication, updateApplication } from "@/domain/applications";
import { closePools, ownerQuery, resetDb } from "../helpers/db";
import { makeUser, publish } from "../helpers/factory";

beforeEach(resetDb);
afterAll(closePools);

async function unlockedApp() {
  const u = await makeUser();
  const opp = await publish();
  const m = await withUser(u.id, (c) => createMatch(c, u.id, { query: "" } as any));
  await withUser(u.id, (c) => redeem(c, u.id, m));
  const app = await withUser(u.id, (c) => saveApplication(c, u.id, opp));
  return { u, opp, app, m };
}

describe("row security between accounts", () => {
  it("one user cannot read another user's wallet, ledger, applications, matches or notifications", async () => {
    const { u, app, m } = await unlockedApp();
    const other = await makeUser();
    const tables = ["wallets", "credit_ledger", "applications", "application_tasks", "match_requests", "entitlements", "notifications", "reminders", "submissions", "profiles", "user_eligibility"];
    for (const t of tables) {
      const rows = await withUser(other.id, (c) => c.query(`SELECT * FROM ${t} WHERE user_id = $1`, [u.id]));
      expect(rows.rowCount, t).toBe(0);
    }
    const appRow = await withUser(other.id, (c) => c.query("SELECT 1 FROM applications WHERE id = $1", [app]));
    expect(appRow.rowCount).toBe(0);
    const cands = await withUser(other.id, (c) => c.query("SELECT 1 FROM match_candidates WHERE match_request_id = $1", [m]));
    expect(cands.rowCount).toBe(0);
  });

  it("one user cannot change another user's application", async () => {
    const { app } = await unlockedApp();
    const other = await makeUser();
    await expect(withUser(other.id, (c) => updateApplication(c, other.id, app, { revision: 1, status: "preparing" }))).rejects.toThrow(/not found/i);
    const upd = await withUser(other.id, (c) => c.query("UPDATE applications SET notes = 'x' WHERE id = $1", [app]));
    expect(upd.rowCount).toBe(0);
  });

  it("a user cannot grant themselves credits or roles through the app role", async () => {
    const u = await makeUser();
    await expect(withUser(u.id, (c) => c.query(
      "INSERT INTO credit_ledger(user_id, delta, reason, business_key, actor_kind) VALUES ($1, 5, 'correction', 'self', 'user')", [u.id]))).rejects.toThrow();
    const r = await withUser(u.id, (c) => c.query("UPDATE users SET role = 'admin' WHERE id = $1", [u.id]).catch((e) => e));
    const [row] = await ownerQuery("SELECT role FROM users WHERE id = $1", [u.id]);
    expect(row.role).toBe("member");
    expect(r instanceof Error || r.rowCount === 0).toBe(true);
  });

  it("anonymous visitors get previews without links; any signed-in member gets full details (D12)", async () => {
    const opp = await publish();
    const member = await makeUser();
    const preview = await withAnon((c) => getPreview(c, opp, null));
    expect(preview).not.toBeNull();
    expect(JSON.stringify(preview)).not.toContain("apply.example.com");
    expect(await withAnon((c) => getDetail(c, opp, null))).toBeNull();
    const d = await withUser(member.id, (c) => getDetail(c, opp, member.id));
    expect(d?.application_url).toContain("apply.example.com");
  });

  it("any signed-in member can track a published opportunity without spending a credit", async () => {
    const opp = await publish();
    const member = await makeUser();
    const app = await withUser(member.id, (c) => saveApplication(c, member.id, opp));
    expect(app).toBeTruthy();
    const [w] = await ownerQuery("SELECT balance FROM wallets WHERE user_id = $1", [member.id]);
    expect(Number(w.balance)).toBe(0);
  });

  it("a withdrawn listing stays hidden from members who never tracked it", async () => {
    const opp = await publish();
    const member = await makeUser();
    await ownerQuery("UPDATE opportunities SET publication = 'hidden' WHERE id = $1", [opp]);
    expect(await withUser(member.id, (c) => getDetail(c, opp, member.id))).toBeNull();
  });

  it("an entitled user gets the application link", async () => {
    const { u, opp } = await unlockedApp();
    const d = await withUser(u.id, (c) => getDetail(c, opp, u.id));
    expect(d?.application_url).toContain("apply.example.com");
  });

  it("opening the link never marks an application submitted; it needs explicit confirmation", async () => {
    const { u, app } = await unlockedApp();
    await expect(withUser(u.id, (c) => updateApplication(c, u.id, app, { revision: 1, status: "preparing" }))).resolves.toBe(2);
    await expect(withUser(u.id, (c) => updateApplication(c, u.id, app, { revision: 2, status: "submitted" }))).rejects.toThrow(/Confirm/);
    await expect(withUser(u.id, (c) => updateApplication(c, u.id, app, { revision: 2, status: "submitted", confirmSubmitted: true }))).resolves.toBe(3);
    const [a] = await ownerQuery("SELECT status, submission_reported_by FROM applications WHERE id = $1", [app]);
    expect(a).toEqual({ status: "submitted", submission_reported_by: "user" });
  });

  it("rejects stale writes from another tab", async () => {
    const { u, app } = await unlockedApp();
    await withUser(u.id, (c) => updateApplication(c, u.id, app, { revision: 1, notes: "a" }));
    await expect(withUser(u.id, (c) => updateApplication(c, u.id, app, { revision: 1, notes: "b" }))).rejects.toThrow(/another tab/);
  });
});
