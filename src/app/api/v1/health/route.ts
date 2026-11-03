import { withAnon } from "@/db/tx";

export const dynamic = "force-dynamic";

/** Liveness and database reachability. Reveals no configuration. */
export async function GET() {
  const started = Date.now();
  try {
    await withAnon((c) => c.query("SELECT 1"));
    return Response.json({ ok: true, db: "ok", ms: Date.now() - started }, { headers: { "cache-control": "no-store" } });
  } catch {
    return Response.json({ ok: false, db: "unreachable" }, { status: 503, headers: { "cache-control": "no-store" } });
  }
}
