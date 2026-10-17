import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { pool } from "../lib/db.js";
import { syncChallenge } from "../lib/sync.js";
import { requireAuth } from "../plugins/auth-plugin.js";
import { badRequest, notFound } from "../lib/http-errors.js";
import { serializeChallenge, type ChallengeRow } from "../lib/serialize.js";
import { chain } from "../lib/genlayer.js";
import { config } from "../lib/config.js";
import { getCaseEscrow, verifyChallengeFundingTx } from "../lib/base-sepolia.js";
import { assertBaseRegistrationMatches, assertChallengeOpenAuthorized } from "../lib/settlement-validation.js";
import { confirmFundedChallenge, submitFundedChallenge } from "../lib/genlayer-challenge-relay.js";

const SyncSchema = z.object({ txHash: z.string().optional() });
const OpenChallengeSchema = z.object({
  reason: z.string().trim().min(1).max(1000),
  stakeUsdcBaseUnits: z.string().regex(/^\d{1,78}$/),
  baseTxHash: z.string().regex(/^0x[a-fA-F0-9]{64}$/),
});
const OpenChallengeStatusSchema = OpenChallengeSchema.extend({ txHash: z.string().regex(/^0x[a-fA-F0-9]{64}$/) });

export async function challengeRoutes(app: FastifyInstance) {
  // The caller funds their own Base stake. Only after authenticating that
  // wallet and verifying the exact Base receipt does the API admin relay open
  // the GenLayer slot. The contract rejects direct wallet calls, preventing
  // fabricated hashes from occupying the one challenge slot.
  app.post(
    "/investigations/:investigationId/challenges/open",
    { config: { rateLimit: { max: 5, timeWindow: "1 minute" } } },
    async (req, reply) => {
      const session = requireAuth(req);
      const investigationId = Number((req.params as { investigationId: string }).investigationId);
      if (!Number.isInteger(investigationId) || investigationId <= 0) throw badRequest("investigationId must be a positive integer");
      const parsed = OpenChallengeSchema.safeParse(req.body);
      if (!parsed.success) throw badRequest(parsed.error.message);
      const investigation = await chain.getInvestigation(investigationId);
      const baseCase = await getCaseEscrow(investigation.base_case_id);
      const funding = await verifyChallengeFundingTx({
        caseId: investigation.base_case_id,
        challenger: session.walletAddress,
        amount: parsed.data.stakeUsdcBaseUnits,
        txHash: parsed.data.baseTxHash,
      });
      const requiredStake = assertChallengeOpenAuthorized({
        caller: session.walletAddress,
        challenger: session.walletAddress,
        investigation,
        baseCase,
        expectedGenlayerContract: config.genlayer.contractAddress,
        declaredStake: parsed.data.stakeUsdcBaseUnits,
        depositedStake: funding.amount,
        nowSeconds: Math.floor(Date.now() / 1000),
      });
      const result = await submitFundedChallenge({
        investigationId,
        challenger: session.walletAddress,
        reason: parsed.data.reason,
        stake: requiredStake,
        baseTxHash: parsed.data.baseTxHash,
      });
      if (result.alreadyOpen) {
        return reply.send({ status: "confirmed", txHash: null, challengeId: result.challengeId });
      }
      return reply.code(202).send({ status: "pending", txHash: result.txHash });
    },
  );

  // Confirmation is derived from the finalized GenVM transaction and the
  // challenge record, not a client-reported status flag.
  app.post(
    "/investigations/:investigationId/challenges/open-status",
    { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } },
    async (req, reply) => {
      const session = requireAuth(req);
      const investigationId = Number((req.params as { investigationId: string }).investigationId);
      if (!Number.isInteger(investigationId) || investigationId <= 0) throw badRequest("investigationId must be a positive integer");
      const parsed = OpenChallengeStatusSchema.safeParse(req.body);
      if (!parsed.success) throw badRequest(parsed.error.message);
      const investigation = await chain.getInvestigation(investigationId);
      const baseCase = await getCaseEscrow(investigation.base_case_id);
      assertBaseRegistrationMatches({
        baseSubmitter: baseCase.submitter,
        genlayerSubmitter: investigation.submitter,
        baseBounty: baseCase.bountyUsdcBaseUnits,
        genlayerBounty: investigation.bounty_wei,
        registered: baseCase.registered,
        recordedGenlayerContract: baseCase.genlayerContract,
        recordedInvestigationId: baseCase.genlayerInvestigationId,
        expectedGenlayerContract: config.genlayer.contractAddress,
        expectedInvestigationId: investigationId,
      });
      if (!baseCase.registered) throw badRequest("Base case is not registered to this investigation");
      await verifyChallengeFundingTx({
        caseId: investigation.base_case_id,
        challenger: session.walletAddress,
        amount: parsed.data.stakeUsdcBaseUnits,
        txHash: parsed.data.baseTxHash,
      });
      const result = await confirmFundedChallenge({
        txHash: parsed.data.txHash,
        investigationId,
        challenger: session.walletAddress,
        reason: parsed.data.reason,
        stake: parsed.data.stakeUsdcBaseUnits,
        baseTxHash: parsed.data.baseTxHash,
      });
      return result.status === "pending" ? reply.code(202).send(result) : reply.send(result);
    },
  );

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

  // Re-reads a challenge (and its parent investigation) after a verified
  // admin-relayed open_challenge or client-signed resolve/timeout transaction.
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
