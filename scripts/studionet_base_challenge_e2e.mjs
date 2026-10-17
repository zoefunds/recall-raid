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
const testOrigin = process.env.RECALLRAID_E2E_ORIGIN || "http://localhost:3001";
const challengerKeyFile = process.env.RECALLRAID_CHALLENGER_KEY_FILE || "/private/tmp/recallraid-challenger-key.json";
const submitterKey = process.env.RECALLRAID_E2E_SUBMITTER_PRIVATE_KEY || process.env.BASE_SEPOLIA_RELAYER_PRIVATE_KEY;
const decisionSignerKey = process.env.BASE_SEPOLIA_DECISION_SIGNER_PRIVATE_KEY;
if (!genlayerAddress || !escrowAddress || !submitterKey || !decisionSignerKey) {
  throw new Error("GenLayer/Base contract addresses and the configured testnet keys are required");
}

const hardenedResume = process.env.RECALLRAID_HARDENED_SUCCESSOR_RESUME === "1";
const hardenedExpected = {
  contract: "0xfAc47CB7eEbF95f3d043A0cd8112ecdb24486ecA",
  caseId: "0xd370cf1ea5d45edace9ba669f396d6ab139dc4566a9933b8f5e738b0f8953987",
  submitTx: "0x5c7081620580dcac4f430a8a1f6d519ab9072a219b767007f685296ec9c8e1a5",
  fundingTx: "0x45d0d80a71cb717ca2cf226aef602800926ab0d0e83146449d9c500ae76f3caf",
};
const reportPath = process.env.RECALLRAID_E2E_REPORT || "docs/e2e-evidence/studionet-base-challenge-e2e.json";
const resumeInvestigationId = Number(process.env.RECALLRAID_E2E_INVESTIGATION_ID || 0);
const activeCaseId = process.env.RECALLRAID_E2E_CASE_ID || "";
const activeSubmitTx = process.env.RECALLRAID_E2E_SUBMIT_TX || "";
let checkpointReport = null;
if (hardenedResume) {
  if (genlayerAddress.toLowerCase() !== hardenedExpected.contract.toLowerCase()
    || activeCaseId.toLowerCase() !== hardenedExpected.caseId
    || activeSubmitTx.toLowerCase() !== hardenedExpected.submitTx
    || process.env.RECALLRAID_E2E_BASE_FUNDING_TX?.toLowerCase() !== hardenedExpected.fundingTx
    || resumeInvestigationId !== 1
    || reportPath !== "docs/e2e-evidence/hardened-successor-live-challenge.json") {
    throw new Error("Hardened successor resume requires its exact successor contract, case, submit and funding tx, investigation 1, and dedicated report path");
  }
} else if (process.env.RECALLRAID_E2E_INVESTIGATION_ID && (!activeCaseId || !activeSubmitTx)) {
  throw new Error("Generic resume mode requires explicit case ID and finalized submit transaction hash");
}

const challengerSecret = JSON.parse(readFileSync(challengerKeyFile, "utf8")).privateKey;
const baseProvider = new ethers.JsonRpcProvider(baseRpc);
const submitter = new ethers.Wallet(submitterKey, baseProvider);
const challenger = new ethers.Wallet(challengerSecret, baseProvider);
const usdc = new ethers.Contract(usdcAddress, [
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address,address) view returns (uint256)",
  "function approve(address,uint256) returns (bool)",
  "function transfer(address,uint256) returns (bool)",
], submitter);
const escrow = new ethers.Contract(escrowAddress, [
  "event InvestigationFunded(bytes32 indexed caseId,address indexed submitter,uint256 amount)",
  "event ChallengeFunded(bytes32 indexed caseId,address indexed challenger,uint256 amount)",
  "function fundInvestigation(bytes32,uint256)",
  "function fundChallenge(bytes32,uint256)",
  "function getCase(bytes32) view returns ((address submitter,address challenger,address hunter,bytes32 sellerBondId,uint256 bounty,uint256 challengeStake,uint8 verdict,bool finalized,bytes32 genlayerDecisionHash,uint64 fundedAt,bool registered,address genlayerContract,uint32 genlayerInvestigationId))",
  "function getChallengeDeposit(bytes32,address) view returns ((uint256 amount,uint64 fundedAt))",
], submitter);
const genlayerChain = { ...studionet, rpcUrls: { default: { http: [genlayerRpc] } } };
const submitterClient = createClient({ chain: genlayerChain, account: createAccount(submitterKey) });
const challengerClient = createClient({ chain: genlayerChain, account: createAccount(challengerSecret) });
if (hardenedResume) {
  checkpointReport = JSON.parse(readFileSync(resolve(reportPath), "utf8"));
  if (checkpointReport?.case?.caseId?.toLowerCase() !== hardenedExpected.caseId
    || checkpointReport?.case?.baseFundingTx?.toLowerCase() !== hardenedExpected.fundingTx
    || checkpointReport?.genlayer?.submit?.txHash?.toLowerCase() !== hardenedExpected.submitTx
    || !(checkpointReport?.api?.authenticatedRegistrationSync === true
      || checkpointReport?.api?.registrationAlreadyRecordedOnBase === true)) {
    throw new Error("Hardened successor checkpoint does not prove its existing funding, finalized submit, and registration");
  }
}

