import { getObject } from "@/adapters/storage";
import { one } from "@/db/tx";
import { asUser, currentUser } from "@/server/session";

/** Private poster images: only the uploader and staff can fetch them. */
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await currentUser();
  if (!user) return new Response("Sign in required", { status: 401 });
  if (!/^[0-9a-f-]{36}$/.test(id)) return new Response("Not found", { status: 404 });
  const a = await asUser(user, (c) => one<{ object_key: string; mime: string }>(c, "SELECT object_key, mime FROM submission_assets WHERE id = $1", [id]));
  if (!a) return new Response("Not found", { status: 404 });
  const data = await getObject(a.object_key).catch(() => null);
  if (!data) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(data), {
    headers: { "content-type": a.mime, "cache-control": "private, max-age=300", "x-content-type-options": "nosniff", "content-security-policy": "default-src 'none'" },
  });
}
