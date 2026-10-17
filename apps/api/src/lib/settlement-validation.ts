import { ethers } from "ethers";
import { RECALLRAID_ESCROW_ABI } from "./escrow-abi.js";

const escrowInterface = new ethers.Interface(RECALLRAID_ESCROW_ABI);

export function assertChallengeUsageConsistent(input: {
  challenge_used: unknown;
  last_challenge_id: number;
  open_challenge_id: number;
}) {
  if (typeof input.challenge_used !== "boolean"
    || input.challenge_used !== (input.last_challenge_id > 0 || input.open_challenge_id > 0)) {
    throw new Error("GenLayer one-challenge state is missing or inconsistent");
  }
}

export function assertSuccessfulFinalizedGenVmExecution(transaction: {
  statusName?: string | null;
  status_name?: string | null;
  resultName?: string | null;
  result_name?: string | null;
  txExecutionResultName?: string | null;
  tx_execution_result_name?: string | null;
}) {
  const status = String(transaction.statusName ?? transaction.status_name ?? "").toUpperCase();
  const result = String(transaction.resultName ?? transaction.result_name ?? "").toUpperCase();
  const execution = String(transaction.txExecutionResultName ?? transaction.tx_execution_result_name ?? "").toUpperCase();
  if (status !== "FINALIZED") throw new Error("GenVM transaction is not finalized");
  if (execution !== "FINISHED_WITH_RETURN") throw new Error("GenVM transaction did not finish successfully");
  if (result !== "AGREE" && result !== "MAJORITY_AGREE") throw new Error("GenVM transaction did not reach successful consensus");
}

export function assertGenLayerTransactionIdentity(input: {
  transaction: {
    recipient?: string | null;
    to_address?: string | null;
    sender?: string | null;
    from_address?: string | null;
    txOrigin?: string | null;
    txDataDecoded?: unknown;
  };
  expectedContract: string;
  expectedSender?: string;
}) {
  const recipient = input.transaction.recipient ?? input.transaction.to_address ?? "";
  const sender = input.transaction.sender ?? input.transaction.from_address ?? input.transaction.txOrigin ?? "";
  if (recipient.toLowerCase() !== input.expectedContract.toLowerCase()) {
    throw new Error("GenVM transaction targets a different contract");
  }
  if (input.expectedSender && sender.toLowerCase() !== input.expectedSender.toLowerCase()) {
    throw new Error("GenVM transaction sender does not match the investigation submitter");
  }
}

export function assertGenLayerCall(input: {
  transaction: { txDataDecoded?: unknown };
  method: string;
  args: Array<string | number | bigint>;
}) {
  const decodedTransaction = input.transaction.txDataDecoded as { callData?: unknown } | null | undefined;
  const callData = decodedTransaction?.callData;
  if (!callData || typeof callData !== "object") throw new Error("GenVM transaction call data is unavailable");
  const decoded = callData as { method?: unknown; args?: unknown };
  if (decoded.method !== input.method || !Array.isArray(decoded.args)) {
    throw new Error(`GenVM transaction is not a ${input.method} call`);
  }
  if (decoded.args.length < input.args.length) throw new Error("GenVM transaction arguments are incomplete");
  for (let i = 0; i < input.args.length; i++) {
    const expected = String(input.args[i]);
    const actual = String(decoded.args[i]);
    const isHexAddressOrBytes = expected.startsWith("0x");
    if (isHexAddressOrBytes ? actual.toLowerCase() !== expected.toLowerCase() : actual !== expected) {
      throw new Error(`GenVM transaction argument ${i} does not match the expected value`);
    }
  }
}

export function assertGenLayerChallengeOutcome(input: {
  investigationId: number;
  investigationStatus: number;
  verdict: number;
  lastChallengeId: number;
  openChallengeId: number;
  challenge: {
    id: number;
    investigation_id: number;
    challenger: string;
    status: number;
    prior_verdict: number;
    new_verdict: number;
    stake_wei: string;
    stake_deposited_wei: string;
    base_tx_hash: string;
  };
}) {
  const challenge = input.challenge;
  if (input.investigationStatus !== 5 || input.openChallengeId !== 0) {
    throw new Error("GenLayer investigation is not finalized with its challenge closed");
  }
  if (challenge.id !== input.lastChallengeId || challenge.investigation_id !== input.investigationId) {
    throw new Error("GenLayer challenge does not match the finalized investigation record");
  }
  if (![2, 3, 4].includes(challenge.status)) throw new Error("GenLayer challenge outcome is not final");
  if (challenge.stake_wei !== challenge.stake_deposited_wei || BigInt(challenge.stake_wei) <= 0n) {
    throw new Error("GenLayer challenge stake record is inconsistent");
  }
  if (challenge.status === 3) {
    if (challenge.new_verdict === challenge.prior_verdict || challenge.new_verdict !== input.verdict) {
      throw new Error("GenLayer overturned challenge does not match the finalized verdict");
    }
  } else if (challenge.new_verdict !== challenge.prior_verdict || input.verdict !== challenge.prior_verdict) {
    throw new Error("GenLayer upheld or expired challenge does not match the finalized verdict");
  }
}

