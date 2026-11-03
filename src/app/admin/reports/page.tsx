import Link from "next/link";
import { resolveReportAction } from "@/app/actions/admin";
import { Empty, PageHead, Tile } from "@/components/Bento";
import { when } from "@/components/admin/when";
import { ActionForm, Field, Submit } from "@/components/Form";
import { many } from "@/db/tx";
import { asUser, requireStaff } from "@/server/session";

export const metadata = { title: "Reports" };
const REASON: Record<string, string> = { suspected_scam: "Suspected scam", wrong_deadline: "Wrong deadline", closed: "Closed", wrong_eligibility: "Wrong eligibility", broken_link: "Broken link", other: "Other" };

export default async function Reports() {
  const u = await requireStaff("reviewer");
  const rows = await asUser(u, (c) => many<any>(c,
    `SELECT r.*, o.title FROM reports r LEFT JOIN opportunities o ON o.id = r.opportunity_id
      ORDER BY (r.state = 'open') DESC, (r.reason = 'suspected_scam') DESC, r.created_at LIMIT 100`));
  return (
    <>
      <PageHead title="Reports" intro="An open scam report blocks new unlocks of that opportunity until someone resolves it. Fix facts in the catalog, then resolve here." />
      <Tile span="lg-12">
        {rows.length ? (
          <ul className="list">
            {rows.map((r) => (
              <li key={r.id} className="stack-sm">
                <div className="row-between">
                  <div><span className="badge">{REASON[r.reason] ?? r.reason}</span> <strong>{r.title ?? "Removed opportunity"}</strong></div>
                  <span className="muted">{r.state} · {when(r.created_at)}</span>
                </div>
                {r.detail ? <p className="evidence pre">{r.detail}</p> : null}
                {r.state === "open" ? (
                  <ActionForm action={resolveReportAction} className="form-grid two">
                    <input type="hidden" name="id" value={r.id} />
                    <div className="full"><Field name="resolution" label="Resolution" required maxLength={500} /></div>
                    <div className="row full">
                      <Submit className="btn small" name="state" value="actioned">Actioned</Submit>
                      <Submit className="btn ghost small" name="state" value="dismissed">Dismiss</Submit>
                      {r.opportunity_id && u.role !== "reviewer" ? <Link href={`/admin/catalog/${r.opportunity_id}`} className="btn ghost small">Open in catalog</Link> : null}
                    </div>
                  </ActionForm>
                ) : <p className="muted" style={{ margin: 0 }}>{r.resolution}</p>}
              </li>
            ))}
          </ul>
        ) : <Empty title="No reports">Reports from members show up here.</Empty>}
      </Tile>
    </>
  );
}
