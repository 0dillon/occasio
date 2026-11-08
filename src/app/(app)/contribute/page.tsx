import { randomUUID } from "node:crypto";
import Link from "next/link";
import { submitOpportunityAction } from "@/app/actions/exchange";
import { Bento, Empty, PageHead, Tile, TileHead } from "@/components/Bento";
import { ActionForm, Field, Submit } from "@/components/Form";
import { productRules } from "@/config/product-rules";
import { CATEGORIES, CATEGORY_LABEL } from "@/domain/catalog";
import { listMySubmissions, STATUS_COPY } from "@/domain/submissions";
import { asSelf, requireUser } from "@/server/session";

export const metadata = { title: "Share an opportunity" };

export default async function Contribute() {
  const user = await requireUser("/contribute");
  const subs = await asSelf(user, (c) => listMySubmissions(c, user.id, 8));
  const p = productRules.proposed;
  return (
    <div className="page">
      <PageHead title="Share an opportunity" intro="Applying to something that isn't on the board? Paste the official link. We check the organizer's page and add it to the board and to your applications. If it's new, you earn a credit." />
      <Bento>
        <Tile span="lg-8 md-4">
          {!user.emailVerified ? (
            <div className="alert warn"><strong>Confirm your email first.</strong>Check your inbox for the link, or resend it from the banner above.</div>
          ) : null}
          <ActionForm action={submitOpportunityAction} encType="multipart/form-data">
            <input type="hidden" name="idempotencyKey" value={randomUUID()} />
            <Field name="applicationUrl" label="Application or official link" type="url" inputMode="url" required placeholder="https://" hint="The organizer's own page works best." />
            <Field name="image" label="Poster or flyer" hint={`PNG, JPG or WebP, up to ${p.maxUploadBytes / 1024 / 1024} MB. We remove location data and other metadata.`} inputId="f-image">
              <input id="f-image" name="image" type="file" accept="image/png,image/jpeg,image/webp" className="input" />
            </Field>
            <details>
              <summary style={{ cursor: "pointer", fontWeight: 700 }}>Add what you can see on it (optional)</summary>
              <div className="form-grid two" style={{ marginTop: 16 }}>
                <Field name="title" label="Title" maxLength={200} />
                <Field name="organizer" label="Organizer" maxLength={120} />
                <Field name="category" label="Kind" inputId="f-category">
                  <select id="f-category" name="category" className="select" defaultValue="">
                    <option value="">Not sure</option>
                    {CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>)}
                  </select>
                </Field>
                <Field name="deadlineText" label="Deadline as written" placeholder="e.g. Closes 30 Nov, 23:59 WAT" maxLength={200} />
                <div className="full"><Field name="note" label="Anything else reviewers should know" textarea maxLength={1000} /></div>
              </div>
            </details>
            <div className="row"><Submit pending="Uploading…">Share it</Submit></div>
          </ActionForm>
        </Tile>
        <Tile span="lg-4 md-2" tone="brand">
          <TileHead kicker="What earns a credit" />
          <ol className="steps">
            <li><span>A new opportunity, or a new edition of a recurring one.</span></li>
            <li><span>It's real, open and from an identifiable organizer.</span></li>
            <li><span>Not already in the bank. Duplicates are welcome but don't earn credit.</span></li>
          </ol>
          <span className="meta">Up to {p.dailySubmissionCap} shares a day, {p.maxPendingSubmissions} checking at once.</span>
        </Tile>
        <Tile span="lg-12" tone="flat">
          <TileHead kicker="Your recent shares" />
          {subs.length ? (
            <ul className="list">
              {subs.map((s) => (
                <li key={s.id} className="row-between">
                  <div className="stack-sm grow">
                    <Link href={`/submissions/${s.id}`} style={{ fontWeight: 700, overflowWrap: "anywhere" }}>{s.opportunity_title ?? s.claimed?.title ?? s.application_url}</Link>
                    <span className="meta">{s.status_reason ?? STATUS_COPY[s.status]?.body}</span>
                  </div>
                  <span className={`badge ${s.status === "accepted" ? "lime" : s.status === "rejected" ? "danger" : "outline"}`}>{STATUS_COPY[s.status]?.label ?? s.status}</span>
                </li>
              ))}
            </ul>
          ) : <Empty title="Nothing shared yet">When you share something, you can follow its check here.</Empty>}
        </Tile>
      </Bento>
    </div>
  );
}
