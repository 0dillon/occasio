import { type Db, many, one, withWorker } from "@/db/tx";
import { DAY, formatInZone, localTime } from "@/lib/time";
import { audit, notify } from "./audit";
import { describeDeadline, planningCutoff, type DeadlineRecord } from "./deadlines";
import { queueEmail } from "./outbound";

type Prefs = { email_enabled: boolean; in_app_enabled: boolean; quiet_start: string | null; quiet_end: string | null; offsets_minutes: number[] };
type Desired = { kind: string; deadlineId: string | null; deadlineRevision: number | null; offset: number; channel: "email" | "in_app"; dueAt: Date; cutoffAt: Date | null; key: string };

const minutesOf = (t: string) => { const [h, m] = t.split(":").map(Number); return (h ?? 0) * 60 + (m ?? 0); };

/**
 * Quiet hours never push a reminder LATER (it could pass the deadline);
 * a reminder inside quiet hours moves EARLIER to just before they start.
 */
export function applyQuietHours(due: Date, tz: string, quietStart: string | null, quietEnd: string | null): Date {
  if (!quietStart || !quietEnd) return due;
  const s = minutesOf(quietStart);
  const e = minutesOf(quietEnd);
  const { minutes } = localTime(due, tz);
  const inQuiet = s <= e ? minutes >= s && minutes < e : minutes >= s || minutes < e;
  if (!inQuiet) return due;
  // Minutes elapsed since quiet start (handles windows crossing midnight).
  const since = (minutes - s + 1440) % 1440;
  return new Date(due.getTime() - (since + 1) * 60_000);
}

/** Computes the reminders an application should have right now. Pure. */
export function desiredReminders(input: {
  userId: string; applicationId: string; status: string; targetAt: Date | null; deadline: (DeadlineRecord & { id: string; revision: number }) | null;
  prefs: Prefs; tz: string; now: Date; availability: string; publication: string;
}): Desired[] {
  const { prefs, now } = input;
  if (!["saved", "preparing"].includes(input.status)) return [];
  if (input.availability === "closed" || input.publication === "hidden" || input.publication === "archived") return [];
  const channels = [prefs.email_enabled ? "email" : null, prefs.in_app_enabled ? "in_app" : null].filter(Boolean) as ("email" | "in_app")[];
  const out: Desired[] = [];
  const push = (kind: string, offset: number, due: Date, cutoff: Date | null, d: { id: string; revision: number } | null) => {
    const adjusted = applyQuietHours(due, input.tz, prefs.quiet_start, prefs.quiet_end);
    if (adjusted.getTime() <= now.getTime()) return;
    if (cutoff && adjusted.getTime() >= cutoff.getTime()) return;
    for (const ch of channels) {
      out.push({
        kind, deadlineId: d?.id ?? null, deadlineRevision: d?.revision ?? null, offset, channel: ch, dueAt: adjusted, cutoffAt: cutoff,
        key: [input.userId, input.applicationId, kind, d?.id ?? "none", d?.revision ?? 0, offset, ch].join(":"),
      });
    }
  };
  const d = input.deadline;
  if (d) {
    const cut = planningCutoff(d);
    if (cut && d.precision === "instant") {
      for (const off of prefs.offsets_minutes) push("official_deadline", off, new Date(cut.at.getTime() - off * 60_000), cut.at, d);
    } else if (cut && d.precision === "date_only") {
      // Date-based reminders against a labelled conservative cutoff.
      for (const off of prefs.offsets_minutes) push("date_only_deadline", off, new Date(cut.at.getTime() - off * 60_000), cut.at, d);
    } else {
      // Rolling/unknown: periodic check-ins instead of a fabricated countdown.
      for (let w = 1; w <= 4; w++) push("check_in", w * 7 * 1440, new Date(now.getTime() + w * 7 * DAY - (now.getTime() % DAY)), null, d);
    }
  }
  if (input.targetAt) {
    const t = new Date(input.targetAt);
    const cut = d ? planningCutoff(d)?.at ?? null : null;
    push("preparation_target", 1440, new Date(t.getTime() - DAY), cut, null);
    push("preparation_target", 0, t, cut, null);
  }
  return out;
}

/**
 * Reconciles persistent reminder rows with what should exist. Obsolete
 * scheduled rows (old deadline revision, changed target, preferences) are
 * cancelled; new ones are inserted with a unique logical key.
 */
