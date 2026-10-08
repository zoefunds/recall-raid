import { Pool } from "pg";
import { config } from "./config.js";

export const pool = new Pool({
  connectionString: config.databaseUrl,
  max: 10,
  idleTimeoutMillis: 30_000,
});

// An idle/background client error must never crash this always-on process.
pool.on("error", (err) => {
  // eslint-disable-next-line no-console
  console.error("Unexpected Postgres pool error", err);
});

export async function withTransaction<T>(fn: (client: import("pg").PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Runs a cross-machine job once. PostgreSQL advisory locks are bound to the
 * checked-out connection, so they are released automatically if a Fly
 * machine dies. This is deliberately separate from row transactions: it
 * protects a whole poll/sync sweep, including its network reads, rather than
 * only a single SQL statement.
 */
export async function withAdvisoryLock<T>(lockKey: number, fn: () => Promise<T>): Promise<T | undefined> {
  const client = await pool.connect();
  let acquired = false;
  try {
    const result = await client.query<{ locked: boolean }>("select pg_try_advisory_lock($1) as locked", [lockKey]);
    acquired = Boolean(result.rows[0]?.locked);
    if (!acquired) return undefined;
    return await fn();
  } finally {
    if (acquired) {
      await client.query("select pg_advisory_unlock($1)", [lockKey]).catch(() => undefined);
    }
    client.release();
  }
}
