import { exportAccount } from "@/domain/privacy";
import { asSelf, currentUser } from "@/server/session";

export async function GET() {
  const user = await currentUser();
  if (!user) return Response.json({ error: { code: "unauthenticated", message: "Sign in to continue." } }, { status: 401 });
  const data = await asSelf(user, (c) => exportAccount(c, user.id));
  return new Response(JSON.stringify(data, null, 2), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": `attachment; filename="occasio-export-${new Date().toISOString().slice(0, 10)}.json"`,
      "cache-control": "no-store",
    },
  });
}
