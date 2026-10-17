#!/usr/bin/env node
// Version-bound recovery path for the historical A239 case. Default mode is
// read-only. Base settlement requires an already-finalized, successful
// A239 settle_investigation transaction and an elapsed seven-day deadline.
// Claims are a separate explicit opt-in and use the first-evidence wallet.

import { ethers } from "ethers";
import { createAccount, createClient, decodeInputData } from "genlayer-js";
import { studionet } from "genlayer-js/chains";

const GENLAYER = "0xa239189c2921b592dBa1eccde830977edbfD1CB5";
const ESCROW = "0x861d5D4E903805cbE283A86f08E10D031601774E";
const USDC = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
const CASE_ID = "0xf10b16b005e9f6fe5b0a433d0dfb042e7086e880bb6bb15cb0c9ac41ec72f864";
const INVESTIGATION_ID = 2;
const EXPECTED_CHALLENGE_ID = 1;
const GENLAYER_RPC = process.env.GENLAYER_RPC_URL || "https://studio.genlayer.com/api";
const BASE_RPC = process.env.BASE_SEPOLIA_RPC_URL || "https://sepolia.base.org";
const readKey = process.env.RECALLRAID_E2E_SUBMITTER_PRIVATE_KEY;
const relayMode = process.argv.includes("--relay");
const claimMode = process.argv.includes("--claim");
if (!readKey) throw new Error("Set RECALLRAID_E2E_SUBMITTER_PRIVATE_KEY through the ignored environment file");
if (claimMode && !relayMode) throw new Error("--claim requires --relay");

const gl = createClient({
  chain: { ...studionet, rpcUrls: { default: { http: [GENLAYER_RPC] } } },
  account: createAccount(readKey),
});
const provider = new ethers.JsonRpcProvider(BASE_RPC);
const escrowAbi = [
  "function getCase(bytes32) view returns (tuple(address submitter,address challenger,address hunter,bytes32 sellerBondId,uint256 bounty,uint256 challengeStake,uint8 verdict,bool finalized,bytes32 genlayerDecisionHash,uint64 fundedAt,bool registered,address genlayerContract,uint32 genlayerInvestigationId))",
  "function getChallengeDeposit(bytes32,address) view returns (tuple(uint256 amount,uint64 fundedAt))",
  "function claimable(address) view returns (uint256)",
  "function owner() view returns (address)",
  "function relayer() view returns (address)",
  "function decisionSigner() view returns (address)",
  "function relayAdjudication(bytes32,address,uint32,uint8,address,uint32,address,bool,bytes32,uint256,bytes32,bytes)",
  "function claim()",
  "event ChallengeFunded(bytes32 indexed caseId,address indexed challenger,uint256 amount)",
  "event AdjudicationRelayed(bytes32 indexed caseId,uint8 verdict,address indexed hunter,bytes32 decisionHash)",
  "event Claimed(address indexed account,uint256 amount)",
];
const escrowRead = new ethers.Contract(ESCROW, escrowAbi, provider);
const token = new ethers.Contract(USDC, ["function balanceOf(address) view returns (uint256)"], provider);
const zeroHash = ethers.ZeroHash;

async function glRead(method, args) {
  const value = await gl.readContract({ address: GENLAYER, functionName: method, args });
  return typeof value === "string" ? JSON.parse(value) : value;
}

function verifyFundedChallenge(caseId, challenge, deposit, tx, receipt) {
  if (!tx || !receipt || receipt.status !== 1) throw new Error("The recorded Base challenge funding receipt is missing or failed");
  if (tx.to?.toLowerCase() !== ESCROW.toLowerCase()
    || tx.from?.toLowerCase() !== challenge.challenger.toLowerCase()) {
    throw new Error("Base challenge transaction sender or escrow target does not match A239 state");
  }
  const parsedTx = new ethers.Interface(["function fundChallenge(bytes32 caseId,uint256 amount)"]).parseTransaction({ data: tx.data });
  if (!parsedTx || parsedTx.name !== "fundChallenge"
    || parsedTx.args.caseId.toLowerCase() !== caseId.toLowerCase()
    || parsedTx.args.amount.toString() !== challenge.stake_deposited_wei) {
    throw new Error("Base challenge transaction calldata does not match the GenLayer stake record");
  }
  const fundEvent = receipt.logs.map((log) => {
    if (log.address.toLowerCase() !== ESCROW.toLowerCase()) return null;
    try { return escrowRead.interface.parseLog(log); } catch { return null; }
  }).find((event) => event?.name === "ChallengeFunded"
    && event.args.caseId.toLowerCase() === caseId.toLowerCase()
    && event.args.challenger.toLowerCase() === challenge.challenger.toLowerCase()
    && event.args.amount.toString() === challenge.stake_deposited_wei);
  if (!fundEvent) throw new Error("Base receipt lacks the exact ChallengeFunded event");
  if (deposit.amount.toString() !== challenge.stake_deposited_wei) {
    throw new Error("Base challenger-specific deposit differs from the resolved GenLayer stake");
  }
}