const officialRecallUrl = process.env.RECALLRAID_E2E_OFFICIAL_SOURCE_URL
  || "https://www.cpsc.gov/s3fs-public/010922-FP-and-Kids2-reannouncement.pdf?VersionId=rjCj6OORidUHu8aueBwkLh3zxvzha_Xl";
const neutralEvidenceUrl = "https://www.example.com/";
const bounty = 100_000n; // 0.10 USDC
const challengeStake = bounty / 5n;
const startedAt = new Date().toISOString();
const reportStartedAt = checkpointReport?.startedAt ?? startedAt;
const generatedCaseId = ethers.id(`recallraid:challenge-e2e:${randomUUID()}`);
const executionCaseId = activeCaseId || generatedCaseId;
let reportInvestigationId = resumeInvestigationId || null;
let reportProgress = checkpointReport?.progress?.stage ?? "initialized";
let reportPause = checkpointReport?.pause;
const results = { base: {}, genlayer: {}, api: {}, adjudication: {}, settlement: {} };
if (checkpointReport) {
  Object.assign(results.base, checkpointReport.base ?? {});
  Object.assign(results.genlayer, checkpointReport.genlayer ?? {});
  Object.assign(results.api, checkpointReport.api ?? {});
  Object.assign(results.adjudication, checkpointReport.adjudication ?? {});
  Object.assign(results.settlement, checkpointReport.settlement ?? {});
}

function checkpoint(stage) {
  const order = [
    "initialized", "services-healthy", "base-bounty-funded", "authenticated-registration-synced",
    "initial-evidence-verified", "initial-verdict-finalized", "base-challenge-funded",
    "genlayer-challenge-open", "challenge-evidence-added", "challenge-evidence-verified",
    "challenge-resolution-finalized", "settlement-wait",
  ];
  const currentOrder = order.indexOf(reportProgress);
  const requestedOrder = order.indexOf(stage);
  if (currentOrder < 0 || requestedOrder >= currentOrder) reportProgress = stage;
  const report = {
    schema: "recallraid-studionet-base-challenge-e2e/v1",
    startedAt: reportStartedAt,
    updatedAt: new Date().toISOString(),
    networks: { genlayer: "StudioNet/61999", base: "Base Sepolia/84532" },
    contracts: { genlayer: genlayerAddress, escrow: escrowAddress, usdc: usdcAddress },
    wallets: { submitter: submitter.address, challenger: challenger.address },
    case: { caseId: executionCaseId, investigationId: reportInvestigationId, bountyUsdcBaseUnits: bounty.toString(), baseFundingTx: results.base.bountyFundingTx },
    progress: { stage: reportProgress, complete: false },
    ...(reportPause ? { pause: reportPause } : {}),
    ...results,
  };
  writeFileSync(resolve(reportPath), `${JSON.stringify(report, null, 2)}\n`);
}

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
  const startedAt = Date.now();
  const maxWaitMs = Number(process.env.RECALLRAID_GENLAYER_READ_WAIT_MS || 60 * 60 * 1000);
  let backoffMs = 10_000;
  for (;;) {
    try {
      const raw = await client.readContract({ address: genlayerAddress, functionName: method, args });
      return typeof raw === "string" ? JSON.parse(raw) : raw;
    } catch (error) {
      const message = [error?.details, error?.message, error?.cause?.message]
        .filter(Boolean).join(" ");
      if (!message.includes("Rate limit exceeded:")) throw error;
      const elapsedMs = Date.now() - startedAt;
      if (elapsedMs >= maxWaitMs) {
        throw new Error(`StudioNet read quota did not recover within ${Math.round(maxWaitMs / 1000)} seconds (${method})`);
      }
      const advisedSeconds = Number(error?.cause?.data?.retry_after_seconds ?? 0);
      const waitMs = Math.min(60_000, Math.max(backoffMs, advisedSeconds * 1000));
      console.error(`GenLayer ${method} read is rate-limited; retrying in ${Math.ceil(waitMs / 1000)}s (waited ${Math.ceil(elapsedMs / 1000)}s)`);
      await new Promise((resolveWait) => setTimeout(resolveWait, waitMs));
      backoffMs = Math.min(backoffMs * 2, 60_000);
    }
  }
}

