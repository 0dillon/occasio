import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { withStaff, withUser } from "@/db/tx";
import { correctOpportunity } from "@/domain/admin";
import { saveApplication, updateApplication } from "@/domain/applications";
import { createMatch, redeem } from "@/domain/matching";
import { dispatchOutbox } from "@/domain/outbox";
import { dispatchDueReminders } from "@/domain/reminders";
import { closePools, ownerQuery, resetDb } from "../helpers/db";
import { draft, makeUser, publish } from "../helpers/factory";

beforeEach(resetDb);
afterAll(closePools);

async function tracked(daysLeft = 20) {
  const u = await makeUser();
  const opp = await publish(draft({ daysLeft }));
  const m = await withUser(u.id, (c) => createMatch(c, u.id, { query: "" } as any));
  await withUser(u.id, (c) => redeem(c, u.id, m));
  const app = await withUser(u.id, (c) => saveApplication(c, u.id, opp));
  await dispatchOutbox();
  return { u, opp, app };
}
const reminders = (app: string) => ownerQuery("SELECT * FROM reminders WHERE application_id = $1 ORDER BY due_at", [app]);
const DAY = 86_400_000;

describe("reminder planning", () => {
  it("plans 7/3/1-day reminders on both channels from the persisted deadline", async () => {
    const { app } = await tracked();
    const rows = await reminders(app);
    expect(rows.filter((r) => r.state === "scheduled")).toHaveLength(6);
    expect(new Set(rows.map((r) => r.offset_minutes))).toEqual(new Set([10080, 4320, 1440]));
  });

  it("planning twice creates no duplicates", async () => {
    const { u, app } = await tracked();
    await withUser(u.id, (c) => updateApplication(c, u.id, app, { revision: 1, notes: "x" }));
    await dispatchOutbox();
    expect((await reminders(app)).filter((r) => r.state === "scheduled")).toHaveLength(6);
  });

  it("a corrected deadline cancels the old schedule and builds a new one", async () => {
    const { app, opp } = await tracked();
    const admin = await makeUser({ role: "admin" });
    const d = new Date(Date.now() + 40 * DAY).toISOString().slice(0, 10);
    await withStaff(admin.id, "admin", (c) => correctOpportunity(c, { id: admin.id, role: "admin" } as any, opp, {
      deadline: { sourceText: `Closes ${d} 17:00 UTC`, date: d, time: "17:00", timezone: "UTC", rolling: false }, reason: "Organizer extended the deadline",
    }));
    await dispatchOutbox();
    const rows = await reminders(app);
    expect(rows.filter((r) => r.state === "cancelled")).toHaveLength(6);
    const live = rows.filter((r) => r.state === "scheduled");
    expect(live).toHaveLength(6);
    expect(live.every((r) => r.deadline_revision === 2)).toBe(true);
    const n = await ownerQuery("SELECT title FROM notifications WHERE kind = 'opportunity_changed'");
    expect(n).toHaveLength(1);
  });

  it("a stale reminder whose deadline changed is suppressed at send time", async () => {
    const { app, opp } = await tracked();
    // Simulate a deadline change that has not been replanned yet.
    await ownerQuery("UPDATE opportunity_deadlines SET is_current = false WHERE opportunity_id = $1", [opp]);
    const r = await dispatchDueReminders(new Date(Date.now() + 14 * DAY));
    expect(r.sent).toBe(0);
    const rows = await reminders(app);
    expect(rows.some((x) => x.state_reason?.startsWith("Deadline changed"))).toBe(true);
  });

  it("submitted applications get no further reminders", async () => {
    const { u, app } = await tracked();
    await withUser(u.id, (c) => updateApplication(c, u.id, app, { revision: 1, status: "submitted", confirmSubmitted: true }));
    // Even before the replanner runs, the dispatcher re-checks current status.
    const r = await dispatchDueReminders(new Date(Date.now() + 19.5 * DAY));
    expect(r.sent).toBe(0);
    expect(r.suppressed).toBeGreaterThan(0);
  });

  it("after an outage, overdue reminders coalesce into one per channel", async () => {
    const { app } = await tracked();
    const r = await dispatchDueReminders(new Date(Date.now() + 19.5 * DAY));
    expect(r.sent).toBe(2); // one in-app, one email
    const sentRows = (await reminders(app)).filter((x) => x.state === "sent");
    expect(sentRows.every((x) => x.offset_minutes === 1440)).toBe(true);
    // A second dispatcher run sends nothing more.
    expect((await dispatchDueReminders(new Date(Date.now() + 19.5 * DAY))).sent).toBe(0);
  });

  it("quiet hours move reminders earlier, never later", async () => {
    const u = await makeUser();
    await ownerQuery("UPDATE notification_preferences SET quiet_start = '00:00', quiet_end = '23:59' WHERE user_id = $1", [u.id]);
    const opp = await publish(draft({ daysLeft: 20 }));
    const m = await withUser(u.id, (c) => createMatch(c, u.id, { query: "" } as any));
    await withUser(u.id, (c) => redeem(c, u.id, m));
    const app = await withUser(u.id, (c) => saveApplication(c, u.id, opp));
    await dispatchOutbox();
    const rows = await reminders(app);
    const [dl] = await ownerQuery("SELECT utc_instant FROM opportunity_deadlines WHERE opportunity_id = $1", [opp]);
    for (const r of rows) {
      expect(new Date(r.due_at).getTime()).toBeLessThanOrEqual(new Date(dl.utc_instant).getTime() - r.offset_minutes * 60_000);
    }
  });
});
