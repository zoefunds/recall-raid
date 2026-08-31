#!/usr/bin/env node
// Resumes two_product_showcase_v2.mjs after a transient client-side SSL
// fetch failure (network blip, not a contract/consensus error) interrupted
// it right after cancel_investigation succeeded cleanly. Picks up exactly
// where it left off: seller bond 2 lifecycle, withdraw() for both roles,
// and the final view-method sweep. Same wallets, same contract, same
// investigation IDs (1, 2, 3 already created in the interrupted run).
//
// Run: node scripts/two_product_showcase_v2_resume.mjs

import { createClient, createAccount } from "genlayer-js";
import { studionet } from "genlayer-js/chains";

const CONTRACT_ADDRESS = "0x4aB01fb5435cdEfD3c651Cfc51f0F1fa1E2Ef6a4";
const RPC_URL = "https://studio.genlayer.com/api";
const API_BASE = "https://recallraid-api.fly.dev";

const WALLETS = {
  hunter: "0x63028d88026d5bd4fafbacc46546bb1d85ac4d9fff21596c147430534035a314",
  challenger: "0x8129e32076de8fadd83a71bc02504644bb9871029afbbc3c452dea8954ab5ef2",
  seller: "0xcaac0f431d3577c8cb42ae1c0303e0fbd8d7a80598abd05c0b5113686efd35f9",
};

const results = [];
function record(method, kind, ok, detail) {
  results.push({ method, kind, ok, detail });
  console.log(`${ok ? "✓" : "✗"} [${kind}] ${method} — ${detail}`);
  if (!ok) process.exitCode = 1;
}
function section(title) {
  console.log("\n" + "=".repeat(8) + " " + title + " " + "=".repeat(8));
}

function makeClient(privateKey) {
  const account = createAccount(privateKey);
  const client = createClient({ chain: { ...studionet, rpcUrls: { default: { http: [RPC_URL] } } }, account });
  return { address: account.address, client };
}

function decodeLeaderResult(leaderReceipt) {
  const payload = leaderReceipt?.result?.payload;
  if (!payload) return undefined;
  if (typeof payload === "string") return payload;
  if (typeof payload.readable !== "string") return undefined;
  try {
    const once = JSON.parse(payload.readable);
    if (typeof once === "string") {
      try { return JSON.parse(once); } catch { return once; }
    }
    return once;
  } catch {
    return payload.readable;
  }
}

async function write(client, functionName, args = [], value = 0n) {
  const txHash = await client.writeContract({ address: CONTRACT_ADDRESS, functionName, args, value });
  const receipt = await client.waitForTransactionReceipt({ hash: txHash, status: "FINALIZED", retries: 120, interval: 5000 });
  const nodeReceipts = receipt.consensus_data?.leader_receipt ?? [];
  const leader = nodeReceipts.find((r) => r.mode === "leader") ?? nodeReceipts[0];
  const leaderErrored = !!(leader?.execution_result && leader.execution_result !== "SUCCESS" && leader.execution_result !== "NONE");
  const consensusHealthy = ["", "AGREE", "MAJORITY_AGREE"].includes(receipt.result_name ?? "");
  const parsedResult = decodeLeaderResult(leader);
  return {
    txHash, parsedResult, leaderErrored, consensusHealthy,
    resultName: receipt.result_name,
    errorDetail: leaderErrored ? (leader?.result?.status === "rollback" ? leader.result.payload : leader?.genvm_result?.stderr) : undefined,
  };
}

async function read(client, functionName, args = []) {
  const raw = await client.readContract({ address: CONTRACT_ADDRESS, functionName, args });
  if (typeof raw === "string") {
    try { return JSON.parse(raw); } catch { return raw; }
  }
  return raw;
}

const cookieJars = {};
async function apiCall(role, path, opts = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    ...opts,
    headers: { "Content-Type": "application/json", ...(cookieJars[role] ? { Cookie: cookieJars[role] } : {}), ...(opts.headers || {}) },
  });
  const setCookie = res.headers.get("set-cookie");
  if (setCookie) cookieJars[role] = setCookie.split(";")[0];
  const text = await res.text();
  let body;
  try { body = JSON.parse(text); } catch { body = text; }
  if (!res.ok) throw new Error(`${path} -> HTTP ${res.status}: ${JSON.stringify(body)}`);
  return body;
}
async function authenticate(role, address, client) {
  const { message } = await apiCall(role, "/auth/nonce", { method: "POST", body: JSON.stringify({ address }) });
  const signature = await client.account.signMessage({ message });
  await apiCall(role, "/auth/verify", { method: "POST", body: JSON.stringify({ address, signature }) });
}

