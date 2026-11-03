import Link from "next/link";
import { refundAction } from "@/app/actions/exchange";
import { Bento, Empty, PageHead, Tile, TileHead } from "@/components/Bento";
import { ActionForm, Field, Submit } from "@/components/Form";
import { many } from "@/db/tx";
import { walletSummary } from "@/domain/exchange";
import { formatInZone } from "@/lib/time";
import { asSelf, currentProfile, requireUser } from "@/server/session";

export const metadata = { title: "Credits" };
const REASON: Record<string, string> = { contribution_award: "Shared a new opportunity", match_redemption: "Unlocked a match", refund: "Refund", correction: "Correction" };

export default async function Credits() {
  const user = await requireUser("/credits");
  const tz = (await currentProfile())?.timezone ?? "UTC";
  const { w, unlocks } = await asSelf(user, async (c) => ({
    w: await walletSummary(c, user.id),
    unlocks: await many(c, `SELECT e.id, e.via, e.unlocked_at, o.title, r.state AS refund_state FROM entitlements e JOIN opportunities o ON o.id = e.opportunity_id
                             LEFT JOIN refund_requests r ON r.entitlement_id = e.id WHERE e.user_id = $1 AND e.via = 'credit' ORDER BY e.unlocked_at DESC LIMIT 20`, [user.id]),
  }));
  const refundable = unlocks.filter((u) => !u.refund_state);
  return (
    <div className="page">
      <PageHead title="Credits" intro="Credits are noncash. You earn one when an opportunity you share is accepted as new, and spend one to unlock a match. They can't be bought or cashed out." />
      <Bento>
        <Tile span="lg-4 md-2" tone="brand">
          <TileHead kicker="Available" />
          <div className="big-number">{w.balance}</div>
          <span className="muted">credit{w.balance === 1 ? "" : "s"}{w.starterAvailable ? " · plus 1 free starter match" : ""}</span>
          {w.frozen ? <span className="badge">Paused while we review your account</span> : null}
          <div className="tile-actions"><Link href="/contribute" className="btn ink">Earn one: share an opportunity</Link></div>
        </Tile>
        <Tile span="lg-8 md-4">
          <TileHead kicker="History" />
          {w.ledger.length ? (
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th scope="col">When</th><th scope="col">What</th><th scope="col" style={{ textAlign: "right" }}>Change</th></tr></thead>
                <tbody>
                  {w.ledger.map((l: any) => (
                    <tr key={l.id}>
                      <td>{formatInZone(new Date(l.created_at), tz)}</td>
                      <td>{REASON[l.reason] ?? l.reason}{l.opportunity_title ? ` · ${l.opportunity_title}` : ""}{l.note && l.reason !== "match_redemption" && l.reason !== "contribution_award" ? ` · ${l.note}` : ""}</td>
                      <td style={{ textAlign: "right", fontWeight: 700 }}>{l.delta > 0 ? `+${l.delta}` : l.delta}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <Empty title="No credit activity yet">Your history is permanent: entries are never edited, only added.</Empty>}
        </Tile>
        <Tile span="lg-12" tone="flat">
          <TileHead kicker="Something wrong with an unlock?" />
          {refundable.length ? (
            <ActionForm action={refundAction} className="form-grid two">
              <Field name="entitlementId" label="Which unlock" inputId="f-ent">
                <select id="f-ent" name="entitlementId" className="select">{refundable.map((u) => <option key={u.id} value={u.id}>{u.title}</option>)}</select>
              </Field>
              <Field name="reason" label="What happened" inputId="f-reason">
                <select id="f-reason" name="reason" className="select">
                  <option value="expired_at_redemption">It was already closed when I unlocked it</option>
                  <option value="duplicate">I'd already unlocked the same opportunity</option>
                  <option value="clearly_ineligible">The rules clearly exclude me</option>
                </select>
              </Field>
              <div className="full"><Field name="detail" label="Details" textarea maxLength={1000} /></div>
              <div className="full"><Submit className="btn">Ask for a review</Submit></div>
            </ActionForm>
          ) : <p className="muted" style={{ margin: 0 }}>Credit unlocks you can ask us to review appear here.</p>}
          {unlocks.some((u) => u.refund_state) ? (
            <ul className="stack-sm" style={{ margin: 0, paddingLeft: 18 }}>
              {unlocks.filter((u) => u.refund_state).map((u) => <li key={u.id}>{u.title}: review {u.refund_state}</li>)}
            </ul>
          ) : null}
        </Tile>
      </Bento>
    </div>
  );
}
