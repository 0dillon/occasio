import { neonConfig, Pool as NeonPool, types as neonTypes } from "@neondatabase/serverless";
import pg from "pg";
import ws from "ws";

/**
 * Two interchangeable drivers with the same Pool/Client API:
 * - "pg": TCP (local Postgres, or Neon from a long-running Node server).
 * - "neon": Neon's serverless driver over WebSockets (port 443), for
 *   serverless hosts and environments where outbound 5432 is blocked.
 * Transactions, row security and set_config(..., true) behave the same.
 */
for (const t of [pg.types, neonTypes]) {
  // Counts as numbers; calendar dates stay YYYY-MM-DD strings (a JS Date would
  // shift them by the server's timezone).
  t.setTypeParser(20, (v: string) => Number(v));
  t.setTypeParser(1082, (v: string) => v);
}
neonConfig.webSocketConstructor = ws;

export type Driver = "pg" | "neon";
export function driverFor(url: string): Driver {
  const d = process.env.DATABASE_DRIVER;
  if (d === "pg" || d === "neon") return d;
  return "pg";
}

const pools = new Map<string, pg.Pool>();

export function getPool(url: string): pg.Pool {
  let pool = pools.get(url);
  if (!pool) {
    pool = driverFor(url) === "neon"
      ? (new NeonPool({ connectionString: url, max: 10, idleTimeoutMillis: 30_000 }) as unknown as pg.Pool)
      : new pg.Pool({ connectionString: url, max: 10, idleTimeoutMillis: 30_000 });
    pools.set(url, pool);
  }
  return pool;
}

export async function closePools() {
  await Promise.all([...pools.values()].map((p) => p.end()));
  pools.clear();
}