async function baseConfirmed(transactionPromise) {
  const tx = await transactionPromise;
  const receipt = await tx.wait(1);
  if (!receipt || receipt.status !== 1) throw new Error(`Base Sepolia transaction failed: ${tx.hash}`);
  return tx.hash;
}

function requireTxHash(hash, label) {
  if (!/^0x[a-fA-F0-9]{64}$/.test(hash ?? "")) {
    throw new Error(`${label} must be an exact 32-byte Base Sepolia transaction hash`);
  }
  return hash;
}

async function verifyFundingTx(hash, { caseId: expectedCaseId, payer, amount, kind }) {
  requireTxHash(hash, `${kind} funding transaction`);
  const transaction = await baseProvider.getTransaction(hash);
  const receipt = await baseProvider.getTransactionReceipt(hash);
  if (!transaction || !receipt || receipt.status !== 1) {
    throw new Error(`${kind} funding transaction is missing or did not succeed on Base Sepolia: ${hash}`);
  }
  if (transaction.from.toLowerCase() !== payer.toLowerCase()
    || transaction.to?.toLowerCase() !== escrowAddress.toLowerCase()) {
    throw new Error(`${kind} funding transaction sender or escrow does not match the expected wallet and contract`);
  }
  const parsedCall = escrow.interface.parseTransaction({ data: transaction.data, value: transaction.value });
  const expectedMethod = kind === "bounty" ? "fundInvestigation" : "fundChallenge";
  if (parsedCall?.name !== expectedMethod
    || parsedCall.args[0].toLowerCase() !== expectedCaseId.toLowerCase()
    || parsedCall.args[1] !== amount) {
    throw new Error(`${kind} funding transaction calldata does not match its case and exact amount`);
  }
  const expectedEvent = kind === "bounty" ? "InvestigationFunded" : "ChallengeFunded";
  const matchingEvent = receipt.logs.some((log) => {
    if (log.address.toLowerCase() !== escrowAddress.toLowerCase()) return false;
    try {
      const parsed = escrow.interface.parseLog(log);
      const eventPayer = kind === "bounty" ? parsed.args.submitter : parsed.args.challenger;
      return parsed.name === expectedEvent
        && parsed.args.caseId.toLowerCase() === expectedCaseId.toLowerCase()
        && eventPayer.toLowerCase() === payer.toLowerCase()
        && parsed.args.amount === amount;
    } catch {
      return false;
    }
  });
  if (!matchingEvent) throw new Error(`${kind} funding receipt lacks the matching ${expectedEvent} event`);
  return { transactionHash: hash, blockNumber: receipt.blockNumber, from: transaction.from, amount: amount.toString() };
}

async function authenticate(wallet) {
  const nonceResponse = await fetch(`${apiBase}/auth/nonce`, {
    method: "POST", headers: { "content-type": "application/json", origin: testOrigin },
    body: JSON.stringify({ address: wallet.address }),
  });
  if (!nonceResponse.ok) throw new Error(`Wallet nonce request failed (${nonceResponse.status})`);
  const { message } = await nonceResponse.json();
  const signature = await wallet.signMessage(message);
  const verifyResponse = await fetch(`${apiBase}/auth/verify`, {
    method: "POST", headers: { "content-type": "application/json", origin: testOrigin },
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
      headers: { "content-type": "application/json", origin: testOrigin, cookie },
      body: JSON.stringify(body),
    });
    const text = await response.text();
    if (response.ok) return text ? JSON.parse(text) : {};
    if (response.status >= 500 && text.includes("Rate limit exceeded")) {
      throw new Error(`API ${path} reached the StudioNet RPC rate limit: ${text}`);
    }
    if (response.status < 500 || attempt === 4) throw new Error(`API ${path} failed (${response.status}): ${text}`);
    await new Promise((resolveWait) => setTimeout(resolveWait, Math.min(1000 * (attempt + 1), 5000)));
  }
  throw new Error(`API ${path} failed after retrying`);
}

