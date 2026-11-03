import Link from "next/link";
import { Bento, PageHead, Tile, TileHead } from "@/components/Bento";
import { ago } from "@/components/admin/when";
import { opsCounts } from "@/domain/admin";
import { asUser, requireStaff } from "@/server/session";

export const metadata = { title: "Overview" };

export default async function AdminHome() {
  const u = await requireStaff("reviewer");
  const n: any = await asUser(u, (c) => opsCounts(c));
  const tiles: [string, number | string, string, string][] = [
    ["Waiting for review", n.reviews, "/admin/reviews", "Submissions a person needs to check."],
    ["Discovery candidates", n.discovery, "/admin/discovery", "Found on approved sources, not yet published."],
    ["Open reports", n.reports, "/admin/reports", "Scam reports block new unlocks until resolved."],
    ["Refund requests", n.refunds, "/admin/refunds", "Decided by an operator."],
  ];
  return (
    <>
      <PageHead title="Operations" intro="Live counts from the database. Nothing here is estimated." />
      <Bento label="Queues">
        {tiles.map(([t, v, href, d]) => (
          <Tile key={t} span="lg-3 md-3">
            <TileHead kicker={t} />
            <div className="big-number">{v}</div>
            <span className="muted">{d}</span>
            <div className="tile-actions"><Link href={href} className="btn small">Open</Link></div>
          </Tile>
        ))}
        <Tile span="lg-6 md-6" tone="flat">
          <TileHead kicker="Pipeline health" />
          <dl className="kv">
            <dt>Verifying now</dt><dd>{n.verifying}</dd>
            <dt>Oldest queued</dt><dd>{n.oldest_queued ? `${ago(n.oldest_queued)} ago` : "None"}</dd>
            <dt>Oldest due reminder</dt><dd>{n.oldest_due_reminder ? `${ago(n.oldest_due_reminder)} overdue` : "None overdue"}</dd>
            <dt>Failed or uncertain sends</dt><dd>{n.failed_notifications}</dd>
            <dt>Undispatched events</dt><dd>{n.pending_events}</dd>
          </dl>
        </Tile>
        <Tile span="lg-6 md-6" tone="flat">
          <TileHead kicker="Catalog" />
          <div className="big-number">{n.published}</div>
          <span className="muted">published opportunities</span>
        </Tile>
      </Bento>
    </>
  );
}
