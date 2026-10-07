#!/usr/bin/env node
import { createHash } from "node:crypto";
import { ethers } from "ethers";
import { createAccount, createClient } from "genlayer-js";
import { studionet } from "genlayer-js/chains";

const key = process.env.DEPLOYER_PRIVATE_KEY;
if (!key) throw new Error("DEPLOYER_PRIVATE_KEY is required");
const genlayerAddress = process.env.GENLAYER_CONTRACT_ADDRESS;
if (!genlayerAddress) throw new Error("GENLAYER_CONTRACT_ADDRESS is required");
const escrowAddress = process.env.RECALLRAID_ESCROW_ADDRESS;
if (!escrowAddress) throw new Error("RECALLRAID_ESCROW_ADDRESS is required");
const usdcAddress = process.env.BASE_SEPOLIA_USDC_ADDRESS || "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
const baseRpc = process.env.BASE_SEPOLIA_RPC_URL || "https://sepolia.base.org";
const genlayerRpc = process.env.GENLAYER_RPC_URL || "https://studio.genlayer.com/api";

const provider = new ethers.JsonRpcProvider(baseRpc);
const wallet = new ethers.Wallet(key, provider);
const usdc = new ethers.Contract(usdcAddress, [
  "function approve(address,uint256) returns (bool)",
  "function balanceOf(address) view returns (uint256)",
], wallet);
const escrow = new ethers.Contract(escrowAddress, [
  "function fundInvestigation(bytes32,uint256)",
  "function relayAdjudication(bytes32,uint8,address,bool,bytes32)",
  "function claim()",
  "function claimable(address) view returns (uint256)",
  "function getCase(bytes32) view returns ((address submitter,address challenger,address hunter,bytes32 sellerBondId,uint256 bounty,uint256 challengeStake,uint8 verdict,bool finalized,bytes32 genlayerDecisionHash))",
], wallet);
const glClient = createClient({
  chain: { ...studionet, rpcUrls: { default: { http: [genlayerRpc] } } },
  account: createAccount(key),
});

const fixtures = [
  {
    title: "Fisher-Price Rock 'n Play Sleeper listing re-check",
    slug: "fisher-price-rock-n-play", productName: "Fisher-Price Rock 'n Play Sleeper", brand: "Fisher-Price",
    model: "Rock 'n Play Sleeper", marketplace: "Independent resale listing", category: "Baby products",
    bounty: 500_000n, evidenceUrl: "https://recall-raid.vercel.app/e2e-evidence/fisher-price-rock-n-play",
    description: "Check a resale listing against the documented infant-safety recall and product identifiers.",
  },
  {
    title: "Peloton Tread+ recall-confirmed listing",
    slug: "peloton-tread-plus", productName: "Peloton Tread+ Treadmill", brand: "Peloton",
    model: "TR01", marketplace: "Second-hand fitness listing", category: "Fitness equipment",
    bounty: 750_000n, evidenceUrl: "https://recall-raid.vercel.app/e2e-evidence/peloton-tread-plus",
    description: "Evaluate a second-hand Tread+ listing against the documented pull-under hazard and recall details.",
  },
  {
    title: "Anker 535 Power Bank safety listing",
    slug: "anker-535-power-bank", productName: "Anker 535 Power Bank (PowerCore 20K)", brand: "Anker",
    model: "A1366", marketplace: "Consumer electronics marketplace", category: "Electronics",
    bounty: 600_000n, evidenceUrl: "https://recall-raid.vercel.app/e2e-evidence/anker-535-power-bank?v=2",
    description: "Assess the identified power-bank model against submitted lithium-ion battery safety evidence.",
  },
];

function decodeResult(receipt) {
  const receipts = receipt?.consensus_data?.leader_receipt ?? [];
  const leader = receipts.find((item) => item?.mode === "leader") ?? receipts[0];
  const payload = leader?.result?.payload;
  if (typeof payload === "string") return payload;
  const readable = payload?.readable;
  if (typeof readable !== "string") return undefined;
  try {
    const once = JSON.parse(readable);
    if (typeof once === "string") { try { return JSON.parse(once); } catch { return once; } }
    return once;
  } catch { return readable; }
}

async function glWrite(functionName, args) {
  const txHash = await glClient.writeContract({ address: genlayerAddress, functionName, args });
  console.error(`GenLayer ${functionName}: ${txHash}`);
  const receipt = await glClient.waitForTransactionReceipt({ hash: txHash, status: "FINALIZED", retries: 180, interval: 5000 });
  const resultName = String(receipt.result_name ?? "").toUpperCase();
  if (resultName && resultName !== "AGREE" && resultName !== "MAJORITY_AGREE") throw new Error(`${functionName} failed consensus: ${resultName}`);
  return { txHash, result: decodeResult(receipt) };
}

async function glRead(functionName, args) {
  const raw = await glClient.readContract({ address: genlayerAddress, functionName, args });
  return typeof raw === "string" ? JSON.parse(raw) : raw;
}

async function baseConfirmed(txPromise) {
  const tx = await txPromise;
  console.error(`Base transaction: ${tx.hash}`);
  const receipt = await tx.wait(2);
  if (!receipt || receipt.status !== 1) throw new Error(`Base transaction failed: ${tx.hash}`);
  return tx.hash;
}

