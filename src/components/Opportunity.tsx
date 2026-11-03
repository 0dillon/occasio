import Link from "next/link";
import { CATEGORY_LABEL, trustStatements, type OpportunityPreview } from "@/domain/catalog";
import { describeDeadline, timeLeft, type DeadlineRecord } from "@/domain/deadlines";

export function DeadlineBlock({ d, tz, compact }: { d: DeadlineRecord | null; tz: string; compact?: boolean }) {
  const shown = describeDeadline(d, tz);
  const left = timeLeft(d);
  return (
    <div className="deadline">
      <span className="meta">{d?.precision === "rolling" ? "Deadline" : "Official deadline"}</span>
      <span className="when">{shown.primary}</span>
      {left && left !== "Closed" ? <span className="meta">{left}</span> : null}
      {left === "Closed" ? <span className="badge danger">Closed</span> : null}
      {!compact && shown.caution ? <span className="meta">{shown.caution}</span> : null}
    </div>
  );
}

const LOC: Record<string, string> = { remote: "Remote", hybrid: "Hybrid", on_site: "In person", unknown: "Location not confirmed" };
const FEE: Record<string, string> = { free: "No fee", paid: "Fee required", unknown: "Fee not confirmed" };

export function OpportunityCard({ o, tz }: { o: OpportunityPreview; tz: string }) {
  return (
    <Link href={`/opportunities/${o.id}`} className="card">
      <div className="row-between">
        <span className="badge">{CATEGORY_LABEL[o.category]}</span>
        {o.unlocked ? <span className="badge lime">Unlocked</span> : null}
      </div>
      <span className="card-title">{o.title}</span>
      <span className="meta">{o.organizer}</span>
      {o.summary ? <p className="muted" style={{ margin: 0 }}>{o.summary}</p> : null}
      <div className="row" style={{ gap: 8 }}>
        <span className="badge outline">{LOC[o.location_mode] ?? o.location_mode}</span>
        <span className="badge outline">{FEE[o.fee] ?? o.fee}</span>
        {o.is_fixture ? <span className="badge warn">Sample data</span> : null}
      </div>
      <DeadlineBlock d={o.deadline} tz={tz} compact />
      <span className="meta">{trustStatements(o)[0]}</span>
    </Link>
  );
}

export function TrustList({ o }: { o: OpportunityPreview }) {
  return (
    <ul className="stack-sm" style={{ margin: 0, paddingLeft: 18 }}>
      {trustStatements(o).map((s) => <li key={s}>{s}</li>)}
    </ul>
  );
}

export { LOC as LOCATION_LABEL, FEE as FEE_LABEL };