export async function planApplication(c: Db, applicationId: string, now = new Date()) {
  const a = await one(
    c,
    `SELECT a.id, a.user_id, a.status, a.target_at, o.availability, o.publication, p.timezone
       FROM applications a JOIN opportunities o ON o.id = a.opportunity_id JOIN profiles p ON p.user_id = a.user_id
      WHERE a.id = $1`,
    [applicationId],
  );
  if (!a) return { inserted: 0, cancelled: 0 };
  const deadline = await one(c, "SELECT * FROM opportunity_deadlines d WHERE opportunity_id = (SELECT opportunity_id FROM applications WHERE id = $1) AND is_current AND kind = 'application'", [applicationId]);
  const prefs = await one<Prefs>(c, "SELECT * FROM notification_preferences WHERE user_id = $1", [a.user_id]);
  const desired = prefs
    ? desiredReminders({ userId: a.user_id, applicationId, status: a.status, targetAt: a.target_at, deadline: deadline ?? null, prefs, tz: a.timezone, now, availability: a.availability, publication: a.publication })
    : [];
  const keys = desired.map((d) => d.key);
  const cancelled = await c.query(
    `UPDATE reminders SET state = 'cancelled', state_reason = 'Replanned after a change'
      WHERE application_id = $1 AND state = 'scheduled' AND NOT (logical_key = ANY($2))`,
    [applicationId, keys],
  );
  let inserted = 0;
  for (const d of desired) {
    const r = await c.query(
      `INSERT INTO reminders(user_id, application_id, kind, deadline_id, deadline_revision, offset_minutes, channel, due_at, cutoff_at, logical_key)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT (logical_key) DO NOTHING`,
      [a.user_id, applicationId, d.kind, d.deadlineId, d.deadlineRevision, d.offset, d.channel, d.dueAt, d.cutoffAt, d.key],
    );
    inserted += r.rowCount ?? 0;
  }
  return { inserted, cancelled: cancelled.rowCount ?? 0 };
}

function reminderCopy(r: any, d: DeadlineRecord | null, title: string, tasksLeft: number, tz: string) {
  const official = describeDeadline(d, tz);
  const tasks = tasksLeft ? `You still have ${tasksLeft} checklist item${tasksLeft === 1 ? "" : "s"}.` : "Your checklist is done.";
  const head =
    r.kind === "preparation_target" ? `Your preparation target for ${title} is ${r.offset_minutes ? "tomorrow" : "now"}.`
      : r.kind === "check_in" ? `Check in on ${title}: it has no fixed deadline, so rounds can close without notice.`
        : `${title} closes ${r.offset_minutes >= 1440 ? `in ${Math.round(r.offset_minutes / 1440)} day${r.offset_minutes >= 2880 ? "s" : ""}` : "soon"}.`;
  const body = [head, tasks, `Official deadline: ${official.primary}.`, official.caution].filter(Boolean).join(" ");
  return { title: r.kind === "check_in" ? "Check in on an opportunity" : "What's your next step?", body };
}

/**
 * Sends due reminders. Claims a bounded batch with a lease (SKIP LOCKED), then
 * re-checks CURRENT state before each send: submitted/withdrawn apps, changed
 * deadline revisions, revoked channels and passed cutoffs are suppressed.
 * After an outage, overdue reminders for the same application+channel are
 * coalesced into one catch-up message instead of replaying the backlog.
 */
