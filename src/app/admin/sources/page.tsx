import { createSourceAction, sourceStateAction } from "@/app/actions/admin";
import { Empty, PageHead, Tile, TileHead } from "@/components/Bento";
import { when } from "@/components/admin/when";
import { ActionForm, Field, Submit } from "@/components/Form";
import { many } from "@/db/tx";
import { asUser, requireStaff } from "@/server/session";

export const metadata = { title: "Sources" };

export default async function Sources() {
  const u = await requireStaff("operator");
  const rows = await asUser(u, (c) => many<any>(c,
    `SELECT s.*, (SELECT row_to_json(r) FROM (SELECT result, http_status, candidates, started_at, detail FROM crawl_runs WHERE source_id = s.id ORDER BY started_at DESC LIMIT 1) r) AS last_run
       FROM source_registry s ORDER BY s.created_at DESC`));
  return (
    <>
      <PageHead title="Approved sources" intro="Discovery only reads sources an administrator approved after a terms and robots review, within the per-source rate and daily budget. Nothing is crawled until a source is approved and enabled." />
      <Tile span="lg-12">
        {rows.length ? (
          <ul className="list">
            {rows.map((s) => (
              <li key={s.id} className="stack-sm">
                <div className="row-between">
                  <div>
                    <strong>{s.name}</strong>{s.is_fixture ? <span className="badge" style={{ marginLeft: 8 }}>Fixture (demo data, no network)</span> : null}
                    <div className="mono muted">{s.base_url}{s.scope_path} · {s.adapter} · every {s.crawl_every_minutes} min · {s.daily_fetch_budget}/day · ≥{s.min_interval_seconds}s apart</div>
                  </div>
                  <span className="badge">{s.enabled ? "Enabled" : s.approved_at ? "Approved, off" : "Not approved"}</span>
                </div>
                {s.access_review ? <p className="evidence pre">{s.access_review}</p> : null}
                <div className="muted" style={{ fontSize: 14 }}>
                  Last crawl: {s.last_run ? `${s.last_run.result ?? "running"}${s.last_run.http_status ? ` (HTTP ${s.last_run.http_status})` : ""}, ${s.last_run.candidates} candidates, ${when(s.last_run.started_at)}` : "never"} · next {when(s.next_crawl_at)}
                </div>
                <div className="row">
                  {!s.approved_at && u.role === "admin" ? <ActionForm action={sourceStateAction} className="row"><input type="hidden" name="id" value={s.id} /><input type="hidden" name="action" value="approve" /><Submit className="btn small">Approve</Submit></ActionForm> : null}
                  {s.approved_at && !s.enabled ? <ActionForm action={sourceStateAction} className="row"><input type="hidden" name="id" value={s.id} /><input type="hidden" name="action" value="enable" /><Submit className="btn small">Enable</Submit></ActionForm> : null}
                  {s.enabled ? <ActionForm action={sourceStateAction} className="row"><input type="hidden" name="id" value={s.id} /><input type="hidden" name="action" value="stop" /><Submit className="btn ghost small">Stop</Submit></ActionForm> : null}
                </div>
              </li>
            ))}
          </ul>
        ) : <Empty title="No sources yet">Add one below. It stays off until approved.</Empty>}
      </Tile>
      <Tile span="lg-12" tone="flat">
        <TileHead kicker="Add a source" />
        <ActionForm action={createSourceAction} className="form-grid two" resetOnSuccess>
          <Field name="name" label="Name" required maxLength={120} />
          <Field name="baseUrl" label="Base URL" type="url" required placeholder="https://example.org" />
          <Field name="adapter" label="Adapter" inputId="s-ad">
            <select id="s-ad" name="adapter" className="select"><option value="json_feed">JSON feed</option><option value="html_listing">HTML listing</option></select>
          </Field>
          <Field name="scopePath" label="Path scope" defaultValue="/" hint="Only links under this path are read." />
          <div className="full"><Field name="accessReview" label="Access review" textarea required hint="What you checked: terms of use, robots.txt, whether automated reading is permitted, and who to contact." /></div>
          <Field name="minIntervalSeconds" label="Seconds between requests" type="number" defaultValue={5} min="5" />
          <Field name="dailyFetchBudget" label="Daily request budget" type="number" defaultValue={50} min="1" />
          <Field name="crawlEveryMinutes" label="Crawl every (minutes)" type="number" defaultValue={720} min="60" />
          <div className="full"><Submit className="btn">Add source</Submit></div>
        </ActionForm>
      </Tile>
    </>
  );
}
