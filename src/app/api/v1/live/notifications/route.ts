import { NextResponse } from "next/server";
import { liveEnabled, sealUnread } from "@/server/live";
import { appOrigin, currentUser } from "@/server/session";

export const dynamic = "force-dynamic";

// Renews the sealed unread-notifications query. Sealed queries expire after
// about a minute, so the browser calls this on a timer. Every renewal re-checks
// the session, and refuses if the signed-in user changed since the page loaded.
export async function POST(req: Request) {
  if (!liveEnabled()) return NextResponse.json({ error: "live_disabled" }, { status: 404 });
  const origin = req.headers.get("origin");
  if (origin && origin !== (await appOrigin())) return NextResponse.json({ error: "bad_origin" }, { status: 403 });
  const user = await currentUser();
  if (!user || user.state === "frozen") return NextResponse.json({ error: "signed_out" }, { status: 401 });
  const body = (await req.json().catch(() => null)) as { userId?: unknown } | null;
  if (!body || body.userId !== user.id) return NextResponse.json({ error: "session_changed" }, { status: 409 });
  const sealed = await sealUnread(user.id);
  return NextResponse.json(sealed, { headers: { "Cache-Control": "no-store" } });
}