export async function dispatchDueReminders(now = new Date(), batch = 50) {
  const claimed = await withWorker((c) =>
    many<{ id: string }>(
      c,
      `UPDATE reminders SET state = 'claimed', lease_until = $1::timestamptz + interval '5 minutes', attempts = attempts + 1
        WHERE id IN (SELECT id FROM reminders
                      WHERE (state = 'scheduled' AND due_at <= $1) OR (state = 'claimed' AND lease_until < $1)
                      ORDER BY due_at FOR UPDATE SKIP LOCKED LIMIT $2)
        RETURNING id`,
      [now, batch],
    ),
  );
  let sent = 0;
  let suppressed = 0;
  for (const { id } of claimed) {
    await withWorker(async (c) => {
      const r = await one(
        c,
        `SELECT r.*, a.status AS app_status, a.opportunity_id, o.title, o.availability, o.publication, p.timezone, u.email, u.state AS user_state,
                np.email_enabled, np.in_app_enabled
           FROM reminders r JOIN applications a ON a.id = r.application_id JOIN opportunities o ON o.id = a.opportunity_id
           JOIN profiles p ON p.user_id = r.user_id JOIN users u ON u.id = r.user_id
           LEFT JOIN notification_preferences np ON np.user_id = r.user_id
          WHERE r.id = $1 FOR UPDATE OF r`,
        [id],
      );
      if (!r || r.state !== "claimed") return;
      const suppress = async (why: string) => {
        await c.query("UPDATE reminders SET state = 'suppressed', state_reason = $2, lease_until = NULL WHERE id = $1", [id, why]);
        suppressed++;
      };
      if (r.user_state !== "active") return suppress("Account not active");
      if (!["saved", "preparing"].includes(r.app_status)) return suppress(`Application is ${r.app_status}`);
      if (r.availability === "closed" || ["hidden", "archived"].includes(r.publication)) return suppress("Opportunity no longer open");
      if (r.channel === "email" && !r.email_enabled) return suppress("Email reminders turned off");
      if (r.channel === "in_app" && !r.in_app_enabled) return suppress("In-app reminders turned off");
      if (r.cutoff_at && new Date(r.cutoff_at).getTime() <= now.getTime()) return suppress("Deadline passed before sending");
      const d = r.deadline_id ? await one(c, "SELECT * FROM opportunity_deadlines WHERE id = $1", [r.deadline_id]) : null;
      if (r.deadline_id && (!d || !d.is_current || d.revision !== r.deadline_revision)) return suppress("Deadline changed; replaced by a new schedule");
      // Coalesce a backlog: if a LATER reminder for the same app+channel is also
      // overdue (pending or already sent in this run), this one is stale.
      const later = await one(
        c,
        `SELECT 1 FROM reminders WHERE application_id = $1 AND channel = $2 AND id <> $3 AND state IN ('scheduled','claimed','sent')
            AND due_at <= $4 AND due_at > $5`,
        [r.application_id, r.channel, id, now, r.due_at],
      );
      if (later) return suppress("Coalesced with a later overdue reminder");
      const deadline = (await one(c, "SELECT * FROM opportunity_deadlines WHERE opportunity_id = $1 AND is_current AND kind = 'application'", [r.opportunity_id])) ?? null;
      const tasksLeft = (await one<{ n: number }>(c, "SELECT count(*)::int AS n FROM application_tasks WHERE application_id = $1 AND done_at IS NULL", [r.application_id]))!.n;
      const copy = reminderCopy(r, deadline, r.title, tasksLeft, r.timezone);
      if (r.channel === "in_app") {
        await notify(c, r.user_id, { kind: "reminder", title: copy.title, body: copy.body, link: `/applications/${r.application_id}`, dedupeKey: `reminder:${r.logical_key}` });
      } else {
        await queueEmail(c, {
          userId: r.user_id, to: r.email, kind: "reminder", reminderId: id, dedupe: `reminder:${r.logical_key}`,
          subject: `${copy.title} · ${r.title}`.slice(0, 180),
          text: `${copy.body}\n\nOpen your checklist: ${process.env.APP_ORIGIN ?? ""}/applications/${r.application_id}\n\nManage reminders: ${process.env.APP_ORIGIN ?? ""}/settings/notifications`,
        });
      }
      await c.query("UPDATE reminders SET state = 'sent', lease_until = NULL WHERE id = $1", [id]);
      sent++;
    });
  }
  return { claimed: claimed.length, sent, suppressed };
}

/** Replans every application affected by an event (outbox consumer). */
export async function replanForOpportunity(c: Db, opportunityId: string) {
  const apps = await many<{ id: string }>(c, "SELECT id FROM applications WHERE opportunity_id = $1", [opportunityId]);
  for (const a of apps) await planApplication(c, a.id);
  return apps.length;
}

export async function replanForUser(c: Db, userId: string) {
  const apps = await many<{ id: string }>(c, "SELECT id FROM applications WHERE user_id = $1", [userId]);
  for (const a of apps) await planApplication(c, a.id);
}

export function describeReminder(r: { kind: string; channel: string; due_at: Date; state: string }, tz: string) {
  const what = { official_deadline: "Deadline reminder", date_only_deadline: "Deadline reminder (date only)", preparation_target: "Preparation target", check_in: "Check-in" }[r.kind] ?? r.kind;
  return `${what} · ${r.channel === "email" ? "Email" : "In app"} · ${formatInZone(new Date(r.due_at), tz)}`;
}

export async function auditReminderChange(c: Db, userId: string, what: string) {
  await audit(c, { kind: "user", id: userId }, `reminders.${what}`, "user", userId);
}
