import Link from "next/link";
import { notFound } from "next/navigation";
import { reportAction } from "@/app/actions/exchange";
import { saveApplicationAction } from "@/app/actions/tracker";
import { Bento, Tile, TileHead } from "@/components/Bento";
import { ActionForm, Field, Submit } from "@/components/Form";
import { Icon } from "@/components/Icon";
import { DeadlineBlock, FEE_LABEL, LOCATION_LABEL, TrustList } from "@/components/Opportunity";
import { one } from "@/db/tx";
import { CATEGORY_LABEL, getDetail, getPreview } from "@/domain/catalog";
import { formatInZone } from "@/lib/time";
import { hostOf } from "@/lib/urls";
import { asSelf, asUser, currentProfile, requireUser } from "@/server/session";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  return { title: "Opportunity" };
}

export default async function OpportunityPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser(`/opportunities/${id}`);
  const tz = (await currentProfile())?.timezone ?? "UTC";
  const staff = user.role !== "member";
  const preview = await asUser(user, (c) => getPreview(c, id, user.id, staff));
  if (!preview) notFound();
  const detail = await asUser(user, (c) => getDetail(c, id, user.id, staff));
  const app = await asSelf(user, (c) => one<{ id: string }>(c, "SELECT id FROM applications WHERE user_id = $1 AND opportunity_id = $2", [user.id, id]));
  const o = detail ?? preview;

  return (
    <div className="page">
      <header className="page-head">
        <div className="stack-sm" style={{ maxWidth: 820 }}>
          <div className="row">
            <span className="badge">{CATEGORY_LABEL[o.category]}</span>
            {o.is_fixture ? <span className="badge warn">Sample data · not a real opportunity</span> : null}
            {o.publication !== "published" ? <span className="badge danger">{o.publication === "hidden" ? "Withdrawn from the bank" : "Archived"}</span> : null}
          </div>
          <h1>{o.title}</h1>
          <p className="muted" style={{ margin: 0 }}>{o.organizer}</p>
        </div>
      </header>
      <Bento>
        <Tile span="lg-8 md-4" as="article" label="Details">
          <TileHead kicker="About" />
          {o.summary ? <p style={{ fontSize: 18, lineHeight: "28px" }}>{o.summary}</p> : null}
          {detail?.description ? <p className="muted" style={{ whiteSpace: "pre-line" }}>{detail.description}</p> : null}
          <dl className="kv">
            <dt>Where</dt><dd>{LOCATION_LABEL[o.location_mode] ?? o.location_mode}{o.location_text ? ` · ${o.location_text}` : ""}</dd>
            <dt>Fee</dt><dd>{FEE_LABEL[o.fee] ?? o.fee}{detail?.fee_text ? ` · ${detail.fee_text}` : ""}</dd>
            {detail?.benefits_text ? (<><dt>Benefits</dt><dd>{detail.benefits_text}</dd></>) : null}
            <dt>Eligibility</dt><dd>{o.eligibility_summary ?? (o.eligibility_complete ? "See the rules below." : "Not fully confirmed. Check the official page.")}</dd>
          </dl>
          {detail?.rules?.length ? (
            <div className="stack-sm">
              <h3>Eligibility rules from the source</h3>
              <ul style={{ margin: 0, paddingLeft: 18 }}>{detail.rules.map((r, i) => <li key={i}>{r.source_text}{r.is_hard ? "" : " (preference)"}</li>)}</ul>
            </div>
          ) : null}
          {detail?.requirements?.length ? (
            <div className="stack-sm">
              <h3>What you'll need</h3>
              <ul style={{ margin: 0, paddingLeft: 18 }}>{detail.requirements.map((r) => <li key={r}>{r}</li>)}</ul>
            </div>
          ) : null}
        </Tile>

        <Tile span="lg-4 md-2" tone="panel" as="aside" label="Deadline and action">
          <DeadlineBlock d={o.deadline} tz={tz} />
          {detail ? (
            <div className="stack-sm">
              <a className="btn primary block" href={detail.application_url} target="_blank" rel="noopener noreferrer nofollow">
                Open the application <Icon name="external" size={18} />
              </a>
              <span className="meta">Opens {hostOf(detail.application_url)}. Opening it doesn't mark anything as submitted.</span>
              {app ? (
                <Link className="btn block" href={`/applications/${app.id}`}>Go to my checklist</Link>
              ) : o.publication === "published" ? (
                <ActionForm action={saveApplicationAction}>
                  <input type="hidden" name="opportunityId" value={o.id} />
                  <Submit className="btn block" pending="Saving…">Track this application</Submit>
                </ActionForm>
              ) : null}
            </div>
          ) : (
            <div className="stack-sm">
              <p style={{ margin: 0 }}>This opportunity is no longer available.</p>
            </div>
          )}
        </Tile>

        <Tile span="lg-6 md-3" label="Source and freshness">
          <TileHead kicker="Source and freshness" />
          <TrustList o={o} />
          {detail?.sources?.map((s) => (
            <div key={s.url} className="stack-sm">
              <span className="meta">{s.role === "application" ? "Application page" : "Official page"} · {hostOf(s.url)}{s.fetched_at ? ` · fetched ${formatInZone(new Date(s.fetched_at), tz)}` : ""}</span>
              {s.excerpt ? <blockquote className="evidence" style={{ margin: 0 }}>{s.excerpt}</blockquote> : null}
            </div>
          ))}
          {o.origin === "discovery" ? <span className="meta">Found by our source checks from an approved organizer page.</span> : o.origin === "user_submission" ? <span className="meta">Shared by a member and checked against the official page.</span> : null}
        </Tile>

        <Tile span="lg-6 md-3" tone="flat" label="Report a problem">
          <TileHead kicker="Something wrong?" />
          <ActionForm action={reportAction}>
            <input type="hidden" name="opportunityId" value={o.id} />
            <Field name="reason" label="What's wrong" required inputId="f-reason">
              <select id="f-reason" name="reason" className="select" defaultValue="">
                <option value="" disabled>Choose one</option>
                <option value="wrong_deadline">The deadline is wrong</option>
                <option value="closed">It's closed</option>
                <option value="wrong_eligibility">Eligibility is wrong</option>
                <option value="broken_link">The link is broken</option>
                <option value="suspected_scam">It looks like a scam</option>
                <option value="other">Something else</option>
              </select>
            </Field>
            <Field name="detail" label="Details" textarea maxLength={2000} />
            <Submit className="btn">Send report</Submit>
          </ActionForm>
        </Tile>
      </Bento>
    </div>
  );
}
