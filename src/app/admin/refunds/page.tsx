import { decideRefundAction } from "@/app/actions/admin";
import { Empty, PageHead, Tile } from "@/components/Bento";
import { when } from "@/components/admin/when";
import { ActionForm, Field, Submit } from "@/components/Form";
import { many } from "@/db/tx";
import { asUser, requireStaff } from "@/server/session";

export const metadata = { title: "Refunds" };
const REASON: Record<string, string> = { expired_at_redemption: "Closed when unlocked", duplicate: "Duplicate unlock", clearly_ineligible: "Clearly ineligible" };

export default async function Refunds() {
  const u = await requireStaff("operator");
  const rows = await asUser(u, (c) => many<any>(c,
    `SELECT r.*, o.title, e.unlocked_at FROM refund_requests r JOIN entitlements e ON e.id = r.entitlement_id JOIN opportunities o ON o.id = e.opportunity_id
      ORDER BY (r.state = 'open') DESC, r.created_at LIMIT 100`));
  return (
    <>
      <PageHead title="Refund requests" intro="Approving appends a +1 refund entry to the ledger. Existing entries are never edited." />
      <Tile span="lg-12">
        {rows.length ? (
          <ul className="list">
            {rows.map((r) => (
              <li key={r.id} className="stack-sm">
                <div className="row-between"><div><span className="badge">{REASON[r.reason]}</span> <strong>{r.title}</strong></div><span className="muted">{r.state} · asked {when(r.created_at)}</span></div>
                <div className="muted" style={{ fontSize: 14 }}>Unlocked {when(r.unlocked_at)}</div>
                {r.detail ? <p className="evidence pre">{r.detail}</p> : null}
                {r.state === "open" ? (
                  <ActionForm action={decideRefundAction} className="form-grid two">
                    <input type="hidden" name="id" value={r.id} />
                    <div className="full"><Field name="reason" label="Reason the member will see" required maxLength={500} /></div>
                    <div className="row full">
                      <Submit className="btn small" name="decision" value="approve">Approve refund</Submit>
                      <Submit className="btn ghost small" name="decision" value="reject">Decline</Submit>
                    </div>
                  </ActionForm>
                ) : <p className="muted" style={{ margin: 0 }}>{r.decision_reason}</p>}
              </li>
            ))}
          </ul>
        ) : <Empty title="No refund requests" />}
      </Tile>
    </>
  );
}
