import Link from "next/link";
import { redirect } from "next/navigation";
import { Bento, Empty, Tile, TileHead } from "@/components/Bento";
import { Icon } from "@/components/Icon";
import { Symbol } from "@/components/Logo";
import { DeadlineBlock, OpportunityCard } from "@/components/Opportunity";
import { many, one } from "@/db/tx";
import { listApplications, STATUS_LABEL } from "@/domain/applications";
import { searchBank } from "@/domain/catalog";
import { planningCutoff } from "@/domain/deadlines";
import { STATUS_COPY } from "@/domain/submissions";
import { formatInZone } from "@/lib/time";
import { asSelf, currentProfile, requireUser } from "@/server/session";

export const metadata = { title: "Home" };

export default async function Home({ searchParams }: { searchParams: Promise<{ welcome?: string }> }) {
  const user = await requireUser("/home");
  const profile = await currentProfile();
  if (profile && !profile.onboarded_at) redirect("/onboarding");
  const { welcome } = await searchParams;
  const tz = profile?.timezone ?? "UTC";
  const data = await asSelf(user, async (c) => {
    const wallet = await one(c, "SELECT balance FROM wallets WHERE user_id = $1", [user.id]);
    const subs = await many(c, "SELECT id, status, claimed, created_at FROM submissions WHERE user_id = $1 ORDER BY created_at DESC LIMIT 3", [user.id]);
    const apps = await listApplications(c, user.id);
    const recent = await searchBank(c, { q: "", open: "1" } as any, user.id, 6);
    return { wallet, subs, apps, recent: recent.items };
  });
  const active = data.apps.filter((a: any) => ["saved", "preparing"].includes(a.status));
  const upcoming = active
    .map((a: any) => ({ a, cut: a.deadline ? planningCutoff(a.deadline) : null }))
    .filter((x) => x.cut || x.a.target_at)
    .sort((x, y) => (x.cut?.at.getTime() ?? Infinity) - (y.cut?.at.getTime() ?? Infinity))
    .slice(0, 4);
  const focus = active[0];
  const name = profile?.display_name ? `, ${profile.display_name}` : "";

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>{welcome ? `Welcome${name}.` : `Your next opening${name ? name : ""}.`}</h1>
          <p>Find what's open, track your applications, and share what you come across.</p>
        </div>
      </header>
      <Bento label="Your dashboard">
        <Tile span="lg-8 md-4" label="Open now">
          <TileHead kicker="Open now" action={<Link href="/discover" className="meta">See all</Link>} />
          {data.recent.length ? (
            <div className="cards">{data.recent.slice(0, 4).map((o) => <OpportunityCard key={o.id} o={o} tz={tz} />)}</div>
          ) : (
            <Empty title="Nothing open on the board yet">New opportunities appear here as soon as they're checked. Seen one somewhere? Share it and earn a credit.</Empty>
          )}
        </Tile>

        <Tile span="lg-4 md-2" tone="brand" label="Make space for someone">
          <TileHead kicker="Make space for someone" />
          <h2 style={{ fontSize: 26, lineHeight: "32px", maxWidth: "14ch" }}>Seen an opportunity? Pass it on.</h2>
          <p className="muted" style={{ maxWidth: "30ch" }}>Each new one we accept earns you 1 credit.</p>
          {data.subs[0] ? <span className="badge">Latest: {STATUS_COPY[data.subs[0].status]?.label ?? data.subs[0].status}</span> : null}
          <div className="tile-actions" style={{ position: "relative", zIndex: 1 }}>
            <Link className="btn ink" href="/contribute"><Icon name="plus" size={18} /> Share an opportunity</Link>
          </div>
          <Symbol variant="ink" className="tile-art" size={220} />
        </Tile>

        <Tile span="lg-5 md-3" label="Coming up next">
          <TileHead kicker="Coming up next" action={<Link href="/deadlines" className="meta">All dates</Link>} />
          {upcoming.length ? (
            <ul className="list">
              {upcoming.map(({ a }) => (
                <li key={a.id} className="stack-sm">
                  <Link href={`/applications/${a.id}`} style={{ fontWeight: 700 }}>{a.title}</Link>
                  {a.target_at ? <span className="meta">Your target: {formatInZone(new Date(a.target_at), tz)}</span> : null}
                  <DeadlineBlock d={a.deadline} tz={tz} compact />
                </li>
              ))}
            </ul>
          ) : (
            <Empty title="Nothing scheduled yet">Track an opportunity from the board to plan your preparation. We'll remind you before the official deadline.</Empty>
          )}
        </Tile>

        <Tile span="lg-4 md-3" label="My applications">
          <TileHead kicker="My applications" action={<Link href="/applications" className="meta">Open</Link>} />
          {focus ? (
            <div className="stack-sm">
              <strong>{focus.title}</strong>
              <span className="meta">{STATUS_LABEL[focus.status as keyof typeof STATUS_LABEL]} · {focus.task_done} of {focus.task_total} steps done</span>
              <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={focus.task_total} aria-valuenow={focus.task_done} aria-label="Checklist progress">
                <span style={{ width: `${focus.task_total ? (focus.task_done / focus.task_total) * 100 : 0}%` }} />
              </div>
              {focus.next_task ? <span>Next: {focus.next_task}</span> : <span className="muted">Checklist complete.</span>}
              <span className="meta">{active.length} in progress · {data.apps.filter((a: any) => a.status === "submitted").length} submitted</span>
            </div>
          ) : (
            <Empty title="No applications yet">Saved opportunities appear here with a checklist.</Empty>
          )}
        </Tile>

        <Tile span="lg-3 md-6" tone="subtle" label="Your credits">
          <TileHead kicker="Your credits" />
          <div className="big-number">{data.wallet?.balance ?? 0}</div>
          <span className="muted">Earned by sharing opportunities. Perks to spend them on are coming soon.</span>
          <div className="tile-actions"><Link href="/credits" className="btn small">History</Link></div>
        </Tile>
      </Bento>
    </div>
  );
}
