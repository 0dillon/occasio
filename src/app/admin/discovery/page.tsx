import { publishCandidateAction } from "@/app/actions/admin";
import { Empty, PageHead, Tile, TileHead } from "@/components/Bento";
import { DraftFields } from "@/components/admin/DraftFields";
import { when } from "@/components/admin/when";
import { ActionForm, Field, Submit } from "@/components/Form";
import { discoveryQueue } from "@/domain/admin";
import { CATEGORIES } from "@/domain/catalog";
import { asUser, requireStaff } from "@/server/session";

export const metadata = { title: "Discovery" };

function draftFrom(p: any, url: string) {
  const date = typeof p.deadline === "string" && /^\d{4}-\d{2}-\d{2}/.test(p.deadline) ? p.deadline.slice(0, 10) : null;
  return {
    title: p.title ?? "", organizer: p.organizer ?? "", programme: p.title ?? "",
    editionKey: date?.slice(0, 4) ?? String(new Date().getUTCFullYear()),
    category: (CATEGORIES as readonly string[]).includes(p.category) ? p.category : "other",
    summary: p.summary ?? null, applicationUrl: p.url ?? url, availability: "unknown" as const,
    deadline: { sourceText: p.deadline ?? "", date, time: null, timezone: p.timezone ?? null, rolling: false },
  };
}

export default async function Discovery({ searchParams }: { searchParams: Promise<{ done?: string }> }) {
  const u = await requireStaff("reviewer");
  const { done } = await searchParams;
  const rows = await asUser(u, (c) => discoveryQueue(c));
  return (
    <>
      <PageHead title="Discovery candidates" intro="Leads found on approved sources. Third-party listings are not proof: confirm on the organizer's own page. Discovery never awards credits." />
      {done ? <div className="alert success" role="status">Candidate handled.</div> : null}
      {rows.length ? rows.map((r: any) => (
        <Tile key={r.id} span="lg-12">
          <TileHead kicker={`${r.source_name}${r.is_fixture ? " · FIXTURE (demo data)" : ""} · found ${when(r.created_at)}`} title={r.payload?.title ?? r.url} />
          <p className="mono muted" style={{ margin: 0 }}>{r.url}</p>
          <details>
            <summary className="btn small">Review and publish</summary>
            <ActionForm action={publishCandidateAction}>
              <input type="hidden" name="candidateId" value={r.id} />
              <DraftFields d={draftFrom(r.payload ?? {}, r.url)} prefix={`d${r.id.slice(0, 8)}`} />
              <div className="row">
                <Submit name="decision" value="publish" pending="Publishing…">Publish</Submit>
              </div>
            </ActionForm>
          </details>
          <ActionForm action={publishCandidateAction} className="row">
            <input type="hidden" name="candidateId" value={r.id} />
            <Field name="reason" label="Reject reason" placeholder="e.g. Not an opportunity listing" />
            <Submit className="btn ghost small" name="decision" value="reject">Reject</Submit>
          </ActionForm>
        </Tile>
      )) : <Tile span="lg-12"><Empty title="No candidates waiting">Approved, enabled sources are crawled on their schedule. Results that need a person land here.</Empty></Tile>}
    </>
  );
}
