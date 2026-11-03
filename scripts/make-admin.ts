import { closePools, getPool } from "../src/db/pool";

/**
 * Grants a staff role to an existing account. Runs as the database owner
 * because only an admin context may change roles (see migration 0003), and
 * there is no admin yet when the first one is created.
 *
 *   npm run db:make-admin -- someone@example.com [admin|operator|reviewer]
 */
async function main() {
  const [email, role = "admin"] = process.argv.slice(2);
  if (!email || !["admin", "operator", "reviewer"].includes(role)) throw new Error("usage: make-admin <email> [admin|operator|reviewer]");
  const url = process.env.DATABASE_URL_OWNER;
  if (!url) throw new Error("DATABASE_URL_OWNER is not set");
  const c = await getPool(url).connect();
  try {
    await c.query("BEGIN");
    await c.query("SELECT set_config('occasio.staff', 'admin', true)");
    const r = await c.query("UPDATE occasio.users SET role = $2 WHERE email = $1 AND deleted_at IS NULL RETURNING id", [email, role]);
    if (!r.rowCount) throw new Error(`No active account with email ${email}. Sign up first.`);
    await c.query("DELETE FROM occasio.sessions WHERE user_id = $1", [r.rows[0].id]);
    await c.query(
      "INSERT INTO occasio.audit_events(actor_kind, action, target_type, target_id, reason, changes) VALUES ('system', 'user.role_changed', 'user', $1, 'make-admin script', $2)",
      [r.rows[0].id, JSON.stringify({ role })],
    );
    await c.query("COMMIT");
    console.log(`${email} is now ${role}. Sign in again.`);
  } catch (e) {
    await c.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    c.release();
    await closePools();
  }
}

main().catch((e) => { console.error(e.message); process.exitCode = 1; });
