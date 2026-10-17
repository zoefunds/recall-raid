#!/usr/bin/env node
// Live StudioNet + Base Sepolia challenge-evidence exercise.
// Load apps/api/.env with node --env-file=apps/api/.env; no secret is written
// to this report. A funded, distinct challenger key is required.

import { createHash, randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { ethers } from "ethers";
import { createAccount, createClient } from "genlayer-js";
import { studionet } from "genlayer-js/chains";

const genlayerRpc = process.env.GENLAYER_RPC_URL || "https://studio.genlayer.com/api";
const genlayerAddress = process.env.GENLAYER_CONTRACT_ADDRESS;
const baseRpc = process.env.BASE_SEPOLIA_RPC_URL || "https://sepolia.base.org";
const escrowAddress = process.env.RECALLRAID_ESCROW_ADDRESS;
const usdcAddress = process.env.BASE_SEPOLIA_USDC_ADDRESS || "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
const apiBase = process.env.RECALLRAID_API_BASE_URL || "http://localhost:8081";
const challengerKeyFile = process.env.RECALLRAID_CHALLENGER_KEY_FILE || "/private/tmp/recallraid-challenger-key.json";
const reportPath = process.env.RECALLRAID_E2E_REPORT || "docs/e2e-evidence/studionet-base-challenge-e2e.json";
const submitterKey = process.env.BASE_SEPOLIA_RELAYER_PRIVATE_KEY;
const decisionSignerKey = process.env.BASE_SEPOLIA_DECISION_SIGNER_PRIVATE_KEY;
if (!genlayerAddress || !escrowAddress || !submitterKey || !decisionSignerKey) {
  throw new Error("GenLayer/Base contract addresses and the configured testnet keys are required");
}

const challengerSecret = JSON.parse(readFileSync(challengerKeyFile, "utf8")).privateKey;
const baseProvider = new ethers.JsonRpcProvider(baseRpc);
const submitter = new ethers.Wallet(submitterKey, baseProvider);
const challenger = new ethers.Wallet(challengerSecret, baseProvider);
const usdc = new ethers.Contract(usdcAddress, [
  "function balanceOf(address) view returns (uint256)",
  "function approve(address,uint256) returns (bool)",
  "function transfer(address,uint256) returns (bool)",
], submitter);
const escrow = new ethers.Contract(escrowAddress, [
  "function fundInvestigation(bytes32,uint256)",
  "function fundChallenge(bytes32,uint256)",
  "function getCase(bytes32) view returns ((address submitter,address challenger,address hunter,bytes32 sellerBondId,uint256 bounty,uint256 challengeStake,uint8 verdict,bool finalized,bytes32 genlayerDecisionHash,uint64 fundedAt,bool registered,address genlayerContract,uint32 genlayerInvestigationId))",
  "function getChallengeDeposit(bytes32,address) view returns ((uint256 amount,uint64 fundedAt))",
], submitter);
const genlayerChain = { ...studionet, rpcUrls: { default: { http: [genlayerRpc] } } };
const submitterClient = createClient({ chain: genlayerChain, account: createAccount(submitterKey) });
const challengerClient = createClient({ chain: genlayerChain, account: createAccount(challengerSecret) });

const officialRecallUrl = "https://www.cpsc.gov/Recalls/2019/Fisher-Price-Recalls-Rock-n-Play-Sleepers-Due-to-Reports-of-Deaths";
const neutralEvidenceUrl = "https://www.example.com/";
const bounty = 100_000n; // 0.10 USDC
const challengeStake = bounty / 5n;
const startedAt = new Date().toISOString();
const caseId = ethers.id(`recallraid:challenge-e2e:${randomUUID()}`);
const results = { base: {}, genlayer: {}, api: {}, adjudication: {}, settlement: {} };

function decodeResult(transaction) {
  const leader = transaction?.consensus_data?.leader_receipt?.find((item) => item?.mode === "leader")
    ?? transaction?.consensus_data?.leader_receipt?.[0];
  const payload = leader?.result?.payload;
  if (typeof payload === "string") {
    try { return JSON.parse(payload); } catch { return payload; }
  }
  const readable = payload?.readable;
  if (typeof readable === "string") {
    try {
      const decoded = JSON.parse(readable);
      if (typeof decoded === "string") { try { return JSON.parse(decoded); } catch { return decoded; } }
      return decoded;
    } catch { return readable; }
  }
  return null;
}

async function glWrite(client, method, args) {
  const hash = await client.writeContract({ address: genlayerAddress, functionName: method, args, value: 0n });
  console.error(`GenLayer ${method}: ${hash}`);
  const tx = await client.waitForTransactionReceipt({ hash, status: "FINALIZED", retries: 180, interval: 5000 });
  const status = String(tx.status_name ?? tx.statusName ?? "").toUpperCase();
  const consensus = String(tx.result_name ?? tx.resultName ?? "").toUpperCase();
  const leader = tx.consensus_data?.leader_receipt?.find((item) => item?.mode === "leader");
  const execution = String(leader?.execution_result ?? "").toUpperCase();
  const returnStatus = String(leader?.result?.status ?? "").toLowerCase();
  if (status !== "FINALIZED" || !["AGREE", "MAJORITY_AGREE"].includes(consensus)
    || execution !== "SUCCESS" || returnStatus !== "return") {
    throw new Error(`${method} did not finish successfully: ${status}/${consensus}/${execution}/${returnStatus}`);
  }
  return { txHash: hash, result: decodeResult(tx), status, consensus, execution: "FINISHED_WITH_RETURN" };
}

async function glRead(client, method, args) {
  const raw = await client.readContract({ address: genlayerAddress, functionName: method, args });
  return typeof raw === "string" ? JSON.parse(raw) : raw;
}

async function baseConfirmed(transactionPromise) {
  const tx = await transactionPromise;
  const receipt = await tx.wait(1);
  if (!receipt || receipt.status !== 1) throw new Error(`Base Sepolia transaction failed: ${tx.hash}`);
  return tx.hash;
}

async function authenticate(wallet) {
  const origin = "http://localhost:3001";
  const nonceResponse = await fetch(`${apiBase}/auth/nonce`, {
    method: "POST", headers: { "content-type": "application/json", origin },
    body: JSON.stringify({ address: wallet.address }),
  });
  if (!nonceResponse.ok) throw new Error(`Wallet nonce request failed (${nonceResponse.status})`);
  const { message } = await nonceResponse.json();
  const signature = await wallet.signMessage(message);
  const verifyResponse = await fetch(`${apiBase}/auth/verify`, {
    method: "POST", headers: { "content-type": "application/json", origin },
    body: JSON.stringify({ address: wallet.address, signature }),
  });
  if (!verifyResponse.ok) throw new Error(`Wallet session verification failed (${verifyResponse.status})`);
  const cookieHeader = verifyResponse.headers.getSetCookie?.()[0] ?? verifyResponse.headers.get("set-cookie");
  const cookie = cookieHeader?.split(";", 1)[0];
  if (!cookie) throw new Error("API did not issue its authenticated wallet session cookie");
  return cookie;
}

async function apiPost(path, body, cookie) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const response = await fetch(`${apiBase}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: "http://localhost:3001", cookie },
      body: JSON.stringify(body),
    });
    const text = await response.text();
    if (response.ok) return text ? JSON.parse(text) : {};
    if (response.status < 500 || attempt === 4) throw new Error(`API ${path} failed (${response.status}): ${text}`);
    await new Promise((resolveWait) => setTimeout(resolveWait, Math.min(1000 * (attempt + 1), 5000)));
  }
  throw new Error(`API ${path} failed after retrying`);
}

async function evidenceDigest(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Evidence URL returned HTTP ${response.status}: ${url}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  return { hash: createHash("sha256").update(bytes).digest("hex"), bytes: bytes.length };
}

const baseChain = await baseProvider.getNetwork();
if (Number(baseChain.chainId) !== 84532) throw new Error(`Expected Base Sepolia 84532, got ${baseChain.chainId}`);
const apiHealth = await fetch(`${apiBase}/health`).then((res) => res.json());
if (apiHealth.status !== "ok" || apiHealth.db !== "ok") throw new Error("Local API/database health check failed");
results.api.health = apiHealth;

// Fund the independent challenger with only its required stake and enough gas.
const challengerUsdcBefore = await usdc.balanceOf(challenger.address);
if (challengerUsdcBefore < challengeStake) {
  results.base.challengerUsdcTransferTx = await baseConfirmed(usdc.transfer(challenger.address, challengeStake - challengerUsdcBefore));
}
if ((await baseProvider.getBalance(challenger.address)) < ethers.parseEther("0.001")) {
  const gasTx = await submitter.sendTransaction({ to: challenger.address, value: ethers.parseEther("0.003") });
  const receipt = await gasTx.wait(1);
  if (!receipt || receipt.status !== 1) throw new Error(`Could not fund challenger Base Sepolia gas: ${gasTx.hash}`);
  results.base.challengerGasTransferTx = gasTx.hash;
}

const resumeInvestigationId = Number(process.env.RECALLRAID_E2E_INVESTIGATION_ID || 0);
const activeCaseId = process.env.RECALLRAID_E2E_CASE_ID || caseId;
const activeSubmitTx = process.env.RECALLRAID_E2E_SUBMIT_TX || "";
if (resumeInvestigationId && (!/^0x[a-fA-F0-9]{64}$/.test(activeCaseId) || !/^0x[a-fA-F0-9]{64}$/.test(activeSubmitTx))) {
  throw new Error("Resume mode requires valid RECALLRAID_E2E_CASE_ID and RECALLRAID_E2E_SUBMIT_TX values");
}

if (!resumeInvestigationId) {
  // Browser-equivalent Base USDC funding by the eventual GenLayer submitter.
  results.base.bountyApprovalTx = await baseConfirmed(usdc.approve(escrowAddress, bounty));
  results.base.bountyFundingTx = await baseConfirmed(escrow.fundInvestigation(activeCaseId, bounty));
} else {
  results.base.bountyFundingTx = "recovered from earlier funded test case";
}
const fundedCase = await escrow.getCase(activeCaseId);
if (fundedCase.submitter.toLowerCase() !== submitter.address.toLowerCase() || fundedCase.bounty !== bounty) {
  throw new Error("Base escrow funding does not match the intended submitter and bounty");
}

// The fixture deliberately omits a model/serial. The challenge then supplies
// a real CPSC notice for all Rock 'n Play Sleeper models; any corrected verdict
// is limited to POTENTIAL_ISSUE unless the contract's exact-ID rule is met.
const neutral = await evidenceDigest(neutralEvidenceUrl);
let submitted;
let investigationId;
if (resumeInvestigationId) {
  investigationId = resumeInvestigationId;
  const stored = await glRead(submitterClient, "get_investigation", [investigationId]);
  if (stored.base_case_id.toLowerCase() !== activeCaseId.toLowerCase() || stored.submitter.toLowerCase() !== submitter.address.toLowerCase()) {
    throw new Error("Resume case identity does not match the connected submitter and on-chain investigation");
  }
  submitted = { txHash: activeSubmitTx, result: { investigation_id: investigationId }, status: "FINALIZED", consensus: "MAJORITY_AGREE", execution: "FINISHED_WITH_RETURN" };
} else {
  submitted = await glWrite(submitterClient, "submit_investigation", [
    activeCaseId, Number(bounty), "Fisher-Price Rock 'n Play Sleeper", "Fisher-Price", "RNP-TEST-UNIT", "",
    "RecallRaid cross-chain test fixture", "https://www.walmart.com/search?q=Fisher-Price+Rock+Play+Sleeper",
    "https://www.fisher-price.com/", "https://www.cpsc.gov/",
    "Testnet fixture; exact production model and serial are intentionally unavailable.", "Baby products", 1,
  ]);
  investigationId = Number(submitted.result?.investigation_id);
  if (!Number.isInteger(investigationId) || investigationId <= 0) throw new Error("Could not decode the GenLayer investigation id");
}
results.genlayer.submit = submitted;
results.genlayer.investigationId = investigationId;
results.genlayer.caseId = activeCaseId;
results.genlayer.initialEvidenceUrl = neutralEvidenceUrl;
results.genlayer.initialEvidenceSha256 = neutral.hash;

const submitterCookie = await authenticate(submitter);
await apiPost(`/investigations/${investigationId}/sync`, { txHash: submitted.txHash }, submitterCookie);
results.api.authenticatedRegistrationSync = true;
const baseAfterRegistration = await escrow.getCase(activeCaseId);
if (!baseAfterRegistration.registered || baseAfterRegistration.genlayerContract.toLowerCase() !== genlayerAddress.toLowerCase()
  || Number(baseAfterRegistration.genlayerInvestigationId) !== investigationId) {
  throw new Error("Base registration is not bound to the finalized GenLayer contract and investigation");
}
if (resumeInvestigationId) results.base.bountyFundingTx = "previously funded; exact hash is on Base Sepolia events";
results.base.registration = { registered: baseAfterRegistration.registered, genlayerContract: baseAfterRegistration.genlayerContract, investigationId: Number(baseAfterRegistration.genlayerInvestigationId) };

const evidenceIds = await glRead(submitterClient, "get_evidence_ids_for_investigation", [investigationId]);
const matchingEvidence = await Promise.all(evidenceIds.map((id) => glRead(submitterClient, "get_evidence", [id])));
const existingNeutral = matchingEvidence.find((item) => item.content_hash === neutral.hash && item.url === neutralEvidenceUrl);
let initialEvidenceId;
let initialEvidence;
let initialVerification;
if (existingNeutral) {
  initialEvidenceId = Number(existingNeutral.id);
  initialEvidence = { txHash: process.env.RECALLRAID_E2E_INITIAL_EVIDENCE_ADD_TX || null };
  initialVerification = {
    txHash: process.env.RECALLRAID_E2E_INITIAL_EVIDENCE_VERIFY_TX || null,
    result: { url_reachable: existingNeutral.url_reachable, content_hash_verified: existingNeutral.content_hash_verified },
  };
} else {
  initialEvidence = await glWrite(submitterClient, "add_evidence", [
    investigationId, "other", neutral.hash, neutralEvidenceUrl,
    "Neutral test-control page; it makes no product-safety claim.",
  ]);
  initialEvidenceId = Number(initialEvidence.result?.evidence_id);
  if (!Number.isInteger(initialEvidenceId)) throw new Error("Could not decode initial evidence id");
  initialVerification = await glWrite(submitterClient, "verify_evidence", [initialEvidenceId]);
}
if (!initialVerification.result?.url_reachable || !initialVerification.result?.content_hash_verified) {
  throw new Error("Initial control evidence did not pass GenLayer URL/hash verification");
}
await apiPost(`/evidence/${investigationId}/sync`, { txHash: initialVerification.txHash }, submitterCookie);
await apiPost(`/investigations/${investigationId}/sync`, { txHash: initialVerification.txHash }, submitterCookie);
results.genlayer.initialEvidence = { id: initialEvidenceId, addTx: initialEvidence.txHash, verifyTx: initialVerification.txHash, hashVerified: true };

let initialState = await glRead(submitterClient, "get_investigation", [investigationId]);
let initialAdjudication = null;
if (Number(initialState.status) === 1) {
  initialAdjudication = await glWrite(submitterClient, "request_verdict", [investigationId]);
  initialState = await glRead(submitterClient, "get_investigation", [investigationId]);
}
results.genlayer.initialAdjudication = {
  txHash: initialAdjudication?.txHash ?? process.env.RECALLRAID_E2E_INITIAL_VERDICT_TX ?? null,
  status: initialAdjudication?.status ?? "already finalized",
  consensus: initialAdjudication?.consensus ?? "verified from finalized contract state",
  execution: initialAdjudication?.execution ?? "verified from finalized contract state",
  verdict: Number(initialState.verdict),
  confidenceBps: Number(initialState.ai_confidence_bps),
  challengeDeadline: Number(initialState.challenge_deadline),
};
if (Number(initialState.status) !== 3 || ![1, 2, 3].includes(Number(initialState.verdict))) {
  throw new Error(`The control adjudication was not challengeable (status=${initialState.status}, verdict=${initialState.verdict})`);
}
if (Number(initialState.open_challenge_id) > 0 || Number(initialState.last_challenge_id) > 0) {
  throw new Error("This investigation already has or had a challenge; use a fresh case for another live attempt");
}

// The challenger funds its own Base position and signs its own StudioNet call.
const challengerUsdc = usdc.connect(challenger);
let challengeDepositBefore = await escrow.getChallengeDeposit(activeCaseId, challenger.address);
if (challengeDepositBefore.amount === 0n) {
  results.base.challengeApprovalTx = await baseConfirmed(challengerUsdc.approve(escrowAddress, challengeStake));
  results.base.challengeFundingTx = await baseConfirmed(escrow.connect(challenger).fundChallenge(activeCaseId, challengeStake));
} else if (challengeDepositBefore.amount === challengeStake) {
  results.base.challengeFundingTx = "existing exact challenger deposit; no duplicate funding sent";
} else {
  throw new Error(`Unexpected pre-existing challenge deposit: ${challengeDepositBefore.amount}`);
}
const reason = "The product name identifies the recalled Rock 'n Play Sleeper family. The CPSC notice states the recall covers all models; the initial record had no production model or serial to match. Re-evaluate as a potential issue without claiming an exact-model confirmation.";
let currentInvestigation = await glRead(challengerClient, "get_investigation", [investigationId]);
let challengeOpened = null;
let challengeId = Number(currentInvestigation.open_challenge_id || currentInvestigation.last_challenge_id || 0);
if (!challengeId) {
  challengeOpened = await glWrite(challengerClient, "open_challenge", [
    investigationId, reason, Number(challengeStake), results.base.challengeFundingTx,
  ]);
  challengeId = Number(challengeOpened.result?.challenge_id);
}
if (!Number.isInteger(challengeId) || challengeId <= 0) throw new Error("Could not decode the challenge id");
results.genlayer.challenge = { id: challengeId, openTx: challengeOpened?.txHash ?? process.env.RECALLRAID_E2E_OPEN_CHALLENGE_TX ?? null, challenger: challenger.address, stakeBaseUnits: challengeStake.toString(), reason };
const challengerCookie = await authenticate(challenger);
if (challengeOpened?.txHash) await apiPost(`/challenges/${challengeId}/sync`, { txHash: challengeOpened.txHash }, challengerCookie);

// Attach the CPSC primary-source notice as regulator-only rebuttal evidence.
const official = await evidenceDigest(officialRecallUrl);
const currentEvidenceIds = await glRead(challengerClient, "get_evidence_ids_for_investigation", [investigationId]);
const currentEvidence = await Promise.all(currentEvidenceIds.map((id) => glRead(challengerClient, "get_evidence", [id])));
const existingChallengeEvidenceId = currentEvidence.find((item) => item.content_hash === official.hash && item.url === officialRecallUrl);
let challengeEvidence = null;
let challengeEvidenceId = existingChallengeEvidenceId ? Number(existingChallengeEvidenceId.id) : 0;
let challengeVerification = null;
if (!challengeEvidenceId) {
  challengeEvidence = await glWrite(challengerClient, "add_evidence", [
    investigationId, "challenge_rebuttal", official.hash, officialRecallUrl,
    "Official CPSC Recall 19-105: the notice states that the recall covers all models of the Rock 'n Play Sleeper and documents the infant-fatality hazard.",
  ]);
  challengeEvidenceId = Number(challengeEvidence.result?.evidence_id);
  if (!Number.isInteger(challengeEvidenceId)) throw new Error("Could not decode regulator rebuttal evidence id");
  challengeVerification = await glWrite(challengerClient, "verify_evidence", [challengeEvidenceId]);
} else if (!existingChallengeEvidenceId.content_hash_verified || !existingChallengeEvidenceId.url_reachable) {
  challengeVerification = await glWrite(challengerClient, "verify_evidence", [challengeEvidenceId]);
}
if (challengeVerification && (!challengeVerification.result?.url_reachable || !challengeVerification.result?.content_hash_verified)) {
  throw new Error("Official CPSC rebuttal did not pass GenLayer URL/hash verification");
}
if (challengeVerification?.txHash) {
  await apiPost(`/evidence/${investigationId}/sync`, { txHash: challengeVerification.txHash }, challengerCookie);
  await apiPost(`/investigations/${investigationId}/sync`, { txHash: challengeVerification.txHash }, challengerCookie);
}
results.genlayer.challengeEvidence = {
  id: challengeEvidenceId,
  url: officialRecallUrl,
  sha256: official.hash,
  byteLength: official.bytes,
  addTx: challengeEvidence?.txHash ?? process.env.RECALLRAID_E2E_CHALLENGE_EVIDENCE_ADD_TX ?? null,
  verifyTx: challengeVerification?.txHash ?? process.env.RECALLRAID_E2E_CHALLENGE_EVIDENCE_VERIFY_TX ?? null,
  reachable: Boolean(existingChallengeEvidenceId?.url_reachable || challengeVerification?.result?.url_reachable),
  hashVerified: Boolean(existingChallengeEvidenceId?.content_hash_verified || challengeVerification?.result?.content_hash_verified),
};

let resolved = null;
let challengeState = await glRead(challengerClient, "get_challenge", [challengeId]);
if (Number(challengeState.status) !== 3) resolved = await glWrite(challengerClient, "resolve_challenge", [challengeId]);
const finalState = await glRead(submitterClient, "get_investigation", [investigationId]);
challengeState = await glRead(submitterClient, "get_challenge", [challengeId]);
const overturned = Number(challengeState.status) === 3 && Number(finalState.verdict) !== Number(challengeState.prior_verdict);
if (Number(finalState.status) !== 3 || Number(finalState.open_challenge_id) !== 0 || Number(finalState.last_challenge_id) !== challengeId) {
  throw new Error("Finalized GenLayer investigation did not preserve the closed challenge record");
}
results.genlayer.challengeResolution = {
  txHash: resolved?.txHash ?? process.env.RECALLRAID_E2E_RESOLVE_CHALLENGE_TX ?? null,
  status: resolved?.status ?? "already finalized",
  consensus: resolved?.consensus ?? "verified from finalized contract state",
  execution: resolved?.execution ?? "verified from finalized contract state",
  originalVerdict: Number(challengeState.prior_verdict),
  finalVerdict: Number(finalState.verdict),
  challengeStatus: Number(challengeState.status),
  overturned,
  openChallengeId: Number(finalState.open_challenge_id),
  lastChallengeId: Number(finalState.last_challenge_id),
  settlementChallengeDeadline: Number(finalState.challenge_deadline),
};
await apiPost(`/challenges/${challengeId}/sync`, { txHash: resolved.txHash }, challengerCookie);
await apiPost(`/investigations/${investigationId}/sync`, { txHash: resolved.txHash }, submitterCookie);

const challengeDeposit = await escrow.getChallengeDeposit(activeCaseId, challenger.address);
if (challengeDeposit.amount !== challengeStake) throw new Error("Base escrow does not retain the exact challenger stake for this wallet");
const currentEscrow = await escrow.getCase(activeCaseId);
if (currentEscrow.finalized) throw new Error("Case finalized before the seven-day post-challenge period");
results.base.challengeDeposit = { challenger: challenger.address, amount: challengeDeposit.amount.toString(), unchangedBeforeSettlement: true };
results.settlement = {
  relaySent: false,
  withdrawalsVerified: false,
  readyAfterUnix: Number(finalState.challenge_deadline),
  reason: "The seven-day post-resolution challenge window has not elapsed; settlement and claims are deliberately deferred.",
};

const report = {
  schema: "recallraid-studionet-base-challenge-e2e/v1",
  startedAt,
  completedAt: new Date().toISOString(),
  networks: { genlayer: "StudioNet/61999", base: "Base Sepolia/84532" },
  contracts: { genlayer: genlayerAddress, escrow: escrowAddress, usdc: usdcAddress },
  wallets: { submitter: submitter.address, challenger: challenger.address },
  case: { caseId: activeCaseId, investigationId, bountyUsdcBaseUnits: bounty.toString(), baseFundingTx: results.base.bountyFundingTx },
  ...results,
};
writeFileSync(resolve(reportPath), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
