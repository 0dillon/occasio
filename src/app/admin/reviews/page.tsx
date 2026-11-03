import Link from "next/link";
import { Empty, PageHead, Tile } from "@/components/Bento";
import { ago } from "@/components/admin/when";
import { reviewQueue } from "@/domain/admin";
import { asUser, requireStaff } from "@/server/session";

export const metadata = { title: "Reviews" };
const DONE: Record<string, string> = {
  accepted: "Accepted as new. The contributor earned their credit.",
  published: "Published. No credit was awarded (not the first valid submission).",
  duplicate: "Matched an existing opportunity. No credit was awarded.",
  reject: "Rejected. The contributor sees your reason.",
  needs_information: "Sent back for more information.",
};
const STATUS: Record<string, string> = { review_required: "Needs review", needs_information: "Waiting on contributor", failed: "Verification failed" };

export default async function Reviews({ searchParams }: { searchParams: Promise<{ done?: string }> }) {
  const u = await requireStaff("reviewer");
  const { done } = await searchParams;
  const rows = await asUser(u, (c) => reviewQueue(c));
  return (
    <>
      <PageHead title="Review queue" intro="Oldest first. Check every fact against the official source before accepting." />
      {done && DONE[done] ? <div className="alert success" role="status">{DONE[done]}</div> : null}
      <Tile span="lg-12">
        {rows.length ? (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th scope="col">Submission</th><th scope="col">Status</th><th scope="col">Waiting</th><th scope="col">Poster</th><th scope="col"><span className="sr-only">Open</span></th></tr></thead>
              <tbody>
                {rows.map((r: any) => (
                  <tr key={r.id}>
                    <td><strong>{r.extracted_title ?? r.claimed?.title ?? "Untitled"}</strong><div className="mono muted">{r.application_url}</div></td>
                    <td><span className="badge">{STATUS[r.status] ?? r.status}</span></td>
                    <td>{ago(r.created_at)}</td>
                    <td>{r.assets ? "Yes" : "No"}</td>
                    <td><Link href={`/admin/reviews/${r.id}`} className="btn small">Review</Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <Empty title="Queue is clear">New submissions that need a person show up here.</Empty>}
      </Tile>
    </>
  );
}
