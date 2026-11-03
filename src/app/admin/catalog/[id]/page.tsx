import Link from "next/link";
import { notFound } from "next/navigation";
import { correctOpportunityAction, organizerTrustAction, publicationAction } from "@/app/actions/admin";
import { Bento, PageHead, Tile, TileHead } from "@/components/Bento";
import { when } from "@/components/admin/when";
import { ActionForm, Field, Submit } from "@/components/Form";
import { many, one } from "@/db/tx";
import { asUser, requireStaff } from "@/server/session";

export const metadata = { title: "Edit opportunity" };

export default async function CatalogItem({ params }: { params: Promise<{ id: string }> }) {
  const u = await requireStaff("operator");
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const d = await asUser(u, async (c) => {
    const o = await one<any>(c, "SELECT o.*, g.name AS organizer, g.trust, g.id AS org_id FROM opportunities o JOIN organizers g ON g.id = o.organizer_id WHERE o.id = $1", [id]);
    if (!o) return null;
    return {
      o,
      dl: await one<any>(c, "SELECT * FROM opportunity_deadlines WHERE opportunity_id = $1 AND is_current AND kind = 'application'", [id]),
      history: await many<any>(c, "SELECT revision, changed_fields, actor_kind, reason, created_at FROM opportunity_revisions WHERE opportunity_id = $1 ORDER BY revision DESC LIMIT 20", [id]),
      oldDeadlines: await many<any>(c, "SELECT revision, source_text, source_local_date, source_local_time, timezone, created_at FROM opportunity_deadlines WHERE opportunity_id = $1 AND NOT is_current ORDER BY revision DESC", [id]),
    };
  });
  if (!d) notFound();
  const { o, dl, history, oldDeadlines } = d;
  return (
    <>
      <PageHead title={o.title} intro={<>{o.organizer} · revision {o.revision} · {o.publication}{o.is_fixture ? " · FIXTURE (demo data)" : ""}</>}
        actions={<><Link href={`/opportunities/${o.id}`} className="btn ghost small">Public page</Link><Link href="/admin/catalog" className="btn ghost small">Back</Link></>} />
      <Bento>
        <Tile span="lg-8 md-6">
          <TileHead kicker="Correct facts" />
          <ActionForm action={correctOpportunityAction} className="form-grid two">
            <input type="hidden" name="id" value={o.id} />
            <div className="full"><Field name="title" label="Title" defaultValue={o.title} maxLength={200} /></div>
            <div className="full"><Field name="summary" label="Summary" textarea defaultValue={o.summary} maxLength={600} /></div>
            <Field name="availability" label="Availability" inputId="c-av">
              <select id="c-av" name="availability" className="select" defaultValue={o.availability}>
                {["open", "upcoming", "rolling", "closed", "unknown"].map((v) => <option key={v} value={v}>{v}</option>)}
              </select>
            </Field>
            <Field name="fee" label="Fee" inputId="c-fee">
              <select id="c-fee" name="fee" className="select" defaultValue={o.fee}>
                {["free", "paid", "unknown"].map((v) => <option key={v} value={v}>{v}</option>)}
              </select>
            </Field>
            <label className="check full"><input type="checkbox" name="eligibilityComplete" defaultChecked={o.eligibility_complete} /> Eligibility rules are complete</label>
            <label className="check full"><input type="checkbox" name="changeDeadline" /> Change the deadline</label>
            <div className="full"><Field name="deadlineSourceText" label="Deadline as the source states it" defaultValue={dl?.source_text} maxLength={300} /></div>
            <Field name="deadlineDate" label="Date" type="date" defaultValue={dl?.source_local_date} />
            <Field name="deadlineTime" label="Time" type="time" defaultValue={dl?.source_local_time?.slice(0, 5)} />
            <Field name="deadlineTimezone" label="Timezone (IANA)" defaultValue={dl?.timezone} />
            <label className="check"><input type="checkbox" name="deadlineRolling" defaultChecked={dl?.precision === "rolling"} /> Rolling</label>
            <label className="check full"><input type="checkbox" name="markChecked" /> I checked the official source just now</label>
            <div className="full"><Field name="reason" label="Reason (audit trail)" required maxLength={500} /></div>
            <div className="full"><Submit>Save new revision</Submit></div>
          </ActionForm>
        </Tile>
        <Tile span="lg-4 md-6" tone="flat">
          <TileHead kicker="Publication" />
          <ActionForm action={publicationAction}>
            <input type="hidden" name="id" value={o.id} />
            <Field name="state" label="State" inputId="p-st">
              <select id="p-st" name="state" className="select" defaultValue={o.publication === "draft" ? "published" : o.publication}>
                <option value="published">Published</option><option value="hidden">Hidden</option><option value="archived">Archived</option>
              </select>
            </Field>
            <Field name="reason" label="Reason" required maxLength={300} />
            <Submit className="btn">Update</Submit>
          </ActionForm>
          <TileHead kicker="Organizer trust" />
          <ActionForm action={organizerTrustAction}>
            <input type="hidden" name="organizerId" value={o.org_id} />
            <Field name="trust" label={o.organizer} inputId="o-tr">
              <select id="o-tr" name="trust" className="select" defaultValue={o.trust}>
                <option value="unassessed">Not assessed</option><option value="supported">Supported by evidence</option><option value="concern">Concern</option><option value="blocked">Blocked</option>
              </select>
            </Field>
            <Field name="reason" label="Reason" required maxLength={300} />
            <Submit className="btn">Update</Submit>
          </ActionForm>
          {o.redemption_blockers?.length ? (<><TileHead kicker="Why matches can't unlock it" /><ul style={{ margin: 0, paddingLeft: 18 }}>{o.redemption_blockers.map((b: string) => <li key={b}>{b}</li>)}</ul></>) : null}
        </Tile>
        <Tile span="lg-12" tone="flat">
          <TileHead kicker="History" />
          {history.length ? (
            <ul className="list">{history.map((h) => <li key={h.revision}><strong>Revision {h.revision}</strong> · {h.changed_fields.join(", ")} · {h.actor_kind} · {when(h.created_at)}<div className="muted">{h.reason}</div></li>)}</ul>
          ) : <p className="muted" style={{ margin: 0 }}>No corrections yet.</p>}
          {oldDeadlines.length ? (
            <><TileHead kicker="Previous deadlines (kept on record)" /><ul className="list">{oldDeadlines.map((x) => <li key={x.revision}>Rev {x.revision}: “{x.source_text}” {x.source_local_date ?? ""} {x.source_local_time?.slice(0, 5) ?? ""} {x.timezone ?? ""}</li>)}</ul></>
          ) : null}
        </Tile>
      </Bento>
    </>
  );
}
