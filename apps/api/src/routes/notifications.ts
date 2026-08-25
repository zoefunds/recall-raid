import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { pool } from "../lib/db.js";
import { requireAuth } from "../plugins/auth-plugin.js";
import { badRequest, notFound } from "../lib/http-errors.js";

const ListQuerySchema = z.object({
  unreadOnly: z.coerce.boolean().default(false),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export async function notificationRoutes(app: FastifyInstance) {
  app.get("/notifications", async (req, reply) => {
    const session = requireAuth(req);
    const parsed = ListQuerySchema.safeParse(req.query);
    if (!parsed.success) throw badRequest(parsed.error.message);
    const { unreadOnly, limit, offset } = parsed.data;

    const where = unreadOnly ? "and read = false" : "";
    const { rows } = await pool.query(
      `select * from notifications where wallet_address = $1 ${where} order by created_at desc limit $2 offset $3`,
      [session.walletAddress, limit, offset],
    );
    const { rows: countRows } = await pool.query(
      `select count(*)::int as total from notifications where wallet_address = $1 ${where}`,
      [session.walletAddress],
    );
    return reply.send({ total: countRows[0].total, items: rows, limit, offset });
  });

  app.post("/notifications/:id/read", async (req, reply) => {
    const session = requireAuth(req);
    const id = Number((req.params as { id: string }).id);
    if (!Number.isInteger(id) || id <= 0) throw badRequest("id must be a positive integer");

    const { rows } = await pool.query(
      `update notifications set read = true where id = $1 and wallet_address = $2 returning *`,
      [id, session.walletAddress],
    );
    if (rows.length === 0) throw notFound(`notification ${id} not found for this wallet`);
    return reply.send({ notification: rows[0] });
  });

  app.post("/notifications/read-all", async (req, reply) => {
    const session = requireAuth(req);
    await pool.query(`update notifications set read = true where wallet_address = $1 and read = false`, [session.walletAddress]);
    return reply.send({ ok: true });
  });
}
