import { ethers } from "ethers";
import { config } from "./config.js";
import { ERC20_ABI, RECALLRAID_ESCROW_ABI } from "./escrow-abi.js";
import { chain, getTransactionStatus } from "./genlayer.js";
import { assertAdjudicationInstructionMatches, assertBaseRegistrationMatches, assertChallengeFundingMatches, assertChallengeUsageConsistent, assertGenLayerCall, assertGenLayerChallengeOutcome, assertGenLayerTransactionIdentity, assertOrphanRecoveryEligible, assertSuccessfulFinalizedGenVmExecution, deriveBaseSettlementChallenge } from "./settlement-validation.js";

let provider: ethers.JsonRpcProvider | undefined;
let relayerContract: ethers.Contract | undefined;

function getProvider() {
  provider ??= new ethers.JsonRpcProvider(config.baseSepolia.rpcUrl);
  return provider;
}

function getReadContract() {
  if (!config.baseSepolia.escrowAddress) throw new Error("RECALLRAID_ESCROW_ADDRESS is not configured");
  return new ethers.Contract(config.baseSepolia.escrowAddress, RECALLRAID_ESCROW_ABI, getProvider());
}

function getRelayerContract() {
  if (!config.baseSepolia.escrowAddress || !config.baseSepolia.relayerPrivateKey) {
    throw new Error("Base Sepolia escrow relayer is not configured");
  }
  relayerContract ??= new ethers.Contract(
    config.baseSepolia.escrowAddress,
    RECALLRAID_ESCROW_ABI,
    new ethers.Wallet(config.baseSepolia.relayerPrivateKey, getProvider()),
  );
  return relayerContract;
}

function getDecisionSigner() {
  if (!config.baseSepolia.decisionSignerPrivateKey) throw new Error("Base Sepolia decision attestor is not configured");
  return new ethers.Wallet(config.baseSepolia.decisionSignerPrivateKey);
}

async function assertDecisionSignerMatchesEscrow() {
  const configured = await getReadContract().decisionSigner() as string;
  if (configured.toLowerCase() !== getDecisionSigner().address.toLowerCase()) throw new Error("Decision signer key does not match the escrow authorization signer");
}

async function signAdjudication(input: { caseId: string; genlayerContract: string; investigationId: number; verdict: number; hunter: string; challengeId: number; challenger: string; challengeOverturned: boolean; sellerBondId: string; sellerBondSlash: string; decisionHash: string }) {
  const signer = getDecisionSigner();
  const domain = { name: "RecallRaidEscrow", version: "1", chainId: config.baseSepolia.chainId, verifyingContract: config.baseSepolia.escrowAddress };
  return signer.signTypedData(domain, {
    Adjudication: [
      { name: "caseId", type: "bytes32" },
      { name: "genlayerContract", type: "address" },
      { name: "investigationId", type: "uint32" },
      { name: "verdictCode", type: "uint8" },
      { name: "hunter", type: "address" },
      { name: "challengeId", type: "uint32" },
      { name: "challenger", type: "address" },
      { name: "challengeOverturned", type: "bool" },
      { name: "sellerBondId", type: "bytes32" },
      { name: "sellerBondSlash", type: "uint256" },
      { name: "decisionHash", type: "bytes32" },
    ],
  }, {
    caseId: caseIdToBytes32(input.caseId),
    genlayerContract: input.genlayerContract,
    investigationId: input.investigationId,
    verdictCode: input.verdict,
    hunter: input.hunter,
    challengeId: input.challengeId,
    challenger: input.challenger,
    challengeOverturned: input.challengeOverturned,
    sellerBondId: input.sellerBondId,
    sellerBondSlash: BigInt(input.sellerBondSlash),
    decisionHash: input.decisionHash,
  });
}

