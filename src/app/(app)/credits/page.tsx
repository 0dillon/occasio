import Link from "next/link";
import { Bento, Empty, PageHead, Tile, TileHead } from "@/components/Bento";
import { deleteAlertAction } from "@/app/actions/perks";
import { walletSummary } from "@/domain/exchange";
import { describeAlert, getPerks, listAlerts } from "@/domain/perks";
import { referralCode, referralSummary } from "@/domain/referrals";
import { InviteLink } from "@/components/InviteLink";
import { productRules } from "@/config/product-rules";
import { formatInZone } from "@/lib/time";
import { appOrigin, asSelf, currentProfile, requireUser } from "@/server/session";

export const metadata = { title: "Credits" };
const REASON: Record<string, string> = { contribution_award: "Shared a new opportunity", referral_award: "Someone you invited joined", match_redemption: "Unlocked a match", refund: "Refund", correction: "Correction" };

export default async function Credits() {
  const user = await requireUser("/credits");
  const tz = (await currentProfile())?.timezone ?? "UTC";
  const w = await asSelf(user, (c) => walletSummary(c, user.id));
  const perks = await asSelf(user, (c) => getPerks(c, user.id));
  const alerts = await asSelf(user, (c) => listAlerts(c, user.id));
  const code = await asSelf(user, (c) => referralCode(c, user.id));
  const refs = await asSelf(user, (c) => referralSummary(c, user.id));
  const inviteUrl = `${await appOrigin()}/r/${code}`;
  const perInvite = productRules.proposed.creditsPerReferral;
  return (
    <div className="page">
      <PageHead title="Credits" intro="Earn credits two ways: share an opportunity you're applying to that isn't on the board yet, or invite someone who joins. The board is free for everyone. Credits can't be bought or cashed out." />
      <Bento>
        <Tile span="lg-4 md-2" tone="brand">
          <TileHead kicker="Available" />
          <div className="big-number">{w.balance}</div>
          <span className="muted">credit{w.balance === 1 ? "" : "s"}</span>
          {perks.contributorBadge ? <span className="badge" style={{ alignSelf: "flex-start" }}>Contributor</span> : null}
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
                      <td>{REASON[l.reason] ?? l.reason}{l.opportunity_title ? ` · ${l.opportunity_title}` : ""}{l.note && l.reason !== "match_redemption" && l.reason !== "contribution_award" && l.reason !== "referral_award" ? ` · ${l.note}` : ""}</td>
                      <td style={{ textAlign: "right", fontWeight: 700 }}>{l.delta > 0 ? `+${l.delta}` : l.delta}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <Empty title="No credit activity yet">Share an opportunity you've come across. When it's added, your first credit appears here.</Empty>}
        </Tile>
        <Tile span="lg-12" label="Invite people">
          <TileHead kicker="Invite people" />
          <p style={{ marginTop: 0, maxWidth: "62ch" }}>Send your link to anyone hunting for their next opening. When they join and confirm their email, you get {perInvite} credit{perInvite === 1 ? "" : "s"}.</p>
          <InviteLink url={inviteUrl} />
          <p className="meta" style={{ margin: 0 }}>{refs.joined ? `${refs.joined} joined with your link · ${refs.credited} earned you a credit${refs.joined > refs.confirmed ? ` · ${refs.joined - refs.confirmed} still to confirm their email` : ""}` : "Nobody has joined with your link yet."}</p>
        </Tile>
        <Tile span="lg-6 md-3" label="Perks">
          <TileHead kicker="Perks" />
          <p className="muted" style={{ marginTop: 0 }}>Perks come from the credits you've earned over time ({perks.earned} so far). Reaching one doesn't use any up.</p>
          <ul className="perk-list">
            <li className={perks.contributorBadge ? "done" : ""}>
              <strong>Contributor badge</strong>
              <span className="muted">{perks.contributorBadge ? "Unlocked. Listings you shared are marked “Shared by you”." : `At ${perks.thresholds.contributorBadge} credit earned.`}</span>
            </li>
            <li className={perks.personalAlerts ? "done" : ""}>
              <strong>Personal alerts</strong>
              <span className="muted">{perks.personalAlerts ? "Unlocked. Filter Discover and choose “Alert me”." : `At ${perks.thresholds.personalAlerts} credits earned. ${Math.max(0, perks.thresholds.personalAlerts - perks.earned)} to go.`}</span>
            </li>
          </ul>
        </Tile>
        <Tile span="lg-6 md-3" label="Your alerts">
          <TileHead kicker="Your alerts" />
          {alerts.length ? (
            <ul className="perk-list">
              {alerts.map((a) => (
                <li key={a.id} className="row-between">
                  <span>{a.label ?? describeAlert(a.query)}</span>
                  <form action={deleteAlertAction}><input type="hidden" name="id" value={a.id} /><button className="btn ghost small" type="submit">Remove</button></form>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted" style={{ margin: 0 }}>{perks.personalAlerts ? "No alerts yet. Filter Discover and choose “Alert me” to get an email and a notice when a new listing matches." : "Once alerts open up, you'll manage them here."}</p>
          )}
        </Tile>
      </Bento>
    </div>
  );
}
