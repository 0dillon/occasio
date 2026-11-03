import Link from "next/link";
import { requestMatchAction } from "@/app/actions/exchange";
import { Bento, Empty, PageHead, Tile, TileHead } from "@/components/Bento";
import { ActionForm, Field, Submit } from "@/components/Form";
import { many, one } from "@/db/tx";
import { CATEGORIES, CATEGORY_LABEL } from "@/domain/catalog";
import { formatInZone } from "@/lib/time";
import { asSelf, currentProfile, requireUser } from "@/server/session";

export const metadata = { title: "Find a match" };
const STATE: Record<string, string> = { candidate_ready: "Fit found", needs_clarification: "Needs a detail", no_match: "No fit, not charged", redeemed: "Unlocked", open: "Checking" };

export default async function Matches() {
  const user = await requireUser("/matches");
  const tz = (await currentProfile())?.timezone ?? "UTC";
  const { history, wallet } = await asSelf(user, async (c) => ({
    history: await many(c, `SELECT m.id, m.state, m.query_text, m.created_at, o.title FROM match_requests m
                              LEFT JOIN opportunities o ON o.id = m.selected_opportunity_id WHERE m.user_id = $1 ORDER BY m.created_at DESC LIMIT 10`, [user.id]),
    wallet: await one(c, "SELECT balance, starter_available FROM wallets WHERE user_id = $1", [user.id]),
  }));
  return (
    <div className="page">
      <PageHead title="Find a match" intro="Describe what you want in your own words. We only suggest opportunities that are open, recently checked and fit what we know about you." />
      <Bento>
        <Tile span="lg-8 md-4">
          <ActionForm action={requestMatchAction}>
            <Field name="query" label="What are you looking for?" textarea placeholder="e.g. a remote fintech hackathon with no fee, or a master's scholarship in public health" maxLength={500} />
            <div className="form-grid two">
              <Field name="category" label="Kind" inputId="f-cat">
                <select id="f-cat" name="category" className="select" defaultValue="">
                  <option value="">Any kind</option>
                  {CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>)}
                </select>
              </Field>
              <fieldset className="stack-sm" style={{ alignSelf: "end" }}>
                <legend className="sr-only">Constraints</legend>
                <label className="check"><input type="checkbox" name="remoteOnly" /> Remote only</label>
                <label className="check"><input type="checkbox" name="freeOnly" /> No application fee</label>
              </fieldset>
            </div>
            <div className="row">
              <Submit pending="Looking…">Find a fit</Submit>
              <span className="meta">Looking is free. You only spend a credit if you choose to unlock a result.</span>
            </div>
          </ActionForm>
        </Tile>
        <Tile span="lg-4 md-2" tone="subtle">
          <TileHead kicker="How unlocking works" />
          <ol className="steps">
            <li><span>We check eligibility, the deadline and that the source was checked in the last 3 days.</span></li>
            <li><span>You see why it fits before deciding.</span></li>
            <li><span>Unlocking uses {wallet?.starter_available ? "your free starter match first, then " : ""}1 credit. If nothing fits, nothing is charged.</span></li>
          </ol>
          <span className="meta">You have {wallet?.balance ?? 0} credit{wallet?.balance === 1 ? "" : "s"}.</span>
        </Tile>
        <Tile span="lg-12" tone="flat">
          <TileHead kicker="Recent requests" />
          {history.length ? (
            <ul className="list">
              {history.map((m) => (
                <li key={m.id} className="row-between">
                  <div className="stack-sm">
                    <Link href={`/matches/${m.id}`} style={{ fontWeight: 700 }}>{m.query_text || (m.title ? m.title : "Based on your profile")}</Link>
                    <span className="meta">{formatInZone(new Date(m.created_at), tz)}</span>
                  </div>
                  <span className="badge outline">{STATE[m.state] ?? m.state}</span>
                </li>
              ))}
            </ul>
          ) : <Empty title="No requests yet">Your match requests and their outcomes appear here.</Empty>}
        </Tile>
      </Bento>
    </div>
  );
}
