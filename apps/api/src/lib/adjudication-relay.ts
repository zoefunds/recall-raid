import { ethers } from "ethers";
import { pool } from "./db.js";
import { chain } from "./genlayer.js";
import { getCaseEscrow, getSellerBondBalance, isChallengeBackedOnBase, relayAdjudication, relayCancellation } from "./base-sepolia.js";
import { config } from "./config.js";
import { assertBaseRegistrationMatches, assertChallengeUsageConsistent, assertGenLayerChallengeOutcome, assertGenLayerCall, assertGenLayerTransactionIdentity, assertSuccessfulFinalizedGenVmExecution, deriveBaseSettlementChallenge } from "./settlement-validation.js";
import { getTransactionStatus } from "./genlayer.js";

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
  assertBaseRegistrationMatches({
    baseSubmitter: existing.submitter,
    genlayerSubmitter: inv.submitter,
    baseBounty: existing.bountyUsdcBaseUnits,
    genlayerBounty: inv.bounty_wei,
    registered: existing.registered,
    recordedGenlayerContract: existing.genlayerContract,
    recordedInvestigationId: existing.genlayerInvestigationId,
    expectedGenlayerContract: config.genlayer.contractAddress,
    expectedInvestigationId: investigationId,
  });
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

  if (!existing.registered) throw new Error("Base case is not registered to the finalized GenLayer investigation");
  const { rows: proofRows } = await pool.query(
    "select terminal_genvm_tx_hash from investigations_cache where investigation_id = $1",
    [investigationId],
  );
  const terminalTxHash = proofRows[0]?.terminal_genvm_tx_hash as string | null | undefined;
  if (!terminalTxHash) throw new Error("A successful finalized terminal GenVM transaction must be synced before Base settlement");
  const terminalTx = await getTransactionStatus(terminalTxHash);
  assertSuccessfulFinalizedGenVmExecution(terminalTx);
  assertGenLayerTransactionIdentity({ transaction: terminalTx, expectedContract: config.genlayer.contractAddress });
  const terminalMethod = terminalRefund
    ? inv.status === 7 ? "cancel_investigation" : inv.evidence_count === 0 ? "claim_evidence_timeout" : "claim_verdict_timeout"
    : "settle_investigation";
  assertGenLayerCall({ transaction: terminalTx, method: terminalMethod, args: [investigationId] });

  // Resolve directly from GenLayer rather than relying on a potentially
  // stale Postgres challenge-cache row. A challenge can change who receives
  // the stake, so this fact belongs to the adjudication source of truth.
  const challengeId = inv.last_challenge_id || inv.open_challenge_id;
  const challenge = challengeId ? await chain.getChallenge(challengeId) : null;
  let baseFundingVerified = false;
  if (finalVerdict) assertChallengeUsageConsistent(inv);
  const baseCaseId = inv.base_case_id;
  if (challenge) {
    assertGenLayerChallengeOutcome({
      investigationId,
      investigationStatus: inv.status,
      verdict: inv.verdict,
      lastChallengeId: inv.last_challenge_id,
      openChallengeId: inv.open_challenge_id,
      challenge,
    });
    baseFundingVerified = await isChallengeBackedOnBase(inv.base_case_id, challenge);
  }
  // An unbacked GenLayer challenge cannot change a Base-funded payout or
  // claim another wallet's stake. Preserve the verdict that was challenged.
  const settlementChallenge = deriveBaseSettlementChallenge({ finalizedVerdict: inv.verdict, challenge, baseFundingVerified });
  const { verdict: settlementVerdict, challengeId: fundedChallengeId, challenger: fundedChallenger, overturned: challengeOverturned } = settlementChallenge;
  const evidenceIds = await chain.getEvidenceIdsForInvestigation(investigationId);
  const firstEvidence = evidenceIds.length ? await chain.getEvidence(evidenceIds[0]) : null;
  const hunter = settlementVerdict === 1 || terminalRefund ? ethers.ZeroAddress : firstEvidence?.submitter;
  if (!hunter) throw new Error("A payout verdict requires at least one evidence submitter");

  const sellerBondId = existing.sellerBondId;
  const bondBalance = sellerBondId !== ethers.ZeroHash ? await getSellerBondBalance(sellerBondId) : "0";
  const sellerBondSlash = settlementVerdict === 3
    ? (BigInt(bondBalance) < BigInt(existing.bountyUsdcBaseUnits) ? bondBalance : existing.bountyUsdcBaseUnits)
    : "0";
  const decisionHash = ethers.id(JSON.stringify({
    genlayerContract: config.genlayer.contractAddress,
    investigationId,
    caseId: baseCaseId,
    verdict: settlementVerdict,
    confidenceBps: inv.ai_confidence_bps,
    hunter,
    challengeId: fundedChallengeId,
    challenger: fundedChallenger,
    challengeOverturned,
    sellerBondId,
    sellerBondSlash,
  }));
  const relayTxHash = terminalRefund
    ? await relayCancellation(inv.base_case_id, config.genlayer.contractAddress, investigationId, decisionHash, terminalTxHash)
    : await relayAdjudication({ caseId: inv.base_case_id, genlayerContract: config.genlayer.contractAddress, investigationId, verdict: settlementVerdict, hunter, challengeId: fundedChallengeId, challenger: fundedChallenger, challengeOverturned, sellerBondId, sellerBondSlash, decisionHash, terminalGenVmTxHash: terminalTxHash });

  await pool.query(
    "update investigations_cache set relay_tx_hash = $2, synced_at = now() where investigation_id = $1",
    [investigationId, relayTxHash],
  );
  return { relayed: true, relayTxHash, decisionHash };
}
