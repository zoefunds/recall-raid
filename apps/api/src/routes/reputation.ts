import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { pool } from "../lib/db.js";
import { chain } from "../lib/genlayer.js";
import { refreshLeaderboardFor } from "../lib/sync.js";
import { badRequest } from "../lib/http-errors.js";
import { serializeLeaderboardRow, type LeaderboardRow } from "../lib/serialize.js";

const LeaderboardQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export async function reputationRoutes(app: FastifyInstance) {
  // Live read straight from chain (not the cache) — reputation is cheap to
  // fetch and users expect their own score to reflect the very latest
  // settle_investigation/resolve_challenge outcome immediately.
  app.get("/reputation/:address", async (req, reply) => {
    const address = (req.params as { address: string }).address;
    if (!/^0x[a-fA-F0-9]{40}$/.test(address)) throw badRequest("address must be a valid EVM address");
    const rep = await chain.getReputation(address.toLowerCase());
    return reply.send({ address: address.toLowerCase(), reputation: rep });
  });

  // Served from the periodically-refreshed cache — a full leaderboard would
  // otherwise mean one get_reputation view call per wallet on every page
  // load, which doesn't scale as the user base grows.
  app.get("/leaderboard", async (req, reply) => {
    const parsed = LeaderboardQuerySchema.safeParse(req.query);
    if (!parsed.success) throw badRequest(parsed.error.message);
    const { limit, offset } = parsed.data;

    const { rows } = await pool.query(
      "select * from leaderboard_cache order by rank asc nulls last, total_earned_wei desc limit $1 offset $2",
      [limit, offset],
    );
    // fetchLeaderboard() in apps/web expects a bare array, mirroring the
    // shape of a leaderboard the frontend renders directly as a ranked list.
    return reply.send((rows as LeaderboardRow[]).map((row, i) => serializeLeaderboardRow(row, offset + i + 1)));
  });

  // Manual trigger to rebuild the leaderboard for a specific set of wallets
  // (e.g. called by an ops script or the deadline watcher's periodic sweep).
  // Not exposed to public write-rate abuse — same rate limit tier as other
  // sync endpoints.
  app.post(
    "/leaderboard/refresh",
    { config: { rateLimit: { max: 5, timeWindow: "1 minute" } } },
    async (req, reply) => {
      const BodySchema = z.object({ wallets: z.array(z.string()).min(1).max(200) });
      const parsed = BodySchema.safeParse(req.body);
      if (!parsed.success) throw badRequest(parsed.error.message);
      await refreshLeaderboardFor(parsed.data.wallets);
      return reply.send({ ok: true, refreshed: parsed.data.wallets.length });
    },
  );
}
