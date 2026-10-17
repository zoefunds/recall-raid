import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { pool } from "../lib/db.js";
import { syncSellerBond } from "../lib/sync.js";
import { requireAuth } from "../plugins/auth-plugin.js";
import { badRequest, notFound } from "../lib/http-errors.js";
import { serializeSellerBond, type SellerBondRow } from "../lib/serialize.js";

const SyncSchema = z.object({ txHash: z.string().optional() });

export async function sellerBondRoutes(app: FastifyInstance) {
  app.get("/seller-bonds/:id", async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    if (!Number.isInteger(id) || id <= 0) throw badRequest("id must be a positive integer");

    const { rows } = await pool.query("select * from seller_bonds_cache where bond_id = $1", [id]);
    if (rows.length === 0) throw notFound(`seller bond ${id} is not in the cache yet — try POST /seller-bonds/${id}/sync`);
    return reply.send({ sellerBond: rows[0] });
  });

  app.get("/sellers/:address/bonds", async (req, reply) => {
    const address = (req.params as { address: string }).address.toLowerCase();
    const { rows } = await pool.query(
      "select * from seller_bonds_cache where seller_wallet = $1 order by created_at_chain desc",
      [address],
    );
    // fetchSellerBonds() in apps/web expects a bare SellerBond[] array.
    return reply.send((rows as SellerBondRow[]).map(serializeSellerBond));
  });

  // Re-reads a seller bond from chain after a client-signed create_seller_bond
  // / topup_seller_bond / link_seller_bond / withdraw_seller_bond confirms.
  app.post(
    "/seller-bonds/:id/sync",
    { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } },
    async (req, reply) => {
      requireAuth(req);
      const id = Number((req.params as { id: string }).id);
      if (!Number.isInteger(id) || id <= 0) throw badRequest("id must be a positive integer");
      const parsed = SyncSchema.safeParse(req.body ?? {});
      if (!parsed.success) throw badRequest(parsed.error.message);

      await syncSellerBond(id);

      if (parsed.data.txHash) {
        await pool.query(
          `update tx_status_log set updated_at = now() where tx_hash = $1`,
          [parsed.data.txHash],
        );
      }

      const { rows } = await pool.query("select * from seller_bonds_cache where bond_id = $1", [id]);
      return reply.send({ sellerBond: rows[0] });
    },
  );
}
