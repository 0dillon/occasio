import Link from "next/link";
import { notFound } from "next/navigation";
import { addInfoAction, withdrawSubmissionAction } from "@/app/actions/exchange";
import { Bento, Tile, TileHead } from "@/components/Bento";
import { ActionForm, Field, Submit } from "@/components/Form";
import { getSubmission, STATUS_COPY } from "@/domain/submissions";
import { formatInZone } from "@/lib/time";
import { asUser, currentProfile, requireUser } from "@/server/session";
import { AutoRefresh } from "@/components/AutoRefresh";

export const metadata = { title: "Submission" };
const ORDER = ["received", "fetching", "extracting", "validating", "review_required"];
const PENDING = new Set(["received", "queued", "fetching", "extracting", "validating"]);

export default async function SubmissionPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ new?: string }> }) {
  const { id } = await params;
  const { new: isNew } = await searchParams;
  const user = await requireUser(`/submissions/${id}`);
  const tz = (await currentProfile())?.timezone ?? "UTC";
  const s = await asUser(user, (c) => getSubmission(c, id));
  if (!s || (s.user_id !== user.id && user.role === "member")) notFound();
  const copy = STATUS_COPY[s.status] ?? { label: s.status, body: "" };
  const step = ORDER.indexOf(s.status);
  const checks: { check: string; status: string; detail: string }[] = s.last_run?.checks ?? [];
  return (
    <div className="page">
      {PENDING.has(s.status) ? <AutoRefresh seconds={4} /> : null}
      <header className="page-head">
        <div>
          <h1>{copy.label}</h1>
          <p>{s.status_reason ?? copy.body}</p>
        </div>
      </header>
      {isNew ? <div className="alert success" role="status" style={{ marginBottom: 24 }}><strong>Saved.</strong>You can leave this page; we'll notify you when it's checked.</div> : null}
      <Bento>
        <Tile span="lg-7 md-4">
          <TileHead kicker="Progress" />
          <ol className="timeline">
            {["Received", "Opening the source", "Reading the details", "Confirming dates", "Review by a person"].map((label, i) => (
              <li key={label} className={step >= i || ["accepted", "duplicate", "rejected"].includes(s.status) ? "done" : ""}>{label}</li>
            ))}
            <li className={s.status === "accepted" ? "done" : s.status === "rejected" ? "fail" : ""}>
              {s.status === "accepted" ? <>Accepted · <Link href={`/opportunities/${s.opportunity_id}`}>view it</Link></> : s.status === "duplicate" ? <>Already in the bank · <Link href={`/opportunities/${s.opportunity_id}`}>view it</Link></> : s.status === "rejected" ? "Not added" : "Decision"}
            </li>
          </ol>
          {s.status === "needs_information" ? (
            <ActionForm action={addInfoAction}>
              <input type="hidden" name="id" value={s.id} />
              <div className="alert warn"><strong>We need a little more.</strong>{(s.missing_information ?? []).join(" · ") || "Add what you know from the poster or page."}</div>
              <div className="form-grid two">
                <Field name="deadlineText" label="Deadline as written on the source" defaultValue={s.claimed?.deadline_text} />
                <Field name="title" label="Title" defaultValue={s.claimed?.title} />
                <Field name="organizer" label="Organizer" defaultValue={s.claimed?.organizer} />
                <div className="full"><Field name="note" label="Anything else" textarea /></div>
              </div>
              <Submit>Send and re-check</Submit>
            </ActionForm>
          ) : null}
          {["received", "queued", "needs_information", "review_required"].includes(s.status) && s.user_id === user.id ? (
            <form action={withdrawSubmissionAction}><input type="hidden" name="id" value={s.id} /><button className="btn ghost small" type="submit">Withdraw this submission</button></form>
          ) : null}
        </Tile>
        <Tile span="lg-5 md-2" tone="subtle">
          <TileHead kicker="What you shared" />
          <a href={s.application_url} target="_blank" rel="noopener noreferrer nofollow" style={{ overflowWrap: "anywhere" }}>{s.application_url}</a>
          <span className="meta">Shared {formatInZone(new Date(s.created_at), tz)}</span>
          {s.assets?.map((a: { id: string }) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img key={a.id} className="poster" src={`/api/v1/assets/${a.id}`} alt="Poster you uploaded" />
          ))}
          {s.claimed && Object.values(s.claimed).some(Boolean) ? (
            <dl className="kv">
              {s.claimed.title ? (<><dt>Title</dt><dd>{s.claimed.title}</dd></>) : null}
              {s.claimed.organizer ? (<><dt>Organizer</dt><dd>{s.claimed.organizer}</dd></>) : null}
              {s.claimed.deadline_text ? (<><dt>Deadline</dt><dd>{s.claimed.deadline_text}</dd></>) : null}
            </dl>
          ) : null}
        </Tile>
        {checks.length ? (
          <Tile span="lg-12" tone="flat">
            <TileHead kicker="Automated checks" />
            <span className="meta">From {s.last_run.extractor}. Listings publish automatically only when every check above passes.</span>
            <ul className="list">
              {checks.map((c) => (
                <li key={c.check} className="row-between">
                  <span className="grow">{c.detail}</span>
                  <span className={`badge ${c.status === "pass" ? "lime" : c.status === "fail" ? "danger" : "outline"}`}>{c.status === "pass" ? "Passed" : c.status === "fail" ? "Failed" : "Unclear"}</span>
                </li>
              ))}
            </ul>
          </Tile>
        ) : null}
      </Bento>
    </div>
  );
}