const [protocol, investigation, challenge, evidenceIds, item, latestBlock] = await Promise.all([
  glRead("get_protocol_info", []),
  glRead("get_investigation", [INVESTIGATION_ID]),
  glRead("get_challenge", [EXPECTED_CHALLENGE_ID]),
  glRead("get_evidence_ids_for_investigation", [INVESTIGATION_ID]),
  escrowRead.getCase(CASE_ID),
  provider.getBlock("latest"),
]);
if (String(investigation.base_case_id).toLowerCase() !== CASE_ID
  || investigation.submitter.toLowerCase() !== item.submitter.toLowerCase()
  || investigation.bounty_wei !== item.bounty.toString()
  || Number(investigation.seller_bond_id) !== 0
  || item.sellerBondId.toLowerCase() !== zeroHash.toLowerCase()
  || !item.registered
  || item.genlayerContract.toLowerCase() !== GENLAYER.toLowerCase()
  || Number(item.genlayerInvestigationId) !== INVESTIGATION_ID) {
  throw new Error("A239 GenLayer investigation does not exactly match its Base registration");
}
if (Number(investigation.last_challenge_id) !== EXPECTED_CHALLENGE_ID
  || Number(investigation.open_challenge_id) !== 0
  || Number(challenge.investigation_id) !== INVESTIGATION_ID
  || Number(challenge.status) !== 2
  || challenge.challenger.toLowerCase() !== item.challenger.toLowerCase()
  || BigInt(item.challengeStake) !== BigInt(challenge.stake_deposited_wei)
  || Number(challenge.prior_verdict) !== Number(investigation.verdict)
  || Number(investigation.verdict) !== 3) {
  throw new Error("A239 live state differs from its recorded finalized upheld challenge and RECALL_CONFIRMED verdict");
}
if (String(protocol.admin).toLowerCase() !== "0x7452084e1cf767bf19c743051cff27d9f7a87a4d") {
  throw new Error("The historical A239 administrator changed; stop and re-review this recovery procedure");
}
const deposit = await escrowRead.getChallengeDeposit(CASE_ID, challenge.challenger);
const fundingTx = await provider.getTransaction(challenge.base_tx_hash);
const fundingReceipt = await provider.getTransactionReceipt(challenge.base_tx_hash);
verifyFundedChallenge(CASE_ID, challenge, deposit, fundingTx, fundingReceipt);

const deadline = Number(investigation.challenge_deadline);
const now = Number(latestBlock.timestamp);
const report = {
  mode: relayMode ? "relay" : "read-only preflight",
  chainIds: { genlayer: "61999", base: String((await provider.getNetwork()).chainId) },
  contracts: { genlayer: GENLAYER, escrow: ESCROW, usdc: USDC },
  caseId: CASE_ID,
  investigationId: INVESTIGATION_ID,
  administrator: protocol.admin,
  adminKeyExpectedFromLocalCliAccount: "eventweaver",
  case: { submitter: item.submitter, bountyBaseUnits: item.bounty.toString(), registered: item.registered, finalized: item.finalized },
  investigation: { status: Number(investigation.status), verdict: Number(investigation.verdict), settled: investigation.settled, lastChallengeId: Number(investigation.last_challenge_id), challengeDeadline: deadline, challengeDeadlineUtc: new Date(deadline * 1000).toISOString() },
  challenge: { id: EXPECTED_CHALLENGE_ID, status: Number(challenge.status), challenger: challenge.challenger, stakeBaseUnits: challenge.stake_deposited_wei, baseFundingTx: challenge.base_tx_hash, baseReceiptBlock: fundingReceipt.blockNumber },
  firstEvidenceIds: evidenceIds,
  base: { blockNumber: latestBlock.number, blockTimestamp: now, finalized: item.finalized, challengeDepositBaseUnits: deposit.amount.toString() },
  eligibleToRelay: now >= deadline && investigation.settled === true && item.finalized === false,
  writesSent: false,
};