async function signCancellation(caseId: string, genlayerContract: string, investigationId: number, decisionHash: string) {
  const domain = { name: "RecallRaidEscrow", version: "1", chainId: config.baseSepolia.chainId, verifyingContract: config.baseSepolia.escrowAddress };
  return getDecisionSigner().signTypedData(domain, {
    Cancellation: [
      { name: "caseId", type: "bytes32" },
      { name: "genlayerContract", type: "address" },
      { name: "investigationId", type: "uint32" },
      { name: "decisionHash", type: "bytes32" },
    ],
  }, { caseId: caseIdToBytes32(caseId), genlayerContract, investigationId, decisionHash });
}

async function signRegistration(caseId: string, submitter: string, bounty: string, genlayerContract: string, investigationId: number) {
  const domain = { name: "RecallRaidEscrow", version: "1", chainId: config.baseSepolia.chainId, verifyingContract: config.baseSepolia.escrowAddress };
  return getDecisionSigner().signTypedData(domain, {
    Registration: [
      { name: "caseId", type: "bytes32" },
      { name: "submitter", type: "address" },
      { name: "bounty", type: "uint256" },
      { name: "genlayerContract", type: "address" },
      { name: "investigationId", type: "uint32" },
    ],
  }, { caseId: caseIdToBytes32(caseId), submitter, bounty: BigInt(bounty), genlayerContract, investigationId });
}

async function verifyTerminalGenLayerWrite(txHash: string, investigationId: number, method: string) {
  if (!/^0x[a-fA-F0-9]{64}$/.test(txHash)) throw new Error("A valid terminal GenVM transaction hash is required for attestation");
  const transaction = await getTransactionStatus(txHash);
  assertSuccessfulFinalizedGenVmExecution(transaction);
  assertGenLayerTransactionIdentity({ transaction, expectedContract: config.genlayer.contractAddress });
  assertGenLayerCall({ transaction, method, args: [investigationId] });
}

export async function signOrphanRecovery(caseId: string, submitter: string, bounty: string) {
  await assertDecisionSignerMatchesEscrow();
  const escrowCase = await getCaseEscrow(caseId);
  const registeredOnGenlayer = await chain.hasRegisteredBaseCase(caseId, submitter);
  assertOrphanRecoveryEligible({
    depositor: escrowCase.submitter,
    caller: submitter,
    registeredOnBase: escrowCase.registered,
    finalized: escrowCase.finalized,
    fundedAtSeconds: escrowCase.fundedAt,
    registeredOnGenlayer,
    nowSeconds: Math.floor(Date.now() / 1000),
  });
  if (escrowCase.bountyUsdcBaseUnits !== bounty) throw new Error("Orphan recovery amount does not match Base escrow");
  const domain = { name: "RecallRaidEscrow", version: "1", chainId: config.baseSepolia.chainId, verifyingContract: config.baseSepolia.escrowAddress };
  return getDecisionSigner().signTypedData(domain, {
    OrphanRecovery: [
      { name: "caseId", type: "bytes32" },
      { name: "submitter", type: "address" },
      { name: "bounty", type: "uint256" },
    ],
  }, { caseId: caseIdToBytes32(caseId), submitter, bounty: BigInt(bounty) });
}

export function caseIdToBytes32(caseId: string) {
  return caseId.startsWith("0x") && caseId.length === 66 ? caseId : ethers.id(caseId);
}

export async function getCaseEscrow(caseId: string) {
  const item = await getReadContract().getCase(caseIdToBytes32(caseId));
  return {
    submitter: item.submitter as string,
    challenger: item.challenger as string,
    hunter: item.hunter as string,
    sellerBondId: item.sellerBondId as string,
    bountyUsdcBaseUnits: (item.bounty as bigint).toString(),
    challengeStakeUsdcBaseUnits: (item.challengeStake as bigint).toString(),
    verdict: Number(item.verdict),
    finalized: item.finalized as boolean,
    genlayerDecisionHash: item.genlayerDecisionHash as string,
    registered: item.registered as boolean,
    genlayerContract: item.genlayerContract as string,
    genlayerInvestigationId: Number(item.genlayerInvestigationId),
    fundedAt: Number(item.fundedAt),
  };
}