export function deriveBaseSettlementChallenge(input: {
  finalizedVerdict: number;
  challenge?: { id: number; challenger: string; prior_verdict: number; status: number } | null;
  baseFundingVerified: boolean;
}) {
  if (!input.challenge) {
    if (input.baseFundingVerified) throw new Error("Base challenge funding cannot be applied without a finalized GenLayer challenge");
    return { verdict: input.finalizedVerdict, challengeId: 0, challenger: "0x0000000000000000000000000000000000000000", overturned: false };
  }
  if (input.baseFundingVerified) {
    return {
      verdict: input.finalizedVerdict,
      challengeId: input.challenge.id,
      challenger: input.challenge.challenger,
      overturned: input.challenge.status === 3,
    };
  }
  return {
    verdict: input.challenge.prior_verdict,
    challengeId: 0,
    challenger: "0x0000000000000000000000000000000000000000",
    overturned: false,
  };
}

export type AdjudicationInstruction = {
  verdict: number;
  hunter: string;
  challengeId: number;
  challenger: string;
  challengeOverturned: boolean;
  sellerBondId: string;
  sellerBondSlash: string;
  decisionHash: string;
};

/**
 * The decision signer must only sign the instruction derived from finalized
 * GenLayer state and the verified Base funding record. Keep this comparison
 * pure so every authorization field can be adversarially tested.
 */
export function assertAdjudicationInstructionMatches(
  actual: AdjudicationInstruction,
  expected: AdjudicationInstruction,
) {
  if (actual.verdict !== expected.verdict) {
    throw new Error("Decision signer rejected a verdict that differs from finalized state");
  }
  if (actual.hunter.toLowerCase() !== expected.hunter.toLowerCase()) {
    throw new Error("Decision signer rejected a hunter that differs from finalized evidence");
  }
  if (actual.challengeId !== expected.challengeId
    || actual.challenger.toLowerCase() !== expected.challenger.toLowerCase()
    || actual.challengeOverturned !== expected.challengeOverturned) {
    throw new Error("Decision signer rejected challenge fields that differ from finalized state");
  }
  if (actual.sellerBondId.toLowerCase() !== expected.sellerBondId.toLowerCase()
    || BigInt(actual.sellerBondSlash) !== BigInt(expected.sellerBondSlash)) {
    throw new Error("Decision signer rejected seller-bond fields that differ from finalized state");
  }
  if (actual.decisionHash !== expected.decisionHash) {
    throw new Error("Decision signer rejected a decision hash that differs from finalized state");
  }
}

export function assertBaseRegistrationMatches(input: {
  baseSubmitter: string;
  genlayerSubmitter: string;
  baseBounty: string;
  genlayerBounty: string;
  registered: boolean;
  recordedGenlayerContract: string;
  recordedInvestigationId: number;
  expectedGenlayerContract: string;
  expectedInvestigationId: number;
}) {
  if (input.baseSubmitter.toLowerCase() !== input.genlayerSubmitter.toLowerCase()) {
    throw new Error("Base depositor does not match GenLayer submitter");
  }
  if (input.baseBounty !== input.genlayerBounty) {
    throw new Error("Base funding amount does not match GenLayer bounty");
  }
  if (input.registered && (input.recordedGenlayerContract.toLowerCase() !== input.expectedGenlayerContract.toLowerCase() || input.recordedInvestigationId !== input.expectedInvestigationId)) {
    throw new Error("Base escrow is registered to a different GenLayer investigation");
  }
}

export function assertChallengeFundingMatches(input: {
  escrowAddress: string;
  caseId: string;
  challenger: string;
  amount: string;
  transaction: { to: string | null; from: string; data: string };
  receiptStatus: number | null;
}) {
  if (input.receiptStatus !== 1) throw new Error("Base challenge funding transaction is not finalized successfully");
  if (input.transaction.to?.toLowerCase() !== input.escrowAddress.toLowerCase()) {
    throw new Error("Challenge funding transaction is not a Base escrow call");
  }
  const parsed = escrowInterface.parseTransaction({ data: input.transaction.data, value: 0n });
  if (!parsed || parsed.name !== "fundChallenge" || String(parsed.args[0]).toLowerCase() !== input.caseId.toLowerCase() || String(parsed.args[1]) !== input.amount || input.transaction.from.toLowerCase() !== input.challenger.toLowerCase()) {
    throw new Error("Base challenge funding does not match GenLayer challenge identity, case, or stake");
  }
}

export function assertOrphanRecoveryEligible(input: {
  depositor: string;
  caller: string;
  registeredOnBase: boolean;
  finalized: boolean;
  fundedAtSeconds: number;
  registeredOnGenlayer: boolean;
  nowSeconds: number;
}) {
  if (input.depositor.toLowerCase() !== input.caller.toLowerCase()) throw new Error("Only the original Base depositor can request recovery");
  if (input.registeredOnBase || input.finalized) throw new Error("This deposit is not an unregistered orphan");
  if (input.nowSeconds < input.fundedAtSeconds + 7 * 24 * 3600) throw new Error("The seven-day recovery delay has not elapsed");
  if (input.registeredOnGenlayer) throw new Error("A GenLayer investigation exists for this Base case");
}
