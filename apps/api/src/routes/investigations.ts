import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { pool } from "../lib/db.js";
import { syncInvestigation } from "../lib/sync.js";
import { requireAuth } from "../plugins/auth-plugin.js";
import { badRequest, notFound } from "../lib/http-errors.js";
import { serializeInvestigation, type InvestigationRow } from "../lib/serialize.js";

const ListQuerySchema = z.object({
  status: z.string().optional(),
  category: z.string().optional(),
  // The frontend sends a comma-separated list of hazard classes
  // (`hazard_class.join(',')` in apps/web/src/lib/api.ts), not a single
  // value — z.coerce.number() on a "1,2" string would silently produce NaN.
  hazard_class: z.string().optional(),
  min_bounty_wei: z.string().optional(),
  q: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

const SyncSchema = z.object({ txHash: z.string().optional() });

export async function investigationRoutes(app: FastifyInstance) {
  // GET /investigations — paginated Active Hunts feed, served entirely from
  // the Postgres cache (fast reads; the chain remains the source of truth
  // and is re-pulled via /investigations/:id/sync after a confirmed tx).
  app.get("/investigations", async (req, reply) => {
    const parsed = ListQuerySchema.safeParse(req.query);
    if (!parsed.success) throw badRequest(parsed.error.message);
    const { status, category, hazard_class: hazardClassParam, min_bounty_wei: minBountyWei, q, limit, offset } = parsed.data;

    const conditions: string[] = [];
    const params: unknown[] = [];
    if (status) {
      params.push(status.toUpperCase());
      conditions.push(`status = $${params.length}`);
    }
    if (category) {
      params.push(category);
      conditions.push(`category = $${params.length}`);
    }
    if (hazardClassParam) {
      const hazardClasses = hazardClassParam
        .split(",")
        .map((v) => Number(v.trim()))
        .filter((v) => Number.isInteger(v) && v >= 1 && v <= 3);
      if (hazardClasses.length > 0) {
        params.push(hazardClasses);
        conditions.push(`hazard_class = any($${params.length}::smallint[])`);
      }
    }
    if (minBountyWei) {
      params.push(minBountyWei);
      conditions.push(`bounty_wei >= $${params.length}::numeric`);
    }
    if (q) {
      params.push(q);
      conditions.push(`search_keywords @@ plainto_tsquery('english', $${params.length})`);
    }
    const where = conditions.length ? `where ${conditions.join(" and ")}` : "";

    const countResult = await pool.query(`select count(*)::int as total from investigations_cache ${where}`, params);
    params.push(limit);
    params.push(offset);
    const { rows } = await pool.query(
      `select * from investigations_cache ${where} order by created_at_chain desc nulls last limit $${params.length - 1} offset $${params.length}`,
      params,
    );

    return reply.send({
      total: countResult.rows[0].total,
      items: (rows as InvestigationRow[]).map(serializeInvestigation),
    });
  });

  app.get("/investigations/:id", async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    if (!Number.isInteger(id) || id <= 0) throw badRequest("id must be a positive integer");

    const { rows } = await pool.query("select * from investigations_cache where investigation_id = $1", [id]);
    if (rows.length === 0) throw notFound(`investigation ${id} is not in the cache yet — try POST /investigations/${id}/sync`);

    return reply.send(serializeInvestigation(rows[0] as InvestigationRow));
  });

  // Triggers an immediate re-read from chain into the cache — called by the
  // frontend right after a client-signed submit_investigation/add_evidence/
  // request_verdict/... transaction confirms, so the cache doesn't have to
  // wait for the next deadline-watcher tick to reflect it.
  app.post(
    "/investigations/:id/sync",
    { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } },
    async (req, reply) => {
      requireAuth(req);
      const id = Number((req.params as { id: string }).id);
      if (!Number.isInteger(id) || id <= 0) throw badRequest("id must be a positive integer");
      const parsed = SyncSchema.safeParse(req.body ?? {});
      if (!parsed.success) throw badRequest(parsed.error.message);

      await syncInvestigation(id);

      if (parsed.data.txHash) {
        await pool.query(
          `update tx_status_log set related_investigation_id = $2, updated_at = now() where tx_hash = $1`,
          [parsed.data.txHash, id],
        );
      }

      const { rows } = await pool.query("select * from investigations_cache where investigation_id = $1", [id]);
      return reply.send({ investigation: rows[0] });
    },
  );
}
