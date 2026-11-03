import { closePools, getPool } from "../src/db/pool";

/**
 * Creates the two runtime roles the app connects as. Both are LOGIN,
 * NOSUPERUSER, NOBYPASSRLS and own nothing, so row security always applies.
 * Run once per database as the owner, before migrations.
 *
 *   DATABASE_URL_OWNER=... OCCASIO_APP_DB_PASSWORD=... OCCASIO_WORKER_DB_PASSWORD=... npm run db:setup-roles
 */
export async function setupRoles(ownerUrl: string, passwords: { app: string; worker: string }) {
  const c = await getPool(ownerUrl).connect();
  try {
    for (const [role, pw] of [["occasio_app", passwords.app], ["occasio_worker", passwords.worker]] as const) {
      if (pw.length < 24) throw new Error(`${role} password must be at least 24 characters`);
      const exists = (await c.query("SELECT 1 FROM pg_roles WHERE rolname = $1", [role])).rowCount;
      // Identifiers are constants above; the password is escaped as a literal.
      const lit = "'" + pw.replace(/'/g, "''") + "'";
      await c.query(`${exists ? "ALTER" : "CREATE"} ROLE ${role} WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS PASSWORD ${lit}`);
      await c.query(`ALTER ROLE ${role} SET search_path = occasio, public`);
      console.log(`${exists ? "updated" : "created"} ${role}`);
    }
  } finally {
    c.release();
    await closePools();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const url = process.env.DATABASE_URL_OWNER;
  const app = process.env.OCCASIO_APP_DB_PASSWORD;
  const worker = process.env.OCCASIO_WORKER_DB_PASSWORD;
  if (!url || !app || !worker) throw new Error("DATABASE_URL_OWNER, OCCASIO_APP_DB_PASSWORD and OCCASIO_WORKER_DB_PASSWORD are required");
  setupRoles(url, { app, worker }).catch((e) => { console.error(e.message); process.exit(1); });
}
