import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { pool } from "../lib/db.js";
import { syncChallenge } from "../lib/sync.js";
import { requireAuth } from "../plugins/auth-plugin.js";
import { badRequest, notFound } from "../lib/http-errors.js";
import { serializeChallenge, type ChallengeRow } from "../lib/serialize.js";

const SyncSchema = z.object({ txHash: z.string().optional() });

export async function challengeRoutes(app: FastifyInstance) {
  app.get("/challenges/:id", async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    if (!Number.isInteger(id) || id <= 0) throw badRequest("id must be a positive integer");

    const { rows } = await pool.query("select * from challenges_cache where challenge_id = $1", [id]);
    if (rows.length === 0) throw notFound(`challenge ${id} is not in the cache yet — try POST /challenges/${id}/sync`);
    return reply.send({ challenge: serializeChallenge(rows[0] as ChallengeRow) });
  });

  app.get("/investigations/:investigationId/challenges", async (req, reply) => {
    const investigationId = Number((req.params as { investigationId: string }).investigationId);
    if (!Number.isInteger(investigationId) || investigationId <= 0) throw badRequest("investigationId must be a positive integer");
    const { rows } = await pool.query(
      "select * from challenges_cache where investigation_id = $1 order by created_at_chain desc",
      [investigationId],
    );
    return reply.send({ challenges: (rows as ChallengeRow[]).map(serializeChallenge) });
  });

  // Re-reads a challenge (and its parent investigation) from chain after a
  // client-signed open_challenge / resolve_challenge / claim_challenge_timeout
  // transaction confirms.
  app.post(
    "/challenges/:id/sync",
    { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } },
    async (req, reply) => {
      requireAuth(req);
      const id = Number((req.params as { id: string }).id);
      if (!Number.isInteger(id) || id <= 0) throw badRequest("id must be a positive integer");
      const parsed = SyncSchema.safeParse(req.body ?? {});
      if (!parsed.success) throw badRequest(parsed.error.message);

      await syncChallenge(id);

      if (parsed.data.txHash) {
        const { rows } = await pool.query("select investigation_id from challenges_cache where challenge_id = $1", [id]);
        await pool.query(
          `update tx_status_log set related_investigation_id = $2, updated_at = now() where tx_hash = $1`,
          [parsed.data.txHash, rows[0]?.investigation_id ?? null],
        );
      }

      const { rows } = await pool.query("select * from challenges_cache where challenge_id = $1", [id]);
      return reply.send({ challenge: rows[0] });
    },
  );
}
