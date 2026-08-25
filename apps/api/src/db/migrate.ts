import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { config } from "../lib/config.js";

// Deliberately not a heavy migration framework — plain numbered .sql files
// in ./migrations, applied in filename order, tracked in a
// schema_migrations table so re-running this script is a no-op once
// everything is applied. Good enough for a single-service backend with a
// linear migration history.

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, "migrations");

async function main() {
  const pool = new Pool({ connectionString: config.databaseUrl });
  try {
    await pool.query(`
      create table if not exists schema_migrations (
        name text primary key,
        applied_at timestamptz not null default now()
      )
    `);

    const { rows: appliedRows } = await pool.query<{ name: string }>("select name from schema_migrations");
    const applied = new Set(appliedRows.map((r) => r.name));

    const files = readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith(".sql"))
      .sort();

    for (const file of files) {
      if (applied.has(file)) continue;
      const sql = readFileSync(join(MIGRATIONS_DIR, file), "utf8");
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query(sql);
        await client.query("insert into schema_migrations (name) values ($1)", [file]);
        await client.query("COMMIT");
        // eslint-disable-next-line no-console
        console.log(`applied: ${file}`);
      } catch (err) {
        await client.query("ROLLBACK");
        throw new Error(`migration failed: ${file}: ${(err as Error).message}`);
      } finally {
        client.release();
      }
    }
    // eslint-disable-next-line no-console
    console.log("migrations up to date");
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
