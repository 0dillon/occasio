import Link from "next/link";
import { notFound } from "next/navigation";
import { addTaskAction, deleteTaskAction, toggleTaskAction, updateApplicationAction } from "@/app/actions/tracker";
import { Bento, Tile, TileHead } from "@/components/Bento";
import { ActionForm, Field, Submit } from "@/components/Form";
import { Icon } from "@/components/Icon";
import { DeadlineBlock } from "@/components/Opportunity";
import { getApplication, STATUS_LABEL, type AppStatus } from "@/domain/applications";
import { describeReminder } from "@/domain/reminders";
import { formatInZone } from "@/lib/time";
import { hostOf } from "@/lib/urls";
import { asSelf, currentProfile, requireUser } from "@/server/session";

export const metadata = { title: "Application" };
const NEXT: Record<AppStatus, AppStatus[]> = {
  saved: ["preparing", "submitted", "withdrawn"], preparing: ["submitted", "saved", "withdrawn"],
  submitted: ["selected", "unsuccessful", "preparing", "withdrawn"], selected: ["submitted"], unsuccessful: ["submitted"], withdrawn: ["preparing"],
};

function toLocalInput(d: Date | null, tz: string) {
  if (!d) return "";
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(d));
  const g = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
  return `${g("year")}-${g("month")}-${g("day")}T${g("hour")}:${g("minute")}`;
}

export default async function ApplicationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser(`/applications/${id}`);
  const tz = (await currentProfile())?.timezone ?? "UTC";
  const a = await asSelf(user, (c) => getApplication(c, id));
  if (!a || a.user_id !== user.id) notFound();
  const done = a.tasks.filter((t: any) => t.done_at).length;
  const closed = a.publication !== "published" || a.availability === "closed";
  return (
    <div className="page">
      <header className="page-head">
        <div className="stack-sm">
          <span className="badge outline" style={{ alignSelf: "start" }}>{STATUS_LABEL[a.status as AppStatus]}</span>
          <h1>{a.title}</h1>
          <Link href={`/opportunities/${a.opportunity_id}`} className="meta">Opportunity details</Link>
        </div>
      </header>
      {closed ? <div className="alert warn" style={{ marginBottom: 24 }}><strong>This opportunity is no longer open for new applications.</strong>Reminders have stopped. Your notes and checklist stay here.</div> : null}
      <Bento>
        <Tile span="lg-7 md-4" label="Checklist">
          <TileHead kicker="Checklist" title={`${done} of ${a.tasks.length} done`} />
          <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={a.tasks.length} aria-valuenow={done} aria-label="Checklist progress"><span style={{ width: `${a.tasks.length ? (done / a.tasks.length) * 100 : 0}%` }} /></div>
          <ul className="list">
            {a.tasks.map((t: any) => (
              <li key={t.id} className={`task ${t.done_at ? "done" : ""}`}>
                <form action={toggleTaskAction}>
                  <input type="hidden" name="taskId" value={t.id} />
                  <input type="hidden" name="applicationId" value={a.id} />
                  <input type="hidden" name="done" value={t.done_at ? "0" : "1"} />
                  <button className="tick" type="submit" aria-label={t.done_at ? `Mark “${t.title}” not done` : `Mark “${t.title}” done`}>{t.done_at ? <Icon name="check" size={16} /> : null}</button>
                </form>
                <div className="grow stack-sm">
                  <span className="task-title">{t.title}</span>
                  <span className="meta">{t.origin === "source_requirement" ? "From the official requirements" : t.origin === "suggested" ? "Suggested step" : "Your step"}{t.target_date ? ` · by ${t.target_date}` : ""}</span>
                </div>
                {t.origin === "user" ? (
                  <form action={deleteTaskAction}>
                    <input type="hidden" name="taskId" value={t.id} /><input type="hidden" name="applicationId" value={a.id} />
                    <button type="submit" className="btn ghost small" aria-label={`Remove “${t.title}”`}>Remove</button>
                  </form>
                ) : null}
              </li>
            ))}
          </ul>
          <ActionForm action={addTaskAction} className="row" resetOnSuccess>
            <input type="hidden" name="applicationId" value={a.id} />
            <label htmlFor="new-task" className="sr-only">New step</label>
            <input id="new-task" name="title" className="input grow" style={{ flex: "1 1 220px" }} placeholder="Add a step, e.g. ask for a reference" maxLength={200} required />
            <label htmlFor="new-task-date" className="sr-only">Target date</label>
            <input id="new-task-date" name="targetDate" type="date" className="input" style={{ width: "auto" }} />
            <Submit className="btn" pending="Adding…">Add</Submit>
          </ActionForm>
        </Tile>

        <Tile span="lg-5 md-2" tone="subtle" label="Deadline">
          <DeadlineBlock d={a.deadline} tz={tz} />
          <a className="btn primary block" href={a.application_url} target="_blank" rel="noopener noreferrer nofollow">Open the application on {hostOf(a.application_url)} <Icon name="external" size={18} /></a>
          <span className="meta">When you've actually submitted it there, mark it below. We never assume.</span>
        </Tile>

        <Tile span="lg-6 md-3" label="Status">
          <TileHead kicker="Status and plan" />
          <ActionForm action={updateApplicationAction}>
            <input type="hidden" name="id" value={a.id} />
            <input type="hidden" name="revision" value={a.revision} />
            <Field name="status" label="Where are you with it?" inputId="f-status">
              <select id="f-status" name="status" className="select" defaultValue="">
                <option value="">{STATUS_LABEL[a.status as AppStatus]} (no change)</option>
                {NEXT[a.status as AppStatus].map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
              </select>
            </Field>
            <label className="check"><input type="checkbox" name="confirmSubmitted" /> I submitted it on the organizer's site (needed for “Submitted”)</label>
            <Field name="targetAt" label="My preparation target" type="datetime-local" defaultValue={toLocalInput(a.target_at, tz)} hint={`Your own goal, in ${tz}. Separate from the official deadline.`} />
            <Field name="userReference" label="Confirmation number or reference" defaultValue={a.user_reference} maxLength={200} />
            <Field name="notes" label="Notes" textarea defaultValue={a.notes} maxLength={5000} />
            <Submit pending="Saving…">Save</Submit>
          </ActionForm>
        </Tile>

        <Tile span="lg-6 md-3" tone="flat" label="Reminders and history">
          <TileHead kicker="Reminders" action={<Link href="/settings/notifications" className="meta">Settings</Link>} />
          {a.reminders.filter((r: any) => r.state === "scheduled").length ? (
            <ul className="stack-sm" style={{ margin: 0, paddingLeft: 18 }}>
              {a.reminders.filter((r: any) => r.state === "scheduled").map((r: any) => <li key={r.id}>{describeReminder(r, tz)}</li>)}
            </ul>
          ) : <p className="muted" style={{ margin: 0 }}>No upcoming reminders{a.status === "submitted" ? " (submitted applications don't need them)" : ""}.</p>}
          <TileHead kicker="History" />
          <ol className="timeline">
            {a.history.map((h: any, i: number) => (
              <li key={i} className="done"><span>{STATUS_LABEL[h.to_status as AppStatus]} <span className="meta">· {formatInZone(new Date(h.created_at), tz)}</span></span></li>
            ))}
          </ol>
        </Tile>
      </Bento>
    </div>
  );
}
