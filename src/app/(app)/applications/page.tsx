import Link from "next/link";
import { Empty, PageHead } from "@/components/Bento";
import { DeadlineBlock } from "@/components/Opportunity";
import { listApplications, STATUS_LABEL, STATUSES, type AppStatus } from "@/domain/applications";
import { asSelf, currentProfile, requireUser } from "@/server/session";

export const metadata = { title: "My applications" };
const GROUPS: { title: string; statuses: AppStatus[] }[] = [
  { title: "In progress", statuses: ["saved", "preparing"] },
  { title: "Submitted", statuses: ["submitted"] },
  { title: "Finished", statuses: ["selected", "unsuccessful", "withdrawn"] },
];

export default async function Applications() {
  const user = await requireUser("/applications");
  const tz = (await currentProfile())?.timezone ?? "UTC";
  const apps = await asSelf(user, (c) => listApplications(c, user.id));
  return (
    <div className="page">
      <PageHead title="My applications" intro="Your preparation, in your words. “Submitted” is only ever what you tell us; opening a link never changes it." actions={<Link href="/deadlines" className="btn">Upcoming dates</Link>} />
      {!apps.length ? (
        <Empty title="Nothing tracked yet" action={<Link className="btn primary" href="/matches">Find a match</Link>}>
          Save“Save and plan my application” to get a checklist and reminders.
        </Empty>
      ) : (
        <div className="stack" style={{ gap: 32 }}>
          {GROUPS.map((g) => {
            const list = apps.filter((a) => g.statuses.includes(a.status));
            if (!list.length) return null;
            return (
              <section key={g.title} aria-labelledby={`g-${g.title}`} className="stack">
                <h2 id={`g-${g.title}`}>{g.title} <span className="muted" style={{ fontWeight: 500 }}>({list.length})</span></h2>
                <div className="cards three">
                  {list.map((a) => (
                    <Link key={a.id} href={`/applications/${a.id}`} className="card">
                      <div className="row-between">
                        <span className={`badge ${a.status === "submitted" || a.status === "selected" ? "lime" : "outline"}`}>{STATUS_LABEL[a.status as AppStatus]}</span>
                        {a.publication !== "published" || a.availability === "closed" ? <span className="badge warn">No longer open</span> : null}
                      </div>
                      <span className="card-title">{a.title}</span>
                      <div className="progress" aria-hidden><span style={{ width: `${a.task_total ? (a.task_done / a.task_total) * 100 : 0}%` }} /></div>
                      <span className="meta">{a.task_done} of {a.task_total} steps{a.next_task ? ` · Next: ${a.next_task}` : ""}</span>
                      <DeadlineBlock d={a.deadline} tz={tz} compact />
                    </Link>
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}
      <p className="sr-only">Statuses: {STATUSES.map((s) => STATUS_LABEL[s]).join(", ")}</p>
    </div>
  );
}
