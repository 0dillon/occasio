import { pathToFileURL } from "node:url";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { getPool, closePools } from "../src/db/pool";

// Applies migrations/*.sql in order as the owner role. Each file runs in one
// transaction and is recorded so it never runs twice.
export async function migrate(url: string, log = console.log) {
  const client = await getPool(url).connect();
  try {
    await client.query(`CREATE TABLE IF NOT EXISTS public.schema_migrations (
      name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`);
    const done = new Set(
      (await client.query("SELECT name FROM public.schema_migrations")).rows.map((r) => r.name),
    );
    const dir = join(process.cwd(), "migrations");
    for (const file of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
      if (done.has(file)) continue;
      await client.query("BEGIN");
      try {
        await client.query(readFileSync(join(dir, file), "utf8"));
        await client.query("INSERT INTO public.schema_migrations(name) VALUES ($1)", [file]);
        await client.query("COMMIT");
        log(`applied ${file}`);
      } catch (e) {
        await client.query("ROLLBACK");
        throw new Error(`migration ${file} failed: ${(e as Error).message}`);
      }
    }
  } finally {
    client.release();
    await closePools();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const url = process.env.DATABASE_URL_OWNER;
  if (!url) throw new Error("DATABASE_URL_OWNER is required");
  migrate(url).then(() => console.log("migrations up to date"));
}
