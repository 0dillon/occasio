import Link from "next/link";
import { notFound } from "next/navigation";
import { Fragment } from "react";
import { reviewSubmissionAction } from "@/app/actions/admin";
import { Bento, PageHead, Tile, TileHead } from "@/components/Bento";
import { DraftFields } from "@/components/admin/DraftFields";
import { when } from "@/components/admin/when";
import { ActionForm, Field, Submit } from "@/components/Form";
import { many, one } from "@/db/tx";
import { draftFromSubmission } from "@/domain/admin";
import { asUser, requireStaff } from "@/server/session";

export const metadata = { title: "Review" };

/** Readable evidence value: drops empty keys instead of printing nulls. */
function showValue(v: unknown): string {
  if (v === null || v === undefined || v === "") return "Not found";
  if (typeof v !== "object") return String(v);
  const parts = Object.entries(v as Record<string, unknown>)
    .filter(([k, x]) => x !== null && x !== undefined && x !== "" && x !== false && k !== "excerpt")
    .map(([k, x]) => `${k.replace(/_/g, " ")}: ${typeof x === "object" ? JSON.stringify(x) : String(x)}`);
  return parts.length ? parts.join(" · ") : "Not found";
}

export default async function ReviewDetail({ params }: { params: Promise<{ id: string }> }) {
  const u = await requireStaff("reviewer");
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const data = await asUser(u, async (c) => {
    const s = await one<any>(c, "SELECT * FROM submissions WHERE id = $1", [id]);
    if (!s) return null;
    return {
      s,
      snap: s.candidate?.snapshotId ? await one<any>(c, "SELECT * FROM evidence_snapshots WHERE id = $1", [s.candidate.snapshotId]) : null,
      assets: await many<any>(c, "SELECT id, width, height FROM submission_assets WHERE submission_id = $1", [id]),
      evidence: await many<any>(c, "SELECT field_path, value, origin, excerpt FROM field_evidence WHERE submission_id = $1 ORDER BY field_path", [id]),
      runs: await many<any>(c, "SELECT extractor, decision, checks, created_at FROM verification_runs WHERE submission_id = $1 ORDER BY created_at DESC LIMIT 5", [id]),
    };
  });
  if (!data) notFound();
  const { s, snap, assets, evidence, runs } = data;
  const draft = draftFromSubmission(s);
  const open = ["review_required", "needs_information", "failed"].includes(s.status);
  return (
    <>
      <PageHead title={draft.title || "Untitled submission"} intro={<>Submitted {when(s.created_at)} · status <strong>{s.status.replace(/_/g, " ")}</strong></>}
        actions={<Link href="/admin/reviews" className="btn ghost small">Back to queue</Link>} />
      <Bento>
        <Tile span="lg-5 md-6">
          <TileHead kicker="What the contributor gave" />
          <dl className="kv">
            <dt>Link</dt><dd><a href={s.application_url} target="_blank" rel="noopener noreferrer nofollow" className="mono">{s.application_url}</a></dd>
            {Object.entries(s.claimed ?? {}).filter(([, v]) => v !== null && v !== undefined && v !== "").map(([k, v]) => (<Fragment key={k}><dt>{k.replace(/_/g, " ")}</dt><dd>{String(v)}</dd></Fragment>))}
            {s.user_note ? (<><dt>Note</dt><dd>{s.user_note}</dd></>) : null}
          </dl>
          {assets.map((a: any) => <img key={a.id} className="poster" src={`/api/v1/assets/${a.id}`} alt="Poster uploaded with this submission" />)}
          <p className="muted" style={{ margin: 0, fontSize: 14 }}>Contributor claims and posters are leads, not evidence. Confirm on the official source.</p>
        </Tile>
        <Tile span="lg-7 md-6">
          <TileHead kicker="Source snapshot" />
          {snap ? (
            <>
              <dl className="kv">
                <dt>Outcome</dt><dd><span className="badge">{snap.outcome}</span>{snap.http_status ? ` HTTP ${snap.http_status}` : ""}</dd>
                <dt>Fetched</dt><dd>{when(snap.fetched_at)}</dd>
                {snap.final_url && snap.final_url !== snap.requested_url ? (<><dt>Redirected to</dt><dd className="mono">{snap.final_url}</dd></>) : null}
                {snap.title ? (<><dt>Page title</dt><dd>{snap.title}</dd></>) : null}
                {snap.error_detail ? (<><dt>Error</dt><dd>{snap.error_detail}</dd></>) : null}
              </dl>
              {snap.excerpt ? <p className="evidence pre">{snap.excerpt}</p> : null}
            </>
          ) : <p className="muted" style={{ margin: 0 }}>No snapshot yet. The worker may still be fetching, or the link was refused by policy.</p>}
          {draft.notes.length ? <ul className="stack-sm" style={{ margin: 0, paddingLeft: 18 }}>{draft.notes.map((n) => <li key={n}>{n}</li>)}</ul> : null}
          {evidence.length ? (
            <div className="table-wrap"><table className="table">
              <thead><tr><th scope="col">Field</th><th scope="col">Value</th><th scope="col">From</th><th scope="col">Excerpt</th></tr></thead>
              <tbody>{evidence.map((e: any, i: number) => <tr key={i}><td>{e.field_path}</td><td>{showValue(e.value)}</td><td>{e.origin.replace(/_/g, " ")}</td><td className="muted">{e.excerpt}</td></tr>)}</tbody>
            </table></div>
          ) : null}
          {runs.length ? <p className="muted" style={{ margin: 0, fontSize: 14 }}>Last check: {runs[0].extractor}, decision {runs[0].decision}, {when(runs[0].created_at)}.</p> : null}
        </Tile>
        {open ? (
          <>
            <Tile span="lg-12">
              <TileHead kicker="Decision" title="Accept with these reviewed facts" />
              <ActionForm action={reviewSubmissionAction}>
                <input type="hidden" name="submissionId" value={s.id} />
                <input type="hidden" name="decision" value="accept" />
                <DraftFields d={draft} prefix="rv" />
                <div><Submit pending="Publishing…">Accept and publish</Submit></div>
                <p className="muted" style={{ margin: 0, fontSize: 14 }}>The contributor earns one credit only if this is the first valid submission of a new opportunity edition. Duplicates are linked, never credited.</p>
              </ActionForm>
            </Tile>
            <Tile span="lg-12" tone="flat">
              <TileHead kicker="Or" title="Send back or reject" />
              <ActionForm action={reviewSubmissionAction} className="form-grid two">
                <input type="hidden" name="submissionId" value={s.id} />
                <div className="full"><Field name="reason" label="Reason the contributor will see" required textarea maxLength={500} /></div>
                <Field name="missing" label="Missing information" hint="For send-back only. Comma separated, e.g. deadline, eligibility." />
                <div className="row full">
                  <Submit className="btn" name="decision" value="needs_information">Ask for more information</Submit>
                  <Submit className="btn ghost" name="decision" value="reject">Reject</Submit>
                </div>
              </ActionForm>
            </Tile>
          </>
        ) : (
          <Tile span="lg-12" tone="flat"><p style={{ margin: 0 }}>This submission is already {s.status.replace(/_/g, " ")}{s.status_reason ? `: ${s.status_reason}` : "."}</p></Tile>
        )}
      </Bento>
    </>
  );
}
