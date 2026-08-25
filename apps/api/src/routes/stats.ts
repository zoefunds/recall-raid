import type { FastifyInstance } from "fastify";
import { pool } from "../lib/db.js";

// Powers the landing page's live stats bento
// (apps/web/src/app/page.tsx -> fetchPlatformStats -> GET /stats).
// Every number here is a real aggregate over investigations_cache, not a
// hardcoded placeholder — the cache is kept current by syncInvestigation
// (called right after a client-signed tx confirms) and by the periodic
// deadline-watcher sweep, so this is "as fresh as the last sync", not
// necessarily the literal current block, which is the same trust model
// the rest of the read-side API already uses.
export async function statsRoutes(app: FastifyInstance) {
  app.get("/stats", async (_req, reply) => {
    const { rows } = await pool.query(`
      select
        count(*) filter (where verdict = 'RECALL_CONFIRMED' and settled = true)::int as verified_discoveries,
        count(*) filter (where status not in ('SETTLED', 'INVALID', 'CANCELLED'))::int as active_threats,
        coalesce(
          sum(
            (bounty_wei::numeric * hunter_payout_bps::numeric / 10000)::numeric(78, 0)
          ) filter (where settled = true and hunter_payout_bps > 0),
          0
        )::text as gen_distributed_wei
      from investigations_cache
    `);

    const row = rows[0] ?? { verified_discoveries: 0, active_threats: 0, gen_distributed_wei: "0" };
    return reply.send({
      verified_discoveries: row.verified_discoveries,
      active_threats: row.active_threats,
      gen_distributed_wei: row.gen_distributed_wei,
    });
  });
}
