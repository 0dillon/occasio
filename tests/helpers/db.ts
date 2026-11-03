import { closePools, getPool } from "@/db/pool";
import { withWorker } from "@/db/tx";
import { newToken } from "@/lib/security";

/** Truncates every product table (owner role). Only allowed on the test database. */
export async function resetDb() {
  const url = process.env.DATABASE_URL_OWNER!;
  if (!url.includes("/occasio_test")) throw new Error("refusing to reset a non-test database");
  const c = await getPool(url).connect();
  try {
    const { rows } = await c.query(
      "SELECT tablename FROM pg_tables WHERE schemaname = 'occasio'",
    );
    await c.query(`TRUNCATE ${rows.map((r) => `occasio."${r.tablename}"`).join(", ")} RESTART IDENTITY CASCADE`);
    await c.query(`INSERT INTO occasio.app_flags(key, value) VALUES
      ('discovery_enabled','true'),('ai_extraction_enabled','true'),('email_enabled','true'),('auto_publish_enabled','false')`);
  } finally {
    c.release();
  }
}

export async function ownerQuery(sql: string, params: unknown[] = []) {
  const c = await getPool(process.env.DATABASE_URL_OWNER!).connect();
  try {
    await c.query("SET search_path = occasio, public");
    return (await c.query(sql, params)).rows;
  } finally {
    c.release();
  }
}

export { closePools, withWorker, newToken };
