import { notFound } from "next/navigation";
import { Empty, PageHead, Tile } from "@/components/Bento";
import { when } from "@/components/admin/when";
import { many } from "@/db/tx";
import { asUser, requireStaff } from "@/server/session";

export const metadata = { title: "Dev mail" };

/** Development-only sink: what email would have been sent. Nothing here was delivered. */
export default async function DevMail() {
  if (process.env.OCCASIO_MODE !== "development") notFound();
  const u = await requireStaff("reviewer");
  const rows = await asUser(u, (c) => many<any>(c, "SELECT * FROM dev_mail ORDER BY created_at DESC LIMIT 50"));
  return (
    <>
      <PageHead title="Development mail sink" intro="No email provider is configured, so the worker writes mail here instead of sending it. Nothing on this page was delivered to anyone." />
      <Tile span="lg-12">
        {rows.length ? (
          <ul className="list">{rows.map((m) => (
            <li key={m.id} className="stack-sm">
              <div className="row-between"><strong>{m.subject}</strong><span className="muted">to {m.to_address} · {when(m.created_at)}</span></div>
              <p className="pre">{m.text_body}</p>
            </li>
          ))}</ul>
        ) : <Empty title="No mail yet">Sign up, reset a password or schedule a reminder, then run the worker.</Empty>}
      </Tile>
    </>
  );
}
