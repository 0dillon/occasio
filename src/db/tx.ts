import type pg from "pg";
import { getPool } from "./pool";

export type Db = pg.PoolClient;
export type Role = "member" | "reviewer" | "operator" | "admin";

export class DbConfig {
  constructor(
    public appUrl: string,
    public workerUrl: string,
  ) {}
}

let config: DbConfig | undefined;
export function configureDb(c: DbConfig) {
  config = c;
}
function cfg(): DbConfig {
  if (!config) {
    const app = process.env.DATABASE_URL_APP;
    const worker = process.env.DATABASE_URL_WORKER ?? app;
    if (!app || !worker) throw new Error("DATABASE_URL_APP is not configured");
    config = new DbConfig(app, worker);
  }
  return config;
}

async function run<T>(url: string, setup: (c: Db) => Promise<void>, fn: (c: Db) => Promise<T>): Promise<T> {
  const client = await getPool(url).connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL search_path = occasio, public");
    await setup(client);
    const out = await fn(client);
    await client.query("COMMIT");
    return out;
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

/**
 * Runs fn in a transaction as the request-scoped app role with a verified
 * user identity set transaction-locally (set_config(..., true)). Row policies
 * use it; it disappears at COMMIT/ROLLBACK so a pooled connection cannot leak
 * identity into the next request.
 */
export function withUser<T>(userId: string, fn: (c: Db) => Promise<T>): Promise<T> {
  return run(cfg().appUrl, async (c) => {
    await c.query("SELECT set_config('occasio.user_id', $1, true)", [userId]);
  }, fn);
}

/** Staff context: only call after the server verified the role from the DB. */
export function withStaff<T>(userId: string, role: Role, fn: (c: Db) => Promise<T>): Promise<T> {
  if (role === "member") throw new Error("withStaff requires a staff role");
  return run(cfg().appUrl, async (c) => {
    await c.query("SELECT set_config('occasio.user_id', $1, true)", [userId]);
    await c.query("SELECT set_config('occasio.staff', $1, true)", [role]);
  }, fn);
}

/** Anonymous app-role transaction: public catalog and auth tables only. */
export function withAnon<T>(fn: (c: Db) => Promise<T>): Promise<T> {
  return run(cfg().appUrl, async () => {}, fn);
}

/** Trusted worker identity: background jobs only, never request handlers. */
export function withWorker<T>(fn: (c: Db) => Promise<T>): Promise<T> {
  return run(cfg().workerUrl, async () => {}, fn);
}

export async function one<T = any>(c: Db, sql: string, params: unknown[] = []): Promise<T | undefined> {
  const r = await c.query(sql, params);
  return r.rows[0] as T | undefined;
}
export async function many<T = any>(c: Db, sql: string, params: unknown[] = []): Promise<T[]> {
  const r = await c.query(sql, params);
  return r.rows as T[];
}