export async function getChallengeDeposit(caseId: string, challenger: string) {
  const deposit = await getReadContract().getChallengeDeposit(caseIdToBytes32(caseId), challenger);
  return { amount: (deposit.amount as bigint).toString(), fundedAt: Number(deposit.fundedAt) };
}

export async function getSellerBondBalance(bondId: string) {
  const bond = await getReadContract().getSellerBond(bondId);
  return (bond.balance as bigint).toString();
}

export async function assertChallengeDeposit(caseId: string, challenger: string, expectedAmount: string) {
  const deposit = await getChallengeDeposit(caseId, challenger);
  if (deposit.amount !== expectedAmount) throw new Error("Base challenger stake does not match GenLayer challenge");
  return deposit;
}

/**
 * Verify a challenger-owned Base deposit before the GenLayer admin relay may
 * open the challenge slot. All identity fields are derived from the actual
 * transaction and escrow mapping, not from request claims.
 */
export async function verifyChallengeFundingTx(input: {
  caseId: string;
  challenger: string;
  amount: string;
  txHash: string;
}) {
  if (!config.baseSepolia.escrowAddress) throw new Error("RECALLRAID_ESCROW_ADDRESS is not configured");
  if (!/^0x[a-fA-F0-9]{64}$/.test(input.txHash)) throw new Error("A valid Base challenge funding transaction hash is required");
  const provider = getProvider();
  const network = await provider.getNetwork();
  if (network.chainId !== BigInt(config.baseSepolia.chainId)) throw new Error("Challenge funding verifier is not connected to the configured Base Sepolia chain");
  const [transaction, receipt, deposit] = await Promise.all([
    provider.getTransaction(input.txHash),
    provider.getTransactionReceipt(input.txHash),
    getChallengeDeposit(input.caseId, input.challenger),
  ]);
  if (!transaction || !receipt) throw new Error("Base challenge funding transaction or receipt is not yet available");
  if (receipt.status !== 1) throw new Error("Base challenge funding transaction did not succeed");
  if (transaction.chainId !== BigInt(config.baseSepolia.chainId)) throw new Error("Challenge funding transaction was signed for a different chain");
  assertChallengeFundingMatches({
    escrowAddress: config.baseSepolia.escrowAddress,
    caseId: input.caseId,
    challenger: input.challenger,
    amount: input.amount,
    transaction: { to: transaction.to, from: transaction.from, data: transaction.data },
    receiptStatus: receipt.status,
  });
  if (deposit.amount !== input.amount) throw new Error("Base escrow's challenger-specific deposit does not match the funded transaction amount");
  return { blockNumber: receipt.blockNumber, txHash: receipt.hash, amount: deposit.amount };
}

/**
 * A GenLayer challenge record alone cannot authorize Base stake movement. Verify
 * the actual receipt and calldata independently before allowing the challenge
 * to affect settlement. A missing transaction/receipt is an RPC/finality
 * uncertainty and remains retryable; a confirmed failed or mismatched transfer
 * is an unbacked challenge and has no effect on the Base verdict or stake.
 */
export async function isChallengeBackedOnBase(caseId: string, challenge: {
  challenger: string;
  stake_deposited_wei: string;
  base_tx_hash: string;
}) {
  if (!config.baseSepolia.escrowAddress) throw new Error("RECALLRAID_ESCROW_ADDRESS is not configured");
  const deposit = await getChallengeDeposit(caseId, challenge.challenger);
  if (deposit.amount !== challenge.stake_deposited_wei || BigInt(deposit.amount) <= 0n) return false;
  if (!/^0x[a-fA-F0-9]{64}$/.test(challenge.base_tx_hash)) return false;
  const provider = getProvider();
  const [transaction, receipt] = await Promise.all([
    provider.getTransaction(challenge.base_tx_hash),
    provider.getTransactionReceipt(challenge.base_tx_hash),
  ]);
  if (!transaction || !receipt) throw new Error("Base challenge funding transaction or receipt is not yet available");
  if (receipt.status !== 0 && receipt.status !== 1) {
    throw new Error("Base challenge funding receipt has no conclusive execution status");
  }
  try {
    assertChallengeFundingMatches({
      escrowAddress: config.baseSepolia.escrowAddress,
      caseId,
      challenger: challenge.challenger,
      amount: challenge.stake_deposited_wei,
      transaction: { to: transaction.to, from: transaction.from, data: transaction.data },
      receiptStatus: receipt.status,
    });
    return true;
  } catch {
    return false;
  }
}

