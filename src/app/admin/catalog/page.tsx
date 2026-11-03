import Link from "next/link";
import { Empty, PageHead, Tile } from "@/components/Bento";
import { when } from "@/components/admin/when";
import { many } from "@/db/tx";
import { asUser, requireStaff } from "@/server/session";

export const metadata = { title: "Catalog" };

export default async function Catalog({ searchParams }: { searchParams: Promise<{ q?: string; state?: string }> }) {
  const u = await requireStaff("operator");
  const { q = "", state = "published" } = await searchParams;
  const pub = ["published", "hidden", "archived", "draft"].includes(state) ? state : "published";
  const rows = await asUser(u, (c) => many<any>(c,
    `SELECT o.id, o.title, o.availability, o.is_fixture, o.revision, o.last_successful_check_at, o.consecutive_check_failures,
            cardinality(o.redemption_blockers) AS blockers, g.name AS organizer, g.trust
       FROM opportunities o JOIN organizers g ON g.id = o.organizer_id
      WHERE o.publication = $1 AND ($2 = '' OR o.title ILIKE '%' || $2 || '%' OR g.name ILIKE '%' || $2 || '%')
      ORDER BY o.updated_at DESC NULLS LAST LIMIT 100`, [pub, q.slice(0, 100)]));
  return (
    <>
      <PageHead title="Catalog" intro="Corrections create a new revision, keep the old deadline on record, replan reminders and tell people tracking the opportunity." />
      <form className="row" role="search">
        <label className="sr-only" htmlFor="cq">Search</label>
        <input id="cq" name="q" className="input" defaultValue={q} placeholder="Title or organizer" style={{ maxWidth: 320 }} />
        <label className="sr-only" htmlFor="cs">Publication</label>
        <select id="cs" name="state" className="select" defaultValue={pub} style={{ maxWidth: 180 }}>
          <option value="published">Published</option><option value="hidden">Hidden</option><option value="archived">Archived</option><option value="draft">Draft</option>
        </select>
        <button className="btn small">Filter</button>
      </form>
      <Tile span="lg-12">
        {rows.length ? (
          <div className="table-wrap"><table className="table">
            <thead><tr><th scope="col">Opportunity</th><th scope="col">Availability</th><th scope="col">Last checked</th><th scope="col">Blockers</th><th scope="col"><span className="sr-only">Edit</span></th></tr></thead>
            <tbody>{rows.map((r) => (
              <tr key={r.id}>
                <td><strong>{r.title}</strong>{r.is_fixture ? <span className="badge" style={{ marginLeft: 8 }}>Fixture</span> : null}<div className="muted">{r.organizer} · organizer {r.trust}</div></td>
                <td>{r.availability}</td>
                <td>{when(r.last_successful_check_at)}{r.consecutive_check_failures ? ` · ${r.consecutive_check_failures} failed` : ""}</td>
                <td>{r.blockers}</td>
                <td><Link href={`/admin/catalog/${r.id}`} className="btn small">Edit</Link></td>
              </tr>
            ))}</tbody>
          </table></div>
        ) : <Empty title="Nothing here">No opportunities match this filter.</Empty>}
      </Tile>
    </>
  );
}
