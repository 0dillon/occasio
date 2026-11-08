import Link from "next/link";
import { Empty, PageHead } from "@/components/Bento";
import { OpportunityCard } from "@/components/Opportunity";
import { createAlertAction } from "@/app/actions/perks";
import { CATEGORIES, CATEGORY_LABEL, searchBank, searchSchema } from "@/domain/catalog";
import { getPerks } from "@/domain/perks";
import { asSelf, currentProfile, requireUser } from "@/server/session";

export const metadata = { title: "Discover" };

export default async function Discover({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireUser("/discover");
  const raw = await searchParams;
  const input = searchSchema.parse(raw);
  const tz = (await currentProfile())?.timezone ?? "UTC";
  const { items, nextCursor } = await asSelf(user, (c) => searchBank(c, input, user.id));
  const perks = await asSelf(user, (c) => getPerks(c, user.id));
  const alertMsg = typeof raw.alert === "string" ? raw.alert.slice(0, 200) : null;
  const qs = (patch: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...input, cursor: undefined, ...patch })) if (v) p.set(k, String(v));
    return `/discover?${p.toString()}`;
  };
  const filtered = !!(input.q || input.category || input.remote || input.free || input.open);
  return (
    <div className="page">
      <PageHead title="Discover" intro="Every listing shows where it came from and when we last checked it. Open one for the full details and the application link." />
      <section className="tile" aria-label="Search and filters" style={{ marginBottom: 24 }}>
        <form className="stack" role="search" action="/discover">
          <div className="row" style={{ alignItems: "stretch" }}>
            <label htmlFor="q" className="sr-only">Search opportunities</label>
            <input id="q" name="q" className="input grow" style={{ flex: "1 1 260px" }} defaultValue={input.q} placeholder="Search by title, organizer or topic" />
            <label htmlFor="category" className="sr-only">Category</label>
            <select id="category" name="category" className="select" style={{ width: "auto", flex: "0 1 200px" }} defaultValue={input.category ?? ""}>
              <option value="">All kinds</option>
              {CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>)}
            </select>
            <button className="btn primary" type="submit">Search</button>
          </div>
          <div className="chips" role="group" aria-label="Filters">
            <label className="chip"><input type="checkbox" name="open" value="1" defaultChecked={!!input.open} />Open now</label>
            <label className="chip"><input type="checkbox" name="remote" value="1" defaultChecked={!!input.remote} />Remote</label>
            <label className="chip"><input type="checkbox" name="free" value="1" defaultChecked={!!input.free} />No fee</label>
            {filtered ? <Link className="chip" href="/discover">Clear all</Link> : null}
          </div>
        </form>
      </section>
      {filtered ? (
        <div className="tile" style={{ marginBottom: 24, gap: 12, flexWrap: "wrap", flexDirection: "row", alignItems: "center", justifyContent: "space-between", textAlign: "left" }}>
          {alertMsg === "saved" ? (
            <span role="status">Alert saved. We'll tell you when a new listing matches. <Link href="/credits">Manage alerts</Link></span>
          ) : alertMsg ? (
            <span role="alert">{alertMsg}</span>
          ) : perks.personalAlerts ? (
            <span>Get told when a new listing matches these filters.</span>
          ) : (
            <span className="muted">Alerts for searches like this open up at {perks.thresholds.personalAlerts} credits earned ({perks.earned} so far). Share an opportunity or invite someone.</span>
          )}
          {perks.personalAlerts && alertMsg !== "saved" ? (
            <form action={createAlertAction}>
              {(["q", "category", "remote", "free", "open"] as const).map((k) => input[k] ? <input key={k} type="hidden" name={k} value={String(input[k])} /> : null)}
              <button className="btn primary small" type="submit">Alert me</button>
            </form>
          ) : !perks.personalAlerts ? <Link href="/credits" className="btn small">Earn credits</Link> : null}
        </div>
      ) : null}
      {items.length ? (
        <>
          <p className="meta" aria-live="polite">{items.length} result{items.length === 1 ? "" : "s"}{nextCursor ? " on this page" : ""}</p>
          <div className="cards three">{items.map((o) => <OpportunityCard key={o.id} o={o} tz={tz} />)}</div>
          {nextCursor ? <div className="row" style={{ marginTop: 24 }}><Link className="btn" href={qs({ cursor: nextCursor })}>Show more</Link></div> : null}
        </>
      ) : (
        <Empty
          title={filtered ? "No listings match these filters" : "No published opportunities yet"}
          action={filtered ? <Link className="btn" href="/discover">Clear filters</Link> : <Link className="btn primary" href="/contribute">Share the first one</Link>}
        >
          {filtered ? "Try fewer filters. New listings are added as they pass their checks." : "Opportunities appear after they pass a source check and review."}
        </Empty>
      )}
    </div>
  );
}
