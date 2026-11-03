import Link from "next/link";
import { notFound } from "next/navigation";
import { matchFeedbackAction, redeemAction } from "@/app/actions/exchange";
import { Bento, Tile, TileHead } from "@/components/Bento";
import { ActionForm, Submit } from "@/components/Form";
import { DeadlineBlock, FEE_LABEL, LOCATION_LABEL, TrustList } from "@/components/Opportunity";
import { one } from "@/db/tx";
import { CATEGORY_LABEL, getPreview } from "@/domain/catalog";
import { getMatch } from "@/domain/matching";
import { asSelf, currentProfile, requireUser } from "@/server/session";

export const metadata = { title: "Your match" };

export default async function MatchPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser(`/matches/${id}`);
  const tz = (await currentProfile())?.timezone ?? "UTC";
  const data = await asSelf(user, async (c) => {
    const m = await getMatch(c, id);
    if (!m) return null;
    const o = m.selected_opportunity_id ? await getPreview(c, m.selected_opportunity_id, user.id, false) : null;
    const w = await one(c, "SELECT balance, starter_available FROM wallets WHERE user_id = $1", [user.id]);
    return { m, o, w };
  });
  if (!data) notFound();
  const { m, o, w } = data;
  const x = m.explanation ?? {};

  if (m.state === "no_match") {
    const excluded = Object.entries((x.excluded ?? {}) as Record<string, number>);
    return (
      <div className="page" style={{ maxWidth: 880 }}>
        <header className="page-head"><div><h1>No fit right now</h1><p>You weren't charged. Here's what we ruled out and why.</p></div></header>
        <div className="tile stack">
          {excluded.length ? (
            <ul className="list">{excluded.map(([why, n]) => <li key={why} className="row-between"><span>{why}</span><span className="badge outline">{n}</span></li>)}</ul>
          ) : <p className="muted" style={{ margin: 0 }}>Nothing in the bank matches these filters yet.</p>}
          {x.reasons?.length ? <ul>{x.reasons.map((r: string) => <li key={r}>{r}</li>)}</ul> : null}
          <div className="row">
            <Link className="btn primary" href="/matches">Try different words</Link>
            <Link className="btn" href="/settings/profile">Update my profile</Link>
            <Link className="btn ghost" href="/contribute">Share an opportunity</Link>
          </div>
        </div>
      </div>
    );
  }
  if (m.state === "needs_clarification") {
    return (
      <div className="page" style={{ maxWidth: 880 }}>
        <header className="page-head"><div><h1>One more detail</h1><p>Some opportunities depend on details we don't have. We won't guess; you haven't been charged.</p></div></header>
        <div className="tile stack">
          <ul>{(m.clarifications ?? []).map((q: string) => <li key={q}>{q}</li>)}</ul>
          <div className="row">
            <Link className="btn primary" href="/settings/profile">Add these to my profile</Link>
            <Link className="btn" href="/matches">Ask again</Link>
          </div>
        </div>
      </div>
    );
  }
  if (!o) notFound();
  const redeemed = m.state === "redeemed";
  return (
    <div className="page">
      <header className="page-head">
        <div><h1>{redeemed ? "Unlocked" : "Here's a fit"}</h1><p>{m.query_text ? `For “${m.query_text}”.` : "Based on your profile."} Nothing is charged until you unlock.</p></div>
      </header>
      <Bento>
        <Tile span="lg-8 md-4" as="article">
          <div className="row"><span className="badge">{CATEGORY_LABEL[o.category]}</span>{o.is_fixture ? <span className="badge warn">Sample data</span> : null}</div>
          <h2 style={{ fontSize: 30, lineHeight: "36px" }}>{o.title}</h2>
          <span className="muted">{o.organizer} · {LOCATION_LABEL[o.location_mode]} · {FEE_LABEL[o.fee]}</span>
          {o.summary ? <p>{o.summary}</p> : null}
          <div className="stack-sm">
            <h3>Why it fits</h3>
            <ul style={{ margin: 0, paddingLeft: 18 }}>
              {(x.reasons ?? []).map((r: string) => <li key={r}>{r}</li>)}
              {(x.eligibility ?? []).map((r: string) => <li key={r}>{r}</li>)}
            </ul>
          </div>
          {x.requirements?.length ? (
            <div className="stack-sm"><h3>What you'll need</h3><ul style={{ margin: 0, paddingLeft: 18 }}>{x.requirements.map((r: string) => <li key={r}>{r}</li>)}</ul></div>
          ) : null}
          <div className="stack-sm"><h3>Source and freshness</h3><TrustList o={o} /></div>
        </Tile>
        <Tile span="lg-4 md-2" tone="subtle" as="aside">
          <DeadlineBlock d={o.deadline} tz={tz} />
          {redeemed || o.unlocked ? (
            <Link href={`/opportunities/${o.id}`} className="btn primary block">Open full details</Link>
          ) : (
            <ActionForm action={redeemAction}>
              <input type="hidden" name="matchId" value={m.id} />
              <Submit className="btn primary block" pending="Unlocking…">{w?.starter_available ? "Unlock with my starter match" : "Unlock for 1 credit"}</Submit>
              <span className="meta">
                {w?.starter_available ? "Your free starter match is used first. " : `You have ${w?.balance ?? 0} credit${w?.balance === 1 ? "" : "s"}. `}
                We re-check it's still open at the moment you unlock; if anything changed, you aren't charged.
              </span>
            </ActionForm>
          )}
          {!redeemed ? (
            <form action={matchFeedbackAction} className="row">
              <input type="hidden" name="matchId" value={m.id} />
              <button className="btn ghost small" name="feedback" value="not_interested" type="submit" aria-pressed={m.feedback === "not_interested"}>Not for me</button>
              <Link className="btn ghost small" href="/matches">Ask for something else</Link>
            </form>
          ) : null}
        </Tile>
      </Bento>
    </div>
  );
}
