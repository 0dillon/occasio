import { z } from "zod";
import { type Db, many, one } from "@/db/tx";
import { audit, emit } from "./audit";
import { fail } from "./errors";

export const STATUSES = ["saved", "preparing", "submitted", "selected", "unsuccessful", "withdrawn"] as const;
export type AppStatus = (typeof STATUSES)[number];
export const STATUS_LABEL: Record<AppStatus, string> = {
  saved: "Saved", preparing: "Preparing", submitted: "Submitted (by you)", selected: "Selected",
  unsuccessful: "Not selected", withdrawn: "Withdrawn",
};

/** Any signed-in member can track a published opportunity (D12). Never costs a credit. */
export async function saveApplication(c: Db, userId: string, opportunityId: string) {
  const opp = await one<{ publication: string }>(c, "SELECT publication FROM opportunities WHERE id = $1", [opportunityId]);
  if (!opp || opp.publication !== "published") fail("not_found", "This opportunity isn't available to track.");
  const app = await one<{ id: string; created: boolean }>(
    c,
    `INSERT INTO applications(user_id, opportunity_id) VALUES ($1,$2)
     ON CONFLICT (user_id, opportunity_id) DO UPDATE SET updated_at = applications.updated_at
     RETURNING id, (xmax = 0) AS created`,
    [userId, opportunityId],
  );
  if (app!.created) {
    // Suggested tasks come from recorded source requirements, labelled as such.
    const reqs = await one<{ requirements: string[] }>(c, "SELECT requirements FROM opportunities WHERE id = $1", [opportunityId]);
    const tasks = [
      { title: "Read the official page and confirm eligibility", origin: "suggested" },
      ...(reqs?.requirements ?? []).map((r) => ({ title: r, origin: "source_requirement" })),
      { title: "Review and submit on the organizer's site", origin: "suggested" },
    ];
    for (const [i, t] of tasks.entries()) {
      await c.query("INSERT INTO application_tasks(application_id, user_id, title, origin, position) VALUES ($1,$2,$3,$4,$5)", [app!.id, userId, t.title.slice(0, 200), t.origin, i]);
    }
    await c.query("INSERT INTO application_status_history(application_id, user_id, to_status) VALUES ($1,$2,'saved')", [app!.id, userId]);
    await emit(c, "application.changed.v1", app!.id, { change: "created" }, 1);
    await audit(c, { kind: "user", id: userId }, "application.saved", "application", app!.id);
  }
  return app!.id;
}

export const listApplications = (c: Db, userId: string) =>
  many(
    c,
    `SELECT a.id, a.status, a.target_at, a.updated_at, a.submitted_at, o.id AS opportunity_id, o.title, o.category, o.availability, o.publication,
            (SELECT row_to_json(d) FROM opportunity_deadlines d WHERE d.opportunity_id = o.id AND d.is_current AND d.kind = 'application' LIMIT 1) AS deadline,
            (SELECT count(*)::int FROM application_tasks t WHERE t.application_id = a.id) AS task_total,
            (SELECT count(*)::int FROM application_tasks t WHERE t.application_id = a.id AND t.done_at IS NOT NULL) AS task_done,
            (SELECT t.title FROM application_tasks t WHERE t.application_id = a.id AND t.done_at IS NULL ORDER BY t.position LIMIT 1) AS next_task
       FROM applications a JOIN opportunities o ON o.id = a.opportunity_id
      WHERE a.user_id = $1 ORDER BY a.updated_at DESC`,
    [userId],
  );

export async function getApplication(c: Db, id: string) {
  if (!/^[0-9a-f-]{36}$/.test(id)) return null;
  const a = await one(
    c,
    `SELECT a.*, o.title, o.category, o.application_url, o.official_url, o.availability, o.publication, o.revision AS opp_revision
       FROM applications a JOIN opportunities o ON o.id = a.opportunity_id WHERE a.id = $1`,
    [id],
  );
  if (!a) return null;
  const tasks = await many(c, "SELECT * FROM application_tasks WHERE application_id = $1 ORDER BY position, created_at", [id]);
  const history = await many(c, "SELECT from_status, to_status, created_at FROM application_status_history WHERE application_id = $1 ORDER BY created_at", [id]);
  const deadline = await one(c, "SELECT * FROM opportunity_deadlines WHERE opportunity_id = $1 AND is_current AND kind = 'application'", [a.opportunity_id]);
  const reminders = await many(
    c,
    "SELECT id, kind, channel, due_at, state, state_reason FROM reminders WHERE application_id = $1 AND state IN ('scheduled','claimed','sent','suppressed') ORDER BY due_at",
    [id],
  );
  return { ...a, tasks, history, deadline: deadline ?? null, reminders };
}