async function assertAdjudicationMatchesFinalizedGenLayer(input: {
  caseId: string;
  verdict: number;
  genlayerContract: string;
  investigationId: number;
  hunter: string;
  challengeId: number;
  challenger: string;
  challengeOverturned: boolean;
  sellerBondId: string;
  sellerBondSlash: string;
  decisionHash: string;
  terminalGenVmTxHash: string;
}) {
  await verifyTerminalGenLayerWrite(input.terminalGenVmTxHash, input.investigationId, "settle_investigation");
  const investigation = await chain.getInvestigation(input.investigationId);
  if (!investigation.settled || investigation.status !== 5 || investigation.open_challenge_id !== 0) {
    throw new Error("Decision signer requires a finalized GenLayer investigation with no open challenge");
  }
  assertChallengeUsageConsistent(investigation);
  if (investigation.base_case_id.toLowerCase() !== input.caseId.toLowerCase()
    || input.genlayerContract.toLowerCase() !== config.genlayer.contractAddress.toLowerCase()) {
    throw new Error("Settlement instruction does not match finalized GenLayer case state");
  }

  const escrowCase = await getCaseEscrow(input.caseId);
  assertBaseRegistrationMatches({
    baseSubmitter: escrowCase.submitter,
    genlayerSubmitter: investigation.submitter,
    baseBounty: escrowCase.bountyUsdcBaseUnits,
    genlayerBounty: investigation.bounty_wei,
    registered: escrowCase.registered,
    recordedGenlayerContract: escrowCase.genlayerContract,
    recordedInvestigationId: escrowCase.genlayerInvestigationId,
    expectedGenlayerContract: config.genlayer.contractAddress,
    expectedInvestigationId: input.investigationId,
  });
  if (!escrowCase.registered) throw new Error("Decision signer refuses to settle an unregistered Base case");

  let baseFundingVerified = false;
  let finalizedChallenge: Awaited<ReturnType<typeof chain.getChallenge>> | null = null;
  if (investigation.last_challenge_id > 0) {
    const challenge = await chain.getChallenge(investigation.last_challenge_id);
    finalizedChallenge = challenge;
    assertGenLayerChallengeOutcome({
      investigationId: input.investigationId,
      investigationStatus: investigation.status,
      verdict: investigation.verdict,
      lastChallengeId: investigation.last_challenge_id,
      openChallengeId: investigation.open_challenge_id,
      challenge,
    });
    baseFundingVerified = await isChallengeBackedOnBase(input.caseId, challenge);
  } else if (investigation.open_challenge_id !== 0) {
    throw new Error("Decision signer refuses a settlement with an unresolved GenLayer challenge");
  }

  const expectedChallenge = deriveBaseSettlementChallenge({
    finalizedVerdict: investigation.verdict,
    challenge: finalizedChallenge,
    baseFundingVerified,
  });
  const { verdict: expectedVerdict, challengeId: expectedChallengeId, challenger: expectedChallenger, overturned: expectedChallengeOverturned } = expectedChallenge;

  const evidenceIds = await chain.getEvidenceIdsForInvestigation(input.investigationId);
  const firstEvidence = evidenceIds.length ? await chain.getEvidence(evidenceIds[0]) : null;
  const expectedHunter = expectedVerdict === 1 ? ethers.ZeroAddress : firstEvidence?.submitter;
  if (!expectedHunter) throw new Error("Finalized payout verdict has no first evidence submitter");
  let expectedBondSlash = 0n;
  if (expectedVerdict === 3 && escrowCase.sellerBondId !== ethers.ZeroHash) {
    const bond = await getReadContract().getSellerBond(escrowCase.sellerBondId);
    const balance = bond.balance as bigint;
    const bounty = BigInt(escrowCase.bountyUsdcBaseUnits);
    expectedBondSlash = balance < bounty ? balance : bounty;
  }

  const expectedDecisionHash = ethers.id(JSON.stringify({
    genlayerContract: config.genlayer.contractAddress,
    investigationId: input.investigationId,
    caseId: input.caseId,
    verdict: expectedVerdict,
    confidenceBps: investigation.ai_confidence_bps,
    hunter: expectedHunter,
    challengeId: expectedChallengeId,
    challenger: expectedChallenger,
    challengeOverturned: expectedChallengeOverturned,
    sellerBondId: escrowCase.sellerBondId,
    sellerBondSlash: expectedBondSlash.toString(),
  }));
  assertAdjudicationInstructionMatches({
    verdict: input.verdict,
    hunter: input.hunter,
    challengeId: input.challengeId,
    challenger: input.challenger,
    challengeOverturned: input.challengeOverturned,
    sellerBondId: input.sellerBondId,
    sellerBondSlash: input.sellerBondSlash,
    decisionHash: input.decisionHash,
  }, {
    verdict: expectedVerdict,
    hunter: expectedHunter,
    challengeId: expectedChallengeId,
    challenger: expectedChallenger,
    challengeOverturned: expectedChallengeOverturned,
    sellerBondId: escrowCase.sellerBondId,
    sellerBondSlash: expectedBondSlash.toString(),
    decisionHash: expectedDecisionHash,
  });
}