async function apiPostAfterQuotaReset(path, body, cookie) {
  const startedAt = Date.now();
  const maxWaitMs = Number(process.env.RECALLRAID_RPC_QUOTA_MAX_WAIT_MS || 60 * 60 * 1000);
  for (;;) {
    try {
      return await apiPost(path, body, cookie);
    } catch (error) {
      if (!String(error).includes("Rate limit exceeded")) throw error;
      const elapsedMs = Date.now() - startedAt;
      if (elapsedMs >= maxWaitMs) throw new Error(`StudioNet API quota did not recover within ${Math.round(maxWaitMs / 1000)} seconds (${path})`);
      const delayMs = Math.min(30_000, maxWaitMs - elapsedMs);
      console.error(`StudioNet quota still exhausted; retrying this exact read-only confirmation in ${Math.round(delayMs / 1000)}s`);
      await new Promise((resolveWait) => setTimeout(resolveWait, delayMs));
    }
  }
}

async function apiPostBestEffort(path, body, cookie) {
  try {
    await apiPost(path, body, cookie);
    return true;
  } catch (error) {
    if (!String(error).includes("Rate limit exceeded")) throw error;
    results.api.deferredSyncs ??= [];
    results.api.deferredSyncs.push({ path, reason: "Fly StudioNet RPC quota exhausted; retry after quota reset" });
    return false;
  }
}