async function fundCase(caseId, amount) {
  return {
    approvalTx: await baseConfirmed(usdc.approve(escrowAddress, amount)),
    fundingTx: await baseConfirmed(escrow.fundInvestigation(caseId, amount)),
  };
}

const startedAt = new Date().toISOString();
const initialUsdc = await usdc.balanceOf(wallet.address);
const pending = [];
const requestedFixtureIndex = process.env.FIXTURE_INDEX === undefined ? null : Number(process.env.FIXTURE_INDEX);
const fixtureEntries = [...fixtures.entries()].filter(([index]) => requestedFixtureIndex === null || index === requestedFixtureIndex);
if (fixtureEntries.length === 0) throw new Error(`FIXTURE_INDEX must be between 0 and ${fixtures.length - 1}`);

for (const [index, item] of fixtureEntries) {
  const caseId = ethers.id(`recallraid:cross-chain-e2e:${startedAt}:${item.slug}`);
  const baseFunding = await fundCase(caseId, item.bounty);
  const response = await fetch(item.evidenceUrl);
  if (!response.ok) throw new Error(`Evidence fetch failed: ${item.evidenceUrl}`);
  const evidenceHash = createHash("sha256").update(new Uint8Array(await response.arrayBuffer())).digest("hex");
  const submitted = await glWrite("submit_investigation", [
    caseId, Number(item.bounty), item.productName, item.brand, item.model, `E2E-${index + 1}`,
    item.marketplace, item.evidenceUrl, "", "", item.description, item.category, 1,
  ]);
  const investigationId = Number(submitted.result?.investigation_id);
  if (!Number.isInteger(investigationId)) throw new Error(`Could not decode investigation id from ${submitted.txHash}`);
  const added = await glWrite("add_evidence", [investigationId, "recall_notice", evidenceHash, item.evidenceUrl, item.description]);
  const evidenceId = Number(added.result?.evidence_id);
  if (!Number.isInteger(evidenceId)) throw new Error(`Could not decode evidence id from ${added.txHash}`);
  const verified = await glWrite("verify_evidence", [evidenceId]);
  if (!verified.result?.url_reachable || !verified.result?.content_hash_verified) throw new Error(`GenLayer evidence verification failed for ${investigationId}`);
  const adjudicated = await glWrite("request_verdict", [investigationId]);
  const state = await glRead("get_investigation", [investigationId]);
  if (![1, 2, 3].includes(Number(state.verdict))) throw new Error(`Investigation ${investigationId} has non-relayable verdict ${state.verdict}`);
  pending.push({ index, item, caseId, baseFunding, evidenceHash, investigationId, evidenceId, submitted, added, verified, adjudicated, state });
}

const latestDeadline = Math.max(...pending.map(({ state }) => Number(state.challenge_deadline)));
const waitMs = Math.max(0, (latestDeadline + 3) * 1000 - Date.now());
if (waitMs > 0) {
  console.error(`Waiting ${Math.ceil(waitMs / 1000)}s for the real GenLayer challenge windows to close...`);
  await new Promise((resolve) => setTimeout(resolve, waitMs));
}

const output = [];
for (const test of pending) {
  const settled = await glWrite("settle_investigation", [test.investigationId]);
  const finalState = await glRead("get_investigation", [test.investigationId]);
  const relayTx = await baseConfirmed(escrow.relayAdjudication(test.caseId, Number(finalState.verdict), wallet.address, false, test.adjudicated.txHash));
  const claimableBeforeClaim = await escrow.claimable(wallet.address);
  const claimTx = await baseConfirmed(escrow.claim());
  const marked = await glWrite("mark_base_relayed", [test.investigationId, relayTx]);
  const baseState = await escrow.getCase(test.caseId);
  output.push({
    number: test.index + 1, title: test.item.title, productName: test.item.productName,
    description: test.item.description, bountyUsdcBaseUnits: test.item.bounty.toString(), caseId: test.caseId,
    investigationId: test.investigationId, evidenceId: test.evidenceId, evidenceUrl: test.item.evidenceUrl,
    evidenceSha256: test.evidenceHash, verdict: Number(finalState.verdict), confidenceBps: Number(finalState.ai_confidence_bps),
    genlayerTransactions: { submit: test.submitted.txHash, addEvidence: test.added.txHash, verifyEvidence: test.verified.txHash, adjudicate: test.adjudicated.txHash, settle: settled.txHash, markBaseRelayed: marked.txHash },
    baseTransactions: { approval: test.baseFunding.approvalTx, funding: test.baseFunding.fundingTx, relay: relayTx, claim: claimTx },
    claimableBeforeClaimUsdcBaseUnits: claimableBeforeClaim.toString(),
    verifiedBaseState: { finalized: baseState.finalized, verdict: Number(baseState.verdict), genlayerDecisionHash: baseState.genlayerDecisionHash },
  });
}

console.log(JSON.stringify({
  startedAt, completedAt: new Date().toISOString(), wallet: wallet.address,
  genlayer: { contractAddress: genlayerAddress }, baseSepolia: { chainId: 84532, escrowAddress, usdcAddress },
  initialWalletUsdcBaseUnits: initialUsdc.toString(), finalWalletUsdcBaseUnits: (await usdc.balanceOf(wallet.address)).toString(), cases: output,
}, null, 2));