export async function getClaimable(address: string) {
  return ((await getReadContract().claimable(address)) as bigint).toString();
}

export async function getWalletUsdcBalance(address: string) {
  const token = new ethers.Contract(config.baseSepolia.usdcAddress, ERC20_ABI, getProvider());
  return ((await token.balanceOf(address)) as bigint).toString();
}

export async function relayAdjudication(input: {
  caseId: string;
  verdict: number;
  genlayerContract: string;
  investigationId: number;
  hunter: string;
  challengeId: number;
  challenger: string;
  challengeOverturned: boolean;
  sellerBondId: string;
  sellerBondSlash: string;
  decisionHash: string;
  terminalGenVmTxHash: string;
}) {
  await assertAdjudicationMatchesFinalizedGenLayer(input);
  await assertDecisionSignerMatchesEscrow();
  const authorization = await signAdjudication(input);
  const tx = await getRelayerContract().relayAdjudication(
    caseIdToBytes32(input.caseId),
    input.genlayerContract,
    input.investigationId,
    input.verdict,
    input.hunter,
    input.challengeId,
    input.challenger,
    input.challengeOverturned,
    input.sellerBondId,
    BigInt(input.sellerBondSlash),
    input.decisionHash,
    authorization,
  );
  const receipt = await tx.wait();
  if (!receipt || receipt.status !== 1) throw new Error("Base Sepolia adjudication relay failed");
  return tx.hash as string;
}

