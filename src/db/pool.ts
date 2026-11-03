import pg from "pg";

// Return timestamps as Date and bigint counts as number where safe.
pg.types.setTypeParser(20, (v) => Number(v));

const pools = new Map<string, pg.Pool>();

export function getPool(url: string): pg.Pool {
  let pool = pools.get(url);
  if (!pool) {
    pool = new pg.Pool({ connectionString: url, max: 10, idleTimeoutMillis: 30_000 });
    pool.on("connect", (c) => {
      void c.query("SET search_path = occasio, public");
    });
    pools.set(url, pool);
  }
  return pool;
}

export async function closePools() {
  await Promise.all([...pools.values()].map((p) => p.end()));
  pools.clear();
}
