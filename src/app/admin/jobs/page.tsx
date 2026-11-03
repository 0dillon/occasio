import { Bento, Empty, PageHead, Tile, TileHead } from "@/components/Bento";
import { when } from "@/components/admin/when";
import { many } from "@/db/tx";
import { asUser, requireStaff } from "@/server/session";

export const metadata = { title: "Jobs" };

export default async function Jobs() {
  const u = await requireStaff("operator");
  const { runs, sends } = await asUser(u, async (c) => ({
    runs: await many<any>(c, "SELECT * FROM job_runs ORDER BY started_at DESC LIMIT 50"),
    sends: await many<any>(c, "SELECT channel, status, count(*)::int AS n, max(created_at) AS last FROM notification_attempts GROUP BY channel, status ORDER BY channel, status"),
  }));
  return (
    <>
      <PageHead title="Background jobs" intro="Recorded by the worker. If this list is empty, the worker has not run against this database." />
      <Bento>
        <Tile span="lg-8 md-6">
          <TileHead kicker="Recent runs" />
          {runs.length ? (
            <div className="table-wrap"><table className="table">
              <thead><tr><th scope="col">Job</th><th scope="col">Status</th><th scope="col">Items</th><th scope="col">Started</th><th scope="col">Detail</th></tr></thead>
              <tbody>{runs.map((r) => <tr key={r.id}><td>{r.job}</td><td><span className="badge">{r.status}</span></td><td>{r.items}</td><td>{when(r.started_at)}</td><td className="muted">{r.detail}</td></tr>)}</tbody>
            </table></div>
          ) : <Empty title="No runs recorded" />}
        </Tile>
        <Tile span="lg-4 md-6" tone="flat">
          <TileHead kicker="Delivery attempts" />
          {sends.length ? <ul className="list">{sends.map((s) => <li key={`${s.channel}-${s.status}`}><strong>{s.channel}</strong> {s.status}: {s.n} <span className="muted">· last {when(s.last)}</span></li>)}</ul> : <Empty title="No sends yet" />}
        </Tile>
      </Bento>
    </>
  );
}
