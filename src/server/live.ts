import "server-only";
import { createRealtime, pgParam, rawSql } from "@neon/realtime/server";

// Neon Realtime (beta). Sealing is local encryption with the server-only
// secret; the browser only ever sees the sealed query and the public URL.
// Realtime does not apply RLS, so every live query authorizes inside its own
// SQL (user_id = the session's user, bound when sealed).

export type UnreadRow = { id: string };

export function liveEnabled(): boolean {
  return Boolean(process.env.NEON_REALTIME_SECRET && process.env.NEXT_PUBLIC_NEON_REALTIME_URL);
}

let realtime: ReturnType<typeof createRealtime> | null = null;
function rt() {
  if (!realtime) {
    const url = process.env.DATABASE_URL_APP ?? "";
    const db = process.env.NEON_REALTIME_DB ?? (decodeURIComponent(new URL(url).pathname.slice(1)) || "neondb");
    realtime = createRealtime({
      secret: process.env.NEON_REALTIME_SECRET!,
      db,
      debugMode: process.env.OCCASIO_MODE === "development",
    });
  }
  return realtime;
}

export function unreadQuery(userId: string) {
  return rawSql<UnreadRow>(
    `SELECT n.id FROM occasio.notifications n
       JOIN occasio.users u ON u.id = n.user_id
      WHERE n.user_id = $1 AND n.read_at IS NULL AND u.deleted_at IS NULL`,
    [pgParam.text("uuid", userId)],
  );
}

export async function sealUnread(userId: string) {
  return rt().seal({ query: unreadQuery(userId) });
}
