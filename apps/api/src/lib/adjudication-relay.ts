import { ethers } from "ethers";
import { pool } from "./db.js";
import { chain } from "./genlayer.js";
import { getCaseEscrow, relayAdjudication, relayCancellation } from "./base-sepolia.js";
import { config } from "./config.js";

export interface RelayResult {
  relayed: boolean;
  alreadyFinalized?: boolean;
  relayTxHash?: string;
  decisionHash?: string;
}

/**
 * Relays exactly one terminal GenLayer outcome to the Base Sepolia escrow.
 *
 * The Base contract is the final idempotency boundary (`finalized` can only
 * transition once). We still check it before sending so periodic workers and
 * a user's manual retry never spend a redundant relayer transaction.
 */
export async function relayTerminalInvestigation(investigationId: number): Promise<RelayResult> {
  const inv = await chain.getInvestigation(investigationId);
  const finalVerdict = inv.settled && [1, 2, 3].includes(inv.verdict);
  const terminalRefund = [6, 7].includes(inv.status);
  if (!finalVerdict && !terminalRefund) {
    throw new Error("GenLayer adjudication is not terminal");
  }

  const existing = await getCaseEscrow(inv.base_case_id);
  if (existing.finalized) {
    const knownHash = existing.genlayerDecisionHash && existing.genlayerDecisionHash !== ethers.ZeroHash
      ? existing.genlayerDecisionHash
      : "already-finalized";
    await pool.query(
      "update investigations_cache set relay_tx_hash = coalesce(nullif(relay_tx_hash, ''), $2), synced_at = now() where investigation_id = $1",
      [investigationId, knownHash],
    );
    return { relayed: true, alreadyFinalized: true, relayTxHash: knownHash };
  }

  const evidenceIds = await chain.getEvidenceIdsForInvestigation(investigationId);
  const firstEvidence = evidenceIds.length ? await chain.getEvidence(evidenceIds[0]) : null;
  const hunter = inv.verdict === 1 || terminalRefund ? ethers.ZeroAddress : firstEvidence?.submitter;
  if (!hunter) throw new Error("A payout verdict requires at least one evidence submitter");

  // Resolve directly from GenLayer rather than relying on a potentially
  // stale Postgres challenge-cache row. A challenge can change who receives
  // the stake, so this fact belongs to the adjudication source of truth.
  const challenge = inv.open_challenge_id ? await chain.getChallenge(inv.open_challenge_id) : null;
  const challengeOverturned = challenge?.status === 3;
  const decisionHash = ethers.id(JSON.stringify({
    genlayerContract: config.genlayer.contractAddress,
    investigationId,
    caseId: inv.base_case_id,
    verdict: inv.verdict,
    confidenceBps: inv.ai_confidence_bps,
    hunter,
    challengeOverturned,
  }));
  const relayTxHash = terminalRefund
    ? await relayCancellation(inv.base_case_id, decisionHash)
    : await relayAdjudication({ caseId: inv.base_case_id, verdict: inv.verdict, hunter, challengeOverturned, decisionHash });

  await pool.query(
    "update investigations_cache set relay_tx_hash = $2, synced_at = now() where investigation_id = $1",
    [investigationId, relayTxHash],
  );
  return { relayed: true, relayTxHash, decisionHash };
}