if (!relayMode) {
  console.log(JSON.stringify(report, null, 2));
  process.exit(0);
}
if (now < deadline) throw new Error(`A239 challenge period remains open until ${new Date(deadline * 1000).toISOString()}`);
if (!investigation.settled || Number(investigation.status) !== 5 || item.finalized) {
  throw new Error("A239 requires a finalized GenLayer settlement and an unfinalized matching Base case");
}
const settlementTxHash = process.env.RECALLRAID_A239_SETTLEMENT_TX_HASH;
if (!/^0x[a-fA-F0-9]{64}$/.test(settlementTxHash || "")) {
  throw new Error("Set RECALLRAID_A239_SETTLEMENT_TX_HASH to the successful finalized settle_investigation transaction");
}
const tx = await gl.getTransaction({ hash: settlementTxHash });
const status = String(tx.statusName ?? tx.status_name ?? "").toUpperCase();
const consensus = String(tx.resultName ?? tx.result_name ?? "").toUpperCase();
const leader = tx.consensus_data?.leader_receipt?.find((entry) => entry?.mode === "leader");
const execution = String(leader?.execution_result ?? "").toUpperCase();
const returnStatus = String(leader?.result?.status ?? "").toLowerCase();
const decoded = decodeInputData((tx.tx_data.startsWith("0x") ? tx.tx_data : `0x${tx.tx_data}`), tx.recipient);
const callData = decoded && "callData" in decoded ? decoded.callData : undefined;
const call = callData instanceof Map ? Object.fromEntries(callData.entries()) : callData;
const args = call?.args;
if (status !== "FINALIZED" || !["AGREE", "MAJORITY_AGREE"].includes(consensus)
  || execution !== "SUCCESS" || returnStatus !== "return"
  || tx.recipient.toLowerCase() !== GENLAYER.toLowerCase()
  || tx.from_address.toLowerCase() !== String(protocol.admin).toLowerCase()
  || call?.method !== "settle_investigation" || !Array.isArray(args) || Number(args[0]) !== INVESTIGATION_ID) {
  throw new Error(`A239 terminal transaction is not the expected successful finalized admin settlement: ${status}/${consensus}/${execution}/${returnStatus}`);
}

const firstEvidenceId = Number(evidenceIds[0]);
if (!Number.isInteger(firstEvidenceId) || firstEvidenceId <= 0) throw new Error("A239 has no first evidence item for the documented hunter payout policy");
const firstEvidence = await glRead("get_evidence", [firstEvidenceId]);
const hunter = firstEvidence.submitter;
if (hunter.toLowerCase() !== "0x19e7e376e7c213b7e7e7e46cc70a5dd086daff2a") {
  throw new Error("A239 first-evidence hunter changed; re-evaluate the payout recipient before signing");
}
const [owner, relayerAddress, decisionSignerAddress] = await Promise.all([
  escrowRead.owner(), escrowRead.relayer(), escrowRead.decisionSigner(),
]);
const relayerKey = process.env.BASE_SEPOLIA_RELAYER_PRIVATE_KEY;
const signerKey = process.env.BASE_SEPOLIA_DECISION_SIGNER_PRIVATE_KEY;
if (!relayerKey || !signerKey) throw new Error("Base relayer and separate decision-signer keys are required in the ignored API environment");
const relayer = new ethers.Wallet(relayerKey, provider);
const decisionSigner = new ethers.Wallet(signerKey);
if (relayer.address.toLowerCase() !== relayerAddress.toLowerCase()
  || decisionSigner.address.toLowerCase() !== decisionSignerAddress.toLowerCase()) {
  throw new Error("Configured Base relayer or decision signer does not match the escrow roles");
}

