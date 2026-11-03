import Link from "next/link";
import { markNotificationsReadAction } from "@/app/actions/tracker";
import { Empty, PageHead } from "@/components/Bento";
import { many } from "@/db/tx";
import { formatInZone } from "@/lib/time";
import { asSelf, currentProfile, requireUser } from "@/server/session";

export const metadata = { title: "Notifications" };

export default async function Notifications() {
  const user = await requireUser("/notifications");
  const tz = (await currentProfile())?.timezone ?? "UTC";
  const items = await asSelf(user, (c) => many(c, "SELECT id, kind, title, body, link, created_at, read_at FROM notifications WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50", [user.id]));
  const unread = items.filter((n) => !n.read_at).length;
  return (
    <div className="page" style={{ maxWidth: 880 }}>
      <PageHead title="Notifications" intro={unread ? `${unread} unread` : "You're all caught up."}
        actions={unread ? <form action={markNotificationsReadAction}><button className="btn small" type="submit">Mark all read</button></form> : undefined} />
      {items.length ? (
        <ul className="list tile">
          {items.map((n) => (
            <li key={n.id} className="row-between" style={{ alignItems: "start" }}>
              <div className="stack-sm grow">
                <strong>{!n.read_at ? <span className="badge lime" style={{ marginRight: 8 }}>New</span> : null}{n.title}</strong>
                <span>{n.body}</span>
                <span className="meta">{formatInZone(new Date(n.created_at), tz)}</span>
              </div>
              <div className="row">
                {n.link ? <Link className="btn small" href={n.link}>Open</Link> : null}
                {!n.read_at ? (
                  <form action={markNotificationsReadAction}><input type="hidden" name="id" value={n.id} /><button className="btn ghost small" type="submit">Mark read</button></form>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      ) : <Empty title="No notifications yet">Updates about your shares, matches and reminders appear here.</Empty>}
    </div>
  );
}