const ALLOWED: Record<AppStatus, AppStatus[]> = {
  saved: ["preparing", "submitted", "withdrawn"],
  preparing: ["saved", "submitted", "withdrawn"],
  submitted: ["preparing", "selected", "unsuccessful", "withdrawn"], // "preparing" = undo an accidental mark
  selected: ["submitted"],
  unsuccessful: ["submitted"],
  withdrawn: ["saved", "preparing"],
};

export const updateSchema = z.object({
  status: z.enum(STATUSES).optional(),
  notes: z.string().max(5000).optional(),
  userReference: z.string().max(200).optional(),
  targetAt: z.coerce.date().nullable().optional(),
  revision: z.coerce.number().int().positive(),
  confirmSubmitted: z.boolean().optional(),
});

/**
 * Optimistic-revision update. "Submitted" is only ever the user's own
 * assertion, made explicitly; opening the application link never sets it.
 */
export async function updateApplication(c: Db, userId: string, id: string, raw: z.input<typeof updateSchema>) {
  const input = updateSchema.parse(raw);
  const a = await one(c, "SELECT * FROM applications WHERE id = $1 AND user_id = $2 FOR UPDATE", [id, userId]);
  if (!a) fail("not_found", "Application not found.");
  if (a.revision !== input.revision) fail("conflict", "This application changed in another tab. Reload and try again.");
  const sets: string[] = [];
  const vals: unknown[] = [id];
  const add = (col: string, v: unknown) => { vals.push(v); sets.push(`${col} = $${vals.length}`); };
  if (input.status && input.status !== a.status) {
    if (!ALLOWED[a.status as AppStatus].includes(input.status)) fail("invalid", `Can't move from ${a.status} to ${input.status}.`);
    if (input.status === "submitted") {
      if (!input.confirmSubmitted) fail("invalid", "Confirm that you submitted it on the organizer's site.");
      add("submitted_at", new Date());
      add("submission_reported_by", "user");
    }
    if (a.status === "submitted" && input.status === "preparing") {
      add("submitted_at", null);
      add("submission_reported_by", null);
    }
    add("status", input.status);
    await c.query("INSERT INTO application_status_history(application_id, user_id, from_status, to_status) VALUES ($1,$2,$3,$4)", [id, userId, a.status, input.status]);
  }
  if (input.notes !== undefined) add("notes", input.notes || null);
  if (input.userReference !== undefined) add("user_reference", input.userReference || null);
  if (input.targetAt !== undefined) add("target_at", input.targetAt);
  if (!sets.length) return a.revision as number;
  sets.push("revision = revision + 1");
  const r = await one<{ revision: number }>(c, `UPDATE applications SET ${sets.join(", ")} WHERE id = $1 RETURNING revision`, vals);
  await emit(c, "application.changed.v1", id, { status: input.status ?? a.status }, r!.revision);
  await audit(c, { kind: "user", id: userId }, "application.updated", "application", id, {
    changes: { status: input.status, targetAt: input.targetAt, notes: input.notes !== undefined ? "changed" : undefined },
  });
  return r!.revision;
}

export async function addTask(c: Db, userId: string, applicationId: string, title: string, targetDate: string | null) {
  const t = title.trim();
  if (!t || t.length > 200) fail("invalid", "Tasks need a title of up to 200 characters.");
  const a = await one(c, "SELECT id FROM applications WHERE id = $1 AND user_id = $2", [applicationId, userId]);
  if (!a) fail("not_found", "Application not found.");
  await c.query(
    `INSERT INTO application_tasks(application_id, user_id, title, target_date, position)
     VALUES ($1,$2,$3,$4,(SELECT coalesce(max(position),0)+1 FROM application_tasks WHERE application_id = $1))`,
    [applicationId, userId, t, targetDate && /^\d{4}-\d{2}-\d{2}$/.test(targetDate) ? targetDate : null],
  );
  await c.query("UPDATE applications SET status = 'preparing', revision = revision + 1 WHERE id = $1 AND status = 'saved'", [applicationId]);
}

export async function toggleTask(c: Db, userId: string, taskId: string, done: boolean) {
  const r = await c.query(
    "UPDATE application_tasks SET done_at = CASE WHEN $3 THEN now() ELSE NULL END WHERE id = $1 AND user_id = $2 RETURNING application_id",
    [taskId, userId, done],
  );
  if (!r.rowCount) fail("not_found", "Task not found.");
  const appId = r.rows[0].application_id;
  // Starting work moves a saved application to preparing.
  if (done) {
    const moved = await c.query("UPDATE applications SET status = 'preparing', revision = revision + 1 WHERE id = $1 AND status = 'saved' RETURNING id", [appId]);
    if (moved.rowCount) await c.query("INSERT INTO application_status_history(application_id, user_id, from_status, to_status) VALUES ($1,$2,'saved','preparing')", [appId, userId]);
  }
}

export async function deleteTask(c: Db, userId: string, taskId: string) {
  await c.query("DELETE FROM application_tasks WHERE id = $1 AND user_id = $2", [taskId, userId]);
}
