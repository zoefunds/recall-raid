#!/usr/bin/env node
// Two additional real-product investigations, entirely different from the
// original four-product showcase, submitted specifically to replace the
// black 1x1-test-pixel photos with real, visible generated images (see
// memory.md — scripts/lib/make_product_image.mjs is the fix). Same
// discipline as the original showcase: every call here is a genuine
// happy-path call, no negative/expect-revert calls, real verifiably-real
// product/recall data (checked against live cpsc.gov pages before use).
//
// Run: node scripts/two_more_products.mjs

import { createClient, createAccount } from "genlayer-js";
import { studionet } from "genlayer-js/chains";
import { createHash } from "node:crypto";
import { makeProductImage } from "./lib/make_product_image.mjs";

const CONTRACT_ADDRESS = "0xcb8081F71210EC19Db3E70b4A880CfcfEb9a9E27";
const RPC_URL = "https://studio.genlayer.com/api";
const API_BASE = "https://recallraid-api.fly.dev";
const WEB_BASE = "https://recall-raid.vercel.app";

const WALLETS = {
  hunter: "0x63028d88026d5bd4fafbacc46546bb1d85ac4d9fff21596c147430534035a314",
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
  // Allowlist, not excludelist — a previous run's excludelist missed
  // NO_MAJORITY and silently logged a non-agreement as a pass. See
  // memory.md.
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

function sha256(buf) { return createHash("sha256").update(buf).digest("hex"); }

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

async function uploadEvidencePhoto(role, investigationId, fileName, imageBuf) {
  const upload = await apiCall(role, "/evidence/upload-url", {
    method: "POST",
    body: JSON.stringify({ investigationId, contentType: "image/png", declaredSizeBytes: imageBuf.length, fileName }),
  });
  const form = new FormData();
  for (const [k, v] of Object.entries(upload.fields)) form.append(k, v);
  form.append("file", new Blob([imageBuf], { type: "image/png" }), fileName);
  const res = await fetch(upload.upload_url, { method: "POST", body: form });
  const json = await res.json();
  if (!res.ok || !json.secure_url) throw new Error("Cloudinary upload failed: " + JSON.stringify(json));
  return json.secure_url;
}

async function main() {
  const hunter = makeClient(WALLETS.hunter);
  console.log("hunter:", hunter.address);
  console.log("contract:", CONTRACT_ADDRESS);

  section("Wallet auth");
  await authenticate("hunter", hunter.address, hunter.client);
  record("auth (hunter)", "auth", true, "session established");

  const investigationIds = {};

  // =====================================================================
  // PRODUCT 5 — Boppy Original Newborn Lounger (real, CPSC-recalled
  // September 2021 after 8 infant suffocation deaths).
  // =====================================================================
  section("PRODUCT 5 — Boppy Original Newborn Lounger (real CPSC recall)");
  const boppyImage = makeProductImage({ seed: [120, 150, 90] }); // sage green, distinct from all prior products
  const bounty5 = 3n * 10n ** 16n;
  const sub5 = await write(hunter.client, "submit_investigation", [
    "Original Newborn Lounger (TEST ENTRY — real product, CPSC recall Sept 2021)",
    "Boppy",
    "Original Newborn Lounger",
    "",
    "TestMarketplace",
    `${WEB_BASE}/demo-listing/5?code=product5-marketplace-listing`,
    "https://www.boppy.com",
    "https://www.cpsc.gov/Recalls/2021/The-Boppy-Company-Recalls-Over-3-Million-Original-Newborn-Loungers-Boppy-Preferred-Newborn-Loungers-and-Pottery-Barn-Kids-Boppy-Newborn-Loungers-After-8-Infant-Deaths-Suffocation-Risk",
    "TEST DATA — real recalled product. CPSC and The Boppy Company recalled over 3 million Original Newborn Loungers, Preferred Newborn Loungers, and Pottery Barn Kids Boppy Newborn Loungers in September 2021 after 8 infant deaths from suffocation (with 2 additional deaths reported shortly after the recall). Infants suffocated after being placed on the lounger to sleep and rolling to their side or stomach. This listing represents a hypothetical marketplace reseller still offering the recalled unit.",
    "Infant/Nursery",
    1,
  ], bounty5);
  record("submit_investigation (product 5)", "write", (!sub5.leaderErrored && sub5.consensusHealthy), `tx=${sub5.txHash} result=${sub5.resultName} parsed=${JSON.stringify(sub5.parsedResult)}`);
  const inv5Id = sub5.parsedResult?.investigation_id;
  investigationIds.boppy = inv5Id;

  const photo5Url = await uploadEvidencePhoto("hunter", inv5Id, "boppy-lounger-listing-photo.png", boppyImage);
  record("Cloudinary upload (product 5 photo, real visible image)", "integration", true, photo5Url);
  const ev5a = await write(hunter.client, "add_evidence", [inv5Id, "product_photo", sha256(boppyImage), photo5Url, "Photo of the Boppy Original Newborn Lounger as listed, matching the recalled hourglass-shaped infant lounger design (TEST DATA)."]);
  record("add_evidence (product 5, photo)", "write", (!ev5a.leaderErrored && ev5a.consensusHealthy), `tx=${ev5a.txHash} result=${ev5a.resultName}`);
  const recallHash5 = sha256(Buffer.from("cpsc-boppy-newborn-lounger-2021|reference"));
  const ev5b = await write(hunter.client, "add_evidence", [inv5Id, "recall_notice", recallHash5, "https://www.cpsc.gov/Recalls/2021/The-Boppy-Company-Recalls-Over-3-Million-Original-Newborn-Loungers-Boppy-Preferred-Newborn-Loungers-and-Pottery-Barn-Kids-Boppy-Newborn-Loungers-After-8-Infant-Deaths-Suffocation-Risk", "CPSC recall notice confirming the September 2021 Boppy Newborn Lounger recall due to infant suffocation deaths (TEST DATA, real recall)."]);
  record("add_evidence (product 5, recall reference)", "write", (!ev5b.leaderErrored && ev5b.consensusHealthy), `tx=${ev5b.txHash} result=${ev5b.resultName}`);

  await apiCall("hunter", `/evidence/${inv5Id}/sync`, { method: "POST", body: JSON.stringify({ txHash: ev5b.txHash }) });
  await apiCall("hunter", `/investigations/${inv5Id}/sync`, { method: "POST", body: JSON.stringify({}) });

  let verdict5 = await write(hunter.client, "request_verdict", [inv5Id]);
  record("request_verdict (product 5)", "write", (!verdict5.leaderErrored && verdict5.consensusHealthy), `tx=${verdict5.txHash} result=${verdict5.resultName} parsed=${JSON.stringify(verdict5.parsedResult)}`);
  // If consensus wasn't reached, the investigation stays in its prior
  // state untouched (no partial commit) — a plain retry is legitimate,
  // not a forced/guaranteed-reject call. See memory.md.
  while (!verdict5.consensusHealthy || verdict5.leaderErrored) {
    console.log("  retrying request_verdict (product 5) — prior attempt did not reach clean agreement, investigation state unaffected...");
    verdict5 = await write(hunter.client, "request_verdict", [inv5Id]);
    record("request_verdict (product 5, retry)", "write", (!verdict5.leaderErrored && verdict5.consensusHealthy), `tx=${verdict5.txHash} result=${verdict5.resultName} parsed=${JSON.stringify(verdict5.parsedResult)}`);
  }
  await apiCall("hunter", `/investigations/${inv5Id}/sync`, { method: "POST", body: JSON.stringify({}) });
  const inv5After = await read(hunter.client, "get_investigation", [inv5Id]);
  record("get_investigation (product 5, post-verdict)", "view", true, JSON.stringify(inv5After));

  // =====================================================================
  // PRODUCT 6 — Jetson Rogue 42-Volt Hoverboard (real, CPSC-recalled
  // 2023 after two deaths from a house fire caused by the battery).
  // =====================================================================
  section("PRODUCT 6 — Jetson Rogue 42-Volt Hoverboard (real CPSC recall)");
  const jetsonImage = makeProductImage({ seed: [210, 170, 40] }); // amber/gold, distinct from all prior products
  const bounty6 = 3n * 10n ** 16n;
  const sub6 = await write(hunter.client, "submit_investigation", [
    "Rogue 42-Volt Self-Balancing Scooter/Hoverboard (TEST ENTRY — real product, CPSC recall 2023)",
    "Jetson",
    "Rogue 42-Volt",
    "",
    "TestMarketplace",
    `${WEB_BASE}/demo-listing/6?code=product6-marketplace-listing`,
    "https://ridejetson.com",
    "https://www.cpsc.gov/Recalls/2023/Jetson-Electric-Bikes-Recalls-42-Volt-Rogue-Self-Balancing-Scooters-Hoverboards-Due-to-Fire-Hazard-Two-Deaths-Reported",
    "TEST DATA — real recalled product. CPSC and Jetson Electric Bikes recalled the 42-Volt Rogue self-balancing scooter/hoverboard in 2023 after its lithium-ion battery pack was linked to a house fire that killed two children (ages 10 and 15) in Hellertown, Pennsylvania. This listing represents a hypothetical marketplace reseller still offering the recalled unit.",
    "Electronics",
    1,
  ], bounty6);
  record("submit_investigation (product 6)", "write", (!sub6.leaderErrored && sub6.consensusHealthy), `tx=${sub6.txHash} result=${sub6.resultName} parsed=${JSON.stringify(sub6.parsedResult)}`);
  const inv6Id = sub6.parsedResult?.investigation_id;
  investigationIds.jetsonHoverboard = inv6Id;

  const photo6Url = await uploadEvidencePhoto("hunter", inv6Id, "jetson-hoverboard-listing-photo.png", jetsonImage);
  record("Cloudinary upload (product 6 photo, real visible image)", "integration", true, photo6Url);
  const ev6a = await write(hunter.client, "add_evidence", [inv6Id, "product_photo", sha256(jetsonImage), photo6Url, "Photo of the Jetson Rogue 42-Volt hoverboard as listed, matching the recalled model's branding (TEST DATA)."]);
  record("add_evidence (product 6, photo)", "write", (!ev6a.leaderErrored && ev6a.consensusHealthy), `tx=${ev6a.txHash} result=${ev6a.resultName}`);
  const recallHash6 = sha256(Buffer.from("cpsc-jetson-rogue-hoverboard-2023|reference"));
  const ev6b = await write(hunter.client, "add_evidence", [inv6Id, "recall_notice", recallHash6, "https://www.cpsc.gov/Recalls/2023/Jetson-Electric-Bikes-Recalls-42-Volt-Rogue-Self-Balancing-Scooters-Hoverboards-Due-to-Fire-Hazard-Two-Deaths-Reported", "CPSC recall notice confirming the Jetson Rogue 42-Volt hoverboard recall due to fire hazard and two deaths (TEST DATA, real recall)."]);
  record("add_evidence (product 6, recall reference)", "write", (!ev6b.leaderErrored && ev6b.consensusHealthy), `tx=${ev6b.txHash} result=${ev6b.resultName}`);

  await apiCall("hunter", `/evidence/${inv6Id}/sync`, { method: "POST", body: JSON.stringify({ txHash: ev6b.txHash }) });
  await apiCall("hunter", `/investigations/${inv6Id}/sync`, { method: "POST", body: JSON.stringify({}) });

  let verdict6 = await write(hunter.client, "request_verdict", [inv6Id]);
  record("request_verdict (product 6)", "write", (!verdict6.leaderErrored && verdict6.consensusHealthy), `tx=${verdict6.txHash} result=${verdict6.resultName} parsed=${JSON.stringify(verdict6.parsedResult)}`);
  while (!verdict6.consensusHealthy || verdict6.leaderErrored) {
    console.log("  retrying request_verdict (product 6) — prior attempt did not reach clean agreement, investigation state unaffected...");
    verdict6 = await write(hunter.client, "request_verdict", [inv6Id]);
    record("request_verdict (product 6, retry)", "write", (!verdict6.leaderErrored && verdict6.consensusHealthy), `tx=${verdict6.txHash} result=${verdict6.resultName} parsed=${JSON.stringify(verdict6.parsedResult)}`);
  }
  await apiCall("hunter", `/investigations/${inv6Id}/sync`, { method: "POST", body: JSON.stringify({}) });
  const inv6After = await read(hunter.client, "get_investigation", [inv6Id]);
  record("get_investigation (product 6, post-verdict)", "view", true, JSON.stringify(inv6After));

  section("Full view-method sweep");
  const countAfter = await read(hunter.client, "get_investigation_count");
  record("get_investigation_count", "view", true, String(countAfter));
  for (const [name, id] of Object.entries(investigationIds)) {
    const evIds = await read(hunter.client, "get_evidence_ids_for_investigation", [id]);
    record(`get_evidence_ids_for_investigation (${name})`, "view", true, JSON.stringify(evIds));
  }

  section("Final live API sync + shape verification");
  const apiList = await apiCall("hunter", "/investigations");
  record("GET /investigations (live API)", "api", true, `total=${apiList.total}`);

  section("SUMMARY");
  const total = results.length;
  const passed = results.filter((r) => r.ok).length;
  console.log(`${total} checks run, ${passed} passed, ${total - passed} failed.`);
  if (total !== passed) {
    console.log("\nFAILED CHECKS:");
    for (const r of results.filter((r) => !r.ok)) console.log(`  ✗ [${r.kind}] ${r.method} — ${r.detail}`);
  }
  console.log("\nInvestigation IDs:", JSON.stringify(investigationIds));
}

main().catch((err) => {
  console.error("SCRIPT ERROR:", err);
  process.exitCode = 1;
});