async function apiGet(path) {
  const response = await fetch(`${apiBase}${path}`, { headers: { origin: testOrigin } });
  const text = await response.text();
  if (!response.ok) throw new Error(`API ${path} failed (${response.status}): ${text}`);
  return text ? JSON.parse(text) : {};
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
checkpoint("services-healthy");

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

if (resumeInvestigationId && (!/^0x[a-fA-F0-9]{64}$/.test(executionCaseId) || !/^0x[a-fA-F0-9]{64}$/.test(activeSubmitTx))) {
  throw new Error("Resume mode requires valid RECALLRAID_E2E_CASE_ID and RECALLRAID_E2E_SUBMIT_TX values");
}

if (!resumeInvestigationId) {
  // Browser-equivalent Base USDC funding by the eventual GenLayer submitter.
  const existingCase = await escrow.getCase(executionCaseId);
  if (existingCase.submitter === ethers.ZeroAddress) {
    results.base.bountyApprovalTx = await baseConfirmed(usdc.approve(escrowAddress, bounty));
    results.base.bountyFundingTx = await baseConfirmed(escrow.fundInvestigation(executionCaseId, bounty));
  } else if (existingCase.submitter.toLowerCase() === submitter.address.toLowerCase()
    && existingCase.bounty === bounty && !existingCase.finalized && !existingCase.registered) {
    results.base.bountyFundingTx = requireTxHash(process.env.RECALLRAID_E2E_BASE_FUNDING_TX, "Existing bounty funding transaction");
  } else {
    throw new Error("Existing Base case is not an exact unregistered deposit owned by the intended submitter");
  }
} else {
  results.base.bountyFundingTx = requireTxHash(process.env.RECALLRAID_E2E_BASE_FUNDING_TX, "Resumed bounty funding transaction");
}
results.base.bountyFunding = await verifyFundingTx(results.base.bountyFundingTx, {
  caseId: executionCaseId, payer: submitter.address, amount: bounty, kind: "bounty",
});
const fundedCase = await escrow.getCase(executionCaseId);
if (fundedCase.submitter.toLowerCase() !== submitter.address.toLowerCase() || fundedCase.bounty !== bounty) {
  throw new Error("Base escrow funding does not match the intended submitter and bounty");
}
checkpoint("base-bounty-funded");

// The fixture deliberately omits a model/serial. The challenge then supplies
// a version-pinned, stable-byte CPSC source about the recalled inclined
// sleepers. Any corrected verdict is limited to POTENTIAL_ISSUE unless the
// contract's exact-ID rule is met.
const neutral = await evidenceDigest(neutralEvidenceUrl);
let submitted;
let investigationId;
if (resumeInvestigationId) {
  investigationId = resumeInvestigationId;
  const stored = await glRead(submitterClient, "get_investigation", [investigationId]);
  if (stored.base_case_id.toLowerCase() !== executionCaseId.toLowerCase() || stored.submitter.toLowerCase() !== submitter.address.toLowerCase()) {
    throw new Error("Resume case identity does not match the connected submitter and on-chain investigation");
  }
  submitted = { txHash: activeSubmitTx, result: { investigation_id: investigationId }, status: "FINALIZED", consensus: "MAJORITY_AGREE", execution: "FINISHED_WITH_RETURN" };
} else {
  submitted = await glWrite(submitterClient, "submit_investigation", [
    executionCaseId, Number(bounty), "Fisher-Price Rock 'n Play Sleeper", "Fisher-Price", "RNP-TEST-UNIT", "",
    "RecallRaid cross-chain test fixture", "https://www.walmart.com/search?q=Fisher-Price+Rock+Play+Sleeper",
    "https://www.fisher-price.com/", "https://www.cpsc.gov/",
    "Testnet fixture; exact production model and serial are intentionally unavailable.", "Baby products", 1,
  ]);
  investigationId = Number(submitted.result?.investigation_id);
  if (!Number.isInteger(investigationId) || investigationId <= 0) throw new Error("Could not decode the GenLayer investigation id");
}
reportInvestigationId = investigationId;
results.genlayer.submit = submitted;
results.genlayer.investigationId = investigationId;
results.genlayer.caseId = executionCaseId;
results.genlayer.initialEvidenceUrl = neutralEvidenceUrl;
results.genlayer.initialEvidenceSha256 = neutral.hash;

const submitterCookie = await authenticate(submitter);
let baseAfterRegistration = await escrow.getCase(executionCaseId);
if (!baseAfterRegistration.registered) {
  await apiPost(`/investigations/${investigationId}/sync`, { txHash: submitted.txHash }, submitterCookie);
  for (let attempt = 0; attempt < 10; attempt++) {
    baseAfterRegistration = await escrow.getCase(executionCaseId);
    if (baseAfterRegistration.registered) break;
    await new Promise((resolveWait) => setTimeout(resolveWait, 2000));
  }
  results.api.authenticatedRegistrationSync = Boolean(baseAfterRegistration.registered);
} else {
  results.api.registrationPreviouslyRecorded = true;
  results.api.registrationAlreadyRecordedOnBase = true;
}
checkpoint("authenticated-registration-synced");
if (!baseAfterRegistration.registered || baseAfterRegistration.genlayerContract.toLowerCase() !== genlayerAddress.toLowerCase()
  || Number(baseAfterRegistration.genlayerInvestigationId) !== investigationId) {
  throw new Error("Base registration is not bound to the finalized GenLayer contract and investigation");
}
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
const cachedInitialEvidence = await apiGet(`/evidence?investigation_id=${investigationId}`);
const initialEvidenceCached = cachedInitialEvidence.some((item) => item.id === initialEvidenceId
  && item.content_hash_verified && item.url_reachable);
if (!initialEvidenceCached) {
  await apiPost(`/evidence/${investigationId}/sync`, initialVerification.txHash ? { txHash: initialVerification.txHash } : {}, submitterCookie);
}
results.genlayer.initialEvidence = { id: initialEvidenceId, addTx: initialEvidence.txHash, verifyTx: initialVerification.txHash, hashVerified: true };
checkpoint("initial-evidence-verified");

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
const existingOpenChallengeId = Number(initialState.open_challenge_id || 0);
if (![3, 4].includes(Number(initialState.status)) || ![1, 2, 3].includes(Number(initialState.verdict))) {
  throw new Error(`The control adjudication was not challengeable (status=${initialState.status}, verdict=${initialState.verdict})`);
}
if (Number(initialState.status) === 4 && existingOpenChallengeId <= 0) {
  throw new Error("Investigation reports an open challenge without its active challenge id");
}
if (Number(initialState.last_challenge_id) > 0 && existingOpenChallengeId <= 0) {
  throw new Error("This investigation already has or had a challenge; use a fresh case for another live attempt");
}
checkpoint("initial-verdict-finalized");
if (existingOpenChallengeId > 0) {
  const existingChallenge = await glRead(challengerClient, "get_challenge", [existingOpenChallengeId]);
  if (Number(existingChallenge.status) !== 1 || existingChallenge.challenger.toLowerCase() !== challenger.address.toLowerCase()) {
    throw new Error("Existing open challenge does not belong to the funded test challenger");
  }
  const existingOpenTx = process.env.RECALLRAID_E2E_OPEN_CHALLENGE_TX;
  if (/^0x[a-fA-F0-9]{64}$/.test(existingOpenTx ?? "")) {
    const request = {
      reason: existingChallenge.reason,
      stakeUsdcBaseUnits: challengeStake.toString(),
      baseTxHash: results.base.challengeFundingTx,
      txHash: existingOpenTx,
    };
    const confirmation = await apiPostAfterQuotaReset(`/investigations/${investigationId}/challenges/open-status`, request, await authenticate(challenger));
    if (confirmation.status !== "confirmed" || Number(confirmation.challengeId) !== existingOpenChallengeId) {
      throw new Error("Hosted API did not confirm the exact already-open funded challenge");
    }
    results.api.challengeConfirmation = confirmation;
    reportPause = undefined;
  }
}

// The challenger funds its own Base position and asks the authenticated API
// to verify the receipt before the GenLayer admin relay opens the slot.
const challengerUsdc = usdc.connect(challenger);
let challengeDepositBefore = await escrow.getChallengeDeposit(executionCaseId, challenger.address);
if (challengeDepositBefore.amount === 0n) {
  if (existingOpenChallengeId > 0) throw new Error("Open GenLayer challenge exists without its matching Base challenge stake");
  const currentAllowance = await challengerUsdc.allowance(challenger.address, escrowAddress);
  if (currentAllowance < challengeStake) {
    results.base.challengeApprovalTx = await baseConfirmed(challengerUsdc.approve(escrowAddress, challengeStake));
  }
  const confirmedAllowance = await challengerUsdc.allowance(challenger.address, escrowAddress);
  if (confirmedAllowance < challengeStake) throw new Error("Confirmed USDC approval is below the required challenge stake");
  results.base.challengeFundingTx = await baseConfirmed(escrow.connect(challenger).fundChallenge(executionCaseId, challengeStake));
} else if (challengeDepositBefore.amount === challengeStake) {
  const fundedTxHash = process.env.RECALLRAID_E2E_CHALLENGE_FUNDING_TX;
  if (!/^0x[a-fA-F0-9]{64}$/.test(fundedTxHash ?? "")) {
    throw new Error("An existing challenge deposit requires its exact Base ChallengeFunded transaction hash before opening or resuming a GenLayer challenge");
  }
  results.base.challengeFundingTx = fundedTxHash;
} else {
  throw new Error(`Unexpected pre-existing challenge deposit: ${challengeDepositBefore.amount}`);
}
results.base.challengeFunding = await verifyFundingTx(results.base.challengeFundingTx, {
  caseId: executionCaseId, payer: challenger.address, amount: challengeStake, kind: "challenge",
});
checkpoint("base-challenge-funded");
const reason = "The product name identifies the recalled Rock 'n Play Sleeper family. The CPSC notice states the recall covers all models; the initial record had no production model or serial to match. Re-evaluate as a potential issue without claiming an exact-model confirmation.";
let currentInvestigation = await glRead(challengerClient, "get_investigation", [investigationId]);
let challengeOpened = null;
let challengeId = Number(currentInvestigation.open_challenge_id || 0);
const challengerCookie = await authenticate(challenger);
if (!challengeId) {
  const request = {
    reason,
    stakeUsdcBaseUnits: challengeStake.toString(),
    baseTxHash: results.base.challengeFundingTx,
  };
  challengeOpened = await apiPost(`/investigations/${investigationId}/challenges/open`, request, challengerCookie);
  if (challengeOpened.status === "confirmed") {
    challengeId = Number(challengeOpened.challengeId);
  } else {
    if (!/^0x[a-fA-F0-9]{64}$/.test(challengeOpened.txHash ?? "")) throw new Error("The authenticated challenge relay did not return a GenLayer transaction hash");
    for (let attempt = 0; attempt < 180; attempt++) {
      const confirmation = await apiPostAfterQuotaReset(`/investigations/${investigationId}/challenges/open-status`, {
        ...request,
        txHash: challengeOpened.txHash,
      }, challengerCookie);
      if (confirmation.status === "confirmed") {
        challengeId = Number(confirmation.challengeId);
        break;
      }
      await new Promise((resolveWait) => setTimeout(resolveWait, 5000));
    }
  }
}
if (!Number.isInteger(challengeId) || challengeId <= 0) throw new Error("Could not decode the challenge id");
const recordedChallenge = await glRead(challengerClient, "get_challenge", [challengeId]);
if (recordedChallenge.base_tx_hash?.toLowerCase() !== results.base.challengeFundingTx.toLowerCase()
  || recordedChallenge.challenger.toLowerCase() !== challenger.address.toLowerCase()
  || BigInt(recordedChallenge.stake_wei) !== challengeStake
  || BigInt(recordedChallenge.stake_deposited_wei) !== challengeStake) {
  throw new Error("Finalized GenLayer challenge does not bind the exact Base funding receipt, challenger, and stake");
}
results.genlayer.challenge = { id: challengeId, openTx: challengeOpened?.txHash ?? process.env.RECALLRAID_E2E_OPEN_CHALLENGE_TX ?? null, challenger: challenger.address, stakeBaseUnits: challengeStake.toString(), reason };
checkpoint("genlayer-challenge-open");

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
    "Official CPSC re-announcement concerning the Fisher-Price Rock 'n Play recall and continuing infant fatalities.",
  ]);
  challengeEvidenceId = Number(challengeEvidence.result?.evidence_id);
  if (!Number.isInteger(challengeEvidenceId)) throw new Error("Could not decode regulator rebuttal evidence id");
  results.genlayer.challengeEvidence = { id: challengeEvidenceId, url: officialRecallUrl, sha256: official.hash, byteLength: official.bytes, addTx: challengeEvidence.txHash, verifyTx: null, reachable: false, hashVerified: false };
  checkpoint("challenge-evidence-added");
  challengeVerification = await glWrite(challengerClient, "verify_evidence", [challengeEvidenceId]);
} else if (!existingChallengeEvidenceId.content_hash_verified || !existingChallengeEvidenceId.url_reachable) {
  challengeVerification = await glWrite(challengerClient, "verify_evidence", [challengeEvidenceId]);
}
if (challengeVerification && (!challengeVerification.result?.url_reachable || !challengeVerification.result?.content_hash_verified)) {
  throw new Error("Official CPSC rebuttal did not pass GenLayer URL/hash verification");
}
if (challengeVerification?.txHash) {
  const cachedEvidence = await apiGet(`/evidence?investigation_id=${investigationId}`);
  const challengeEvidenceCached = cachedEvidence.some((item) => item.id === challengeEvidenceId
    && item.content_hash_verified && item.url_reachable);
  if (!challengeEvidenceCached) await apiPostBestEffort(`/evidence/${investigationId}/sync`, { txHash: challengeVerification.txHash }, challengerCookie);
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
checkpoint("challenge-evidence-verified");

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
if (resolved?.txHash) await apiPostBestEffort(`/challenges/${challengeId}/sync`, { txHash: resolved.txHash }, challengerCookie);
if (resolved?.txHash) await apiPostBestEffort(`/investigations/${investigationId}/sync`, { txHash: resolved.txHash }, submitterCookie);
checkpoint("challenge-resolution-finalized");

const challengeDeposit = await escrow.getChallengeDeposit(executionCaseId, challenger.address);
if (challengeDeposit.amount !== challengeStake) throw new Error("Base escrow does not retain the exact challenger stake for this wallet");
const currentEscrow = await escrow.getCase(executionCaseId);
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
  startedAt: reportStartedAt,
  completedAt: new Date().toISOString(),
  progress: { stage: "settlement-wait", complete: false },
  networks: { genlayer: "StudioNet/61999", base: "Base Sepolia/84532" },
  contracts: { genlayer: genlayerAddress, escrow: escrowAddress, usdc: usdcAddress },
  wallets: { submitter: submitter.address, challenger: challenger.address },
  case: { caseId: executionCaseId, investigationId, bountyUsdcBaseUnits: bounty.toString(), baseFundingTx: results.base.bountyFundingTx },
  ...(reportPause ? { pause: reportPause } : {}),
  ...results,
};
writeFileSync(resolve(reportPath), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
