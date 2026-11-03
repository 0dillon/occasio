import { Empty, PageHead, Tile } from "@/components/Bento";
import { when } from "@/components/admin/when";
import { many } from "@/db/tx";
import { asUser, requireStaff } from "@/server/session";

export const metadata = { title: "Audit" };

export default async function Audit({ searchParams }: { searchParams: Promise<{ action?: string }> }) {
  const u = await requireStaff("operator");
  const { action = "" } = await searchParams;
  const rows = await asUser(u, (c) => many<any>(c,
    `SELECT a.*, us.email AS actor_email FROM audit_events a LEFT JOIN users us ON us.id = a.actor_id
      WHERE ($1 = '' OR a.action LIKE $1 || '%') ORDER BY a.id DESC LIMIT 200`, [action.slice(0, 60)]));
  return (
    <>
      <PageHead title="Audit trail" intro="Append-only. Runtime database roles cannot update or delete these rows." />
      <form className="row" role="search">
        <label className="sr-only" htmlFor="aa">Action prefix</label>
        <input id="aa" name="action" className="input" defaultValue={action} placeholder="e.g. opportunity. or user." style={{ maxWidth: 280 }} />
        <button className="btn small">Filter</button>
      </form>
      <Tile span="lg-12">
        {rows.length ? (
          <div className="table-wrap"><table className="table">
            <thead><tr><th scope="col">When</th><th scope="col">Who</th><th scope="col">Action</th><th scope="col">Target</th><th scope="col">Reason</th></tr></thead>
            <tbody>{rows.map((r) => (
              <tr key={r.id}><td>{when(r.created_at)}</td><td>{r.actor_kind}{r.actor_email ? ` · ${r.actor_email}` : ""}</td><td className="mono">{r.action}</td><td className="mono">{r.target_type}:{r.target_id?.slice(0, 8)}</td><td className="muted">{r.reason}</td></tr>
            ))}</tbody>
          </table></div>
        ) : <Empty title="No audit events match" />}
      </Tile>
    </>
  );
}
