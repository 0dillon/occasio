import Link from "next/link";
import { Empty, PageHead } from "@/components/Bento";
import { DeadlineBlock } from "@/components/Opportunity";
import { listApplications, STATUS_LABEL, type AppStatus } from "@/domain/applications";
import { planningCutoff } from "@/domain/deadlines";
import { formatInZone } from "@/lib/time";
import { asSelf, currentProfile, requireUser } from "@/server/session";

export const metadata = { title: "Upcoming dates" };

export default async function Deadlines() {
  const user = await requireUser("/deadlines");
  const tz = (await currentProfile())?.timezone ?? "UTC";
  const apps = (await asSelf(user, (c) => listApplications(c, user.id))).filter((a) => ["saved", "preparing", "submitted"].includes(a.status));
  const rows = apps
    .map((a) => ({ a, cut: a.deadline ? planningCutoff(a.deadline) : null }))
    .sort((x, y) => (x.cut?.at.getTime() ?? Number.MAX_SAFE_INTEGER) - (y.cut?.at.getTime() ?? Number.MAX_SAFE_INTEGER));
  return (
    <div className="page" style={{ maxWidth: 960 }}>
      <PageHead title="Upcoming dates" intro={`Official deadlines and your own targets, shown in ${tz}. Dates without a confirmed time or timezone are marked.`} />
      {rows.length ? (
        <ul className="list tile">
          {rows.map(({ a }) => (
            <li key={a.id} className="row-between" style={{ alignItems: "start" }}>
              <div className="stack-sm grow">
                <Link href={`/applications/${a.id}`} style={{ fontWeight: 700, fontSize: 17 }}>{a.title}</Link>
                <span className="meta">{STATUS_LABEL[a.status as AppStatus]}{a.target_at ? ` · Your target ${formatInZone(new Date(a.target_at), tz)}` : ""}</span>
              </div>
              <div style={{ minWidth: 220 }}><DeadlineBlock d={a.deadline} tz={tz} /></div>
            </li>
          ))}
        </ul>
      ) : <Empty title="No dates yet">Save an unlocked opportunity to plan your application and see its deadline here.</Empty>}
    </div>
  );
}