async function main() {
  const hunter = makeClient(WALLETS.hunter);
  const challenger = makeClient(WALLETS.challenger);
  const seller = makeClient(WALLETS.seller);
  console.log("hunter:", hunter.address);
  console.log("challenger:", challenger.address);
  console.log("seller:", seller.address);
  console.log("contract:", CONTRACT_ADDRESS);

  await authenticate("hunter", hunter.address, hunter.client);
  await authenticate("seller", seller.address, seller.client);

  section("Seller bond lifecycle — bond 2 (topup + withdraw, fully unlinked)");
  const bond2Res = await write(seller.client, "create_seller_bond", [], 1n * 10n ** 16n);
  record("create_seller_bond (bond 2)", "write", (!bond2Res.leaderErrored && bond2Res.consensusHealthy), `tx=${bond2Res.txHash} parsed=${JSON.stringify(bond2Res.parsedResult)}`);
  const bond2Id = bond2Res.parsedResult?.bond_id;
  const topupRes = await write(seller.client, "topup_seller_bond", [bond2Id], 5n * 10n ** 15n);
  record("topup_seller_bond (bond 2)", "write", (!topupRes.leaderErrored && topupRes.consensusHealthy), `tx=${topupRes.txHash} result=${topupRes.resultName}`);
  const bond2Before = await read(seller.client, "get_seller_bond", [bond2Id]);
  record("get_seller_bond (bond 2, pre-withdraw)", "view", true, JSON.stringify(bond2Before));
  const withdrawBond2Res = await write(seller.client, "withdraw_seller_bond", [bond2Id]);
  record("withdraw_seller_bond (bond 2)", "write", (!withdrawBond2Res.leaderErrored && withdrawBond2Res.consensusHealthy), `tx=${withdrawBond2Res.txHash} result=${withdrawBond2Res.resultName}`);

  section("withdraw() — pull real GEN for hunter and seller");
  const hunterBalance = await read(hunter.client, "get_balance", [hunter.address]);
  record("get_balance (hunter, pre-withdraw)", "view", true, String(hunterBalance));
  if (BigInt(hunterBalance) > 0n) {
    const hunterWithdraw = await write(hunter.client, "withdraw", [BigInt(hunterBalance)]);
    record("withdraw (hunter)", "write", (!hunterWithdraw.leaderErrored && hunterWithdraw.consensusHealthy), `tx=${hunterWithdraw.txHash} result=${hunterWithdraw.resultName}`);
  } else {
    console.log("(hunter balance is 0; skipping withdraw.)");
  }
  const sellerBalance = await read(seller.client, "get_balance", [seller.address]);
  record("get_balance (seller, pre-withdraw)", "view", true, String(sellerBalance));
  if (BigInt(sellerBalance) > 0n) {
    const sellerWithdraw = await write(seller.client, "withdraw", [BigInt(sellerBalance)]);
    record("withdraw (seller)", "write", (!sellerWithdraw.leaderErrored && sellerWithdraw.consensusHealthy), `tx=${sellerWithdraw.txHash} result=${sellerWithdraw.resultName}`);
  } else {
    console.log("(seller balance is 0; skipping withdraw.)");
  }

  section("Full view-method sweep");
  const countAfter = await read(hunter.client, "get_investigation_count");
  record("get_investigation_count", "view", true, String(countAfter));
  const idAt0 = await read(hunter.client, "get_investigation_id_at", [0]);
  record("get_investigation_id_at(0)", "view", true, String(idAt0));
  const list = await read(hunter.client, "list_investigations", [0, 10]);
  record("list_investigations(0,10)", "view", true, `total=${list.total} items=${list.items.length}`);
  const bondCount = await read(hunter.client, "get_seller_bond_count");
  record("get_seller_bond_count", "view", true, String(bondCount));
  const hunterRepFinal = await read(hunter.client, "get_reputation", [hunter.address]);
  record("get_reputation (hunter, final)", "view", true, JSON.stringify(hunterRepFinal));
  const challengerRepFinal = await read(challenger.client, "get_reputation", [challenger.address]);
  record("get_reputation (challenger, final)", "view", true, JSON.stringify(challengerRepFinal));
  const protocolInfoFinal = await read(hunter.client, "get_protocol_info");
  record("get_protocol_info (final)", "view", true, JSON.stringify(protocolInfoFinal));

  section("Final live API sync + shape verification");
  await apiCall("hunter", `/investigations/1/sync`, { method: "POST", body: JSON.stringify({}) });
  await apiCall("hunter", `/investigations/2/sync`, { method: "POST", body: JSON.stringify({}) });
  await apiCall("hunter", `/investigations/3/sync`, { method: "POST", body: JSON.stringify({}) });
  const apiList = await apiCall("hunter", "/investigations");
  record("GET /investigations (live API)", "api", true, `total=${apiList.total}`);
  const apiStats = await apiCall("hunter", "/stats");
  record("GET /stats (live API)", "api", true, JSON.stringify(apiStats));

  section("SUMMARY");
  const total = results.length;
  const passed = results.filter((r) => r.ok).length;
  console.log(`${total} checks run, ${passed} passed, ${total - passed} failed.`);
  if (total !== passed) {
    console.log("\nFAILED CHECKS:");
    for (const r of results.filter((r) => !r.ok)) console.log(`  ✗ [${r.kind}] ${r.method} — ${r.detail}`);
  }
}

main().catch((err) => {
  console.error("SCRIPT ERROR:", err);
  process.exitCode = 1;
});