export async function registerGenLayerCase(caseId: string, submitter: string, bounty: string, genlayerContract: string, investigationId: number) {
  const investigation = await chain.getInvestigation(investigationId);
  if (investigation.base_case_id.toLowerCase() !== caseId.toLowerCase()
    || investigation.submitter.toLowerCase() !== submitter.toLowerCase()
    || investigation.bounty_wei !== bounty
    || genlayerContract.toLowerCase() !== config.genlayer.contractAddress.toLowerCase()) {
    throw new Error("Decision signer refuses a registration that differs from GenLayer state");
  }
  const escrowCase = await getCaseEscrow(caseId);
  assertBaseRegistrationMatches({
    baseSubmitter: escrowCase.submitter,
    genlayerSubmitter: investigation.submitter,
    baseBounty: escrowCase.bountyUsdcBaseUnits,
    genlayerBounty: investigation.bounty_wei,
    registered: escrowCase.registered,
    recordedGenlayerContract: escrowCase.genlayerContract,
    recordedInvestigationId: escrowCase.genlayerInvestigationId,
    expectedGenlayerContract: genlayerContract,
    expectedInvestigationId: investigationId,
  });
  if (escrowCase.registered || escrowCase.finalized) throw new Error("Decision signer refuses an already registered or finalized Base case");
  await assertDecisionSignerMatchesEscrow();
  const authorization = await signRegistration(caseId, submitter, bounty, genlayerContract, investigationId);
  const tx = await getRelayerContract().registerGenLayerCase(caseIdToBytes32(caseId), submitter, BigInt(bounty), genlayerContract, investigationId, authorization);
  const receipt = await tx.wait();
  if (!receipt || receipt.status !== 1) throw new Error("Base Sepolia case registration failed");
  return tx.hash as string;
}

export async function relayCancellation(caseId: string, genlayerContract: string, investigationId: number, decisionHash: string, terminalGenVmTxHash: string) {
  const investigation = await chain.getInvestigation(investigationId);
  if (![6, 7].includes(investigation.status) || investigation.settled || investigation.open_challenge_id !== 0
    || investigation.base_case_id.toLowerCase() !== caseId.toLowerCase()
    || genlayerContract.toLowerCase() !== config.genlayer.contractAddress.toLowerCase()) {
    throw new Error("Decision signer requires a terminal GenLayer refund state matching the registered Base case");
  }
  const terminalMethod = investigation.status === 7
    ? "cancel_investigation"
    : investigation.evidence_count === 0 ? "claim_evidence_timeout" : "claim_verdict_timeout";
  await verifyTerminalGenLayerWrite(terminalGenVmTxHash, investigationId, terminalMethod);
  assertChallengeUsageConsistent(investigation);
  if (investigation.challenge_used || investigation.last_challenge_id !== 0) {
    throw new Error("Decision signer refuses a refund with a prior challenge");
  }
  const escrowCase = await getCaseEscrow(caseId);
  assertBaseRegistrationMatches({
    baseSubmitter: escrowCase.submitter,
    genlayerSubmitter: investigation.submitter,
    baseBounty: escrowCase.bountyUsdcBaseUnits,
    genlayerBounty: investigation.bounty_wei,
    registered: escrowCase.registered,
    recordedGenlayerContract: escrowCase.genlayerContract,
    recordedInvestigationId: escrowCase.genlayerInvestigationId,
    expectedGenlayerContract: config.genlayer.contractAddress,
    expectedInvestigationId: investigationId,
  });
  if (!escrowCase.registered) throw new Error("Decision signer refuses to refund an unregistered Base case");
  const expectedDecisionHash = ethers.id(JSON.stringify({
    genlayerContract: config.genlayer.contractAddress,
    investigationId,
    caseId,
    verdict: investigation.verdict,
    confidenceBps: investigation.ai_confidence_bps,
    hunter: ethers.ZeroAddress,
    challengeId: 0,
    challenger: ethers.ZeroAddress,
    challengeOverturned: false,
    sellerBondId: escrowCase.sellerBondId,
    sellerBondSlash: "0",
  }));
  if (decisionHash !== expectedDecisionHash) throw new Error("Decision signer rejected a modified GenLayer refund instruction");
  await assertDecisionSignerMatchesEscrow();
  const authorization = await signCancellation(caseId, genlayerContract, investigationId, decisionHash);
  const tx = await getRelayerContract().relayCancellation(caseIdToBytes32(caseId), genlayerContract, investigationId, decisionHash, authorization);
  const receipt = await tx.wait();
  if (!receipt || receipt.status !== 1) throw new Error("Base Sepolia cancellation relay failed");
  return tx.hash as string;
}

export function isBaseEscrowConfigured() {
  return Boolean(config.baseSepolia.escrowAddress);
}