const verdict = Number(investigation.verdict);
const confidenceBps = Number(investigation.ai_confidence_bps);
const challengeOverturned = Number(challenge.status) === 3 && Number(challenge.new_verdict) !== Number(challenge.prior_verdict);
if (challengeOverturned) throw new Error("A239 challenge outcome changed; stop and review before settlement");
const sellerBondId = item.sellerBondId;
const sellerBondSlash = "0";
const decisionHash = ethers.id(JSON.stringify({
  genlayerContract: GENLAYER,
  investigationId: INVESTIGATION_ID,
  caseId: CASE_ID,
  verdict,
  confidenceBps,
  hunter,
  challengeId: EXPECTED_CHALLENGE_ID,
  challenger: challenge.challenger,
  challengeOverturned,
  sellerBondId,
  sellerBondSlash,
}));
const domain = { name: "RecallRaidEscrow", version: "1", chainId: 84532, verifyingContract: ESCROW };
const types = { Adjudication: [
  { name: "caseId", type: "bytes32" }, { name: "genlayerContract", type: "address" },
  { name: "investigationId", type: "uint32" }, { name: "verdictCode", type: "uint8" },
  { name: "hunter", type: "address" }, { name: "challengeId", type: "uint32" },
  { name: "challenger", type: "address" }, { name: "challengeOverturned", type: "bool" },
  { name: "sellerBondId", type: "bytes32" }, { name: "sellerBondSlash", type: "uint256" },
  { name: "decisionHash", type: "bytes32" },
] };
const value = { caseId: CASE_ID, genlayerContract: GENLAYER, investigationId: INVESTIGATION_ID,
  verdictCode: verdict, hunter, challengeId: EXPECTED_CHALLENGE_ID, challenger: challenge.challenger,
  challengeOverturned, sellerBondId, sellerBondSlash: 0n, decisionHash };
const authorization = await decisionSigner.signTypedData(domain, types, value);
const relayContract = new ethers.Contract(ESCROW, escrowAbi, relayer);
const relayTx = await relayContract.relayAdjudication(CASE_ID, GENLAYER, INVESTIGATION_ID,
  verdict, hunter, EXPECTED_CHALLENGE_ID, challenge.challenger, challengeOverturned,
  sellerBondId, 0n, decisionHash, authorization);
const relayReceipt = await relayTx.wait(1);
if (!relayReceipt || relayReceipt.status !== 1) throw new Error(`Base A239 relay failed: ${relayTx.hash}`);
const settled = await escrowRead.getCase(CASE_ID);
const expectedHunterClaim = item.bounty + item.challengeStake;
const claimable = await escrowRead.claimable(hunter);
if (!settled.finalized || Number(settled.verdict) !== verdict
  || settled.hunter.toLowerCase() !== hunter.toLowerCase()
  || settled.genlayerDecisionHash.toLowerCase() !== decisionHash.toLowerCase()
  || claimable !== expectedHunterClaim) {
  throw new Error("A239 Base state does not match the signed upheld-challenge settlement");
}
const relayResult = { transactionHash: relayTx.hash, blockNumber: relayReceipt.blockNumber,
  decisionHash, verdict, hunter, hunterClaimableBaseUnits: claimable.toString(),
  challengeStakeForfeitedToHunter: item.challengeStake.toString(), authorizationSigner: decisionSigner.address,
  relayer: relayer.address };

let claimResult = null;
if (claimMode) {
  const hunterKey = process.env.RECALLRAID_A239_HUNTER_PRIVATE_KEY;
  if (!hunterKey) throw new Error("Set the first-evidence hunter key through a protected local secret source before --claim");
  const hunterWallet = new ethers.Wallet(hunterKey, provider);
  if (hunterWallet.address.toLowerCase() !== hunter.toLowerCase()) throw new Error("Claim key does not match the recorded A239 hunter");
  const before = await token.balanceOf(hunter);
  const claimTx = await new ethers.Contract(ESCROW, escrowAbi, hunterWallet).claim();
  const receipt = await claimTx.wait(1);
  const after = await token.balanceOf(hunter);
  if (!receipt || receipt.status !== 1 || after - before !== expectedHunterClaim
    || await escrowRead.claimable(hunter) !== 0n) {
    throw new Error("A239 hunter withdrawal did not produce the exact expected USDC balance increase");
  }
  claimResult = { transactionHash: claimTx.hash, blockNumber: receipt.blockNumber,
    amountBaseUnits: expectedHunterClaim.toString(), beforeBalance: before.toString(), afterBalance: after.toString() };
}
console.log(JSON.stringify({ ...report, writesSent: true, relay: relayResult, claim: claimResult }, null, 2));
