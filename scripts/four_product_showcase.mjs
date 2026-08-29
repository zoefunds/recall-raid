#!/usr/bin/env node
// Four real-product showcase run against a freshly deployed
// RecallRaid contract. Every call here is a genuine happy-path call —
// deliberately NO negative/expect-revert calls, since a guard-clause
// rejection shows up on the GenLayer explorer as an execution error even
// though it is contract-correct. This script exists specifically to
// leave a clean, error-free transaction history on the explorer while
// still exercising every non-admin, non-deadline-gated read and write
// method with real, detailed, verifiably-real product/recall data (not
// placeholder text).
//
// NOT exercised here (by design, not oversight): claim_evidence_timeout,
// claim_verdict_timeout, claim_challenge_timeout, settle_investigation —
// all four are gated by real elapsed time (3 days / 2 days / 2 days /
// 2 days respectively) and calling any of them before their deadline
// genuinely reverts. set_paused / transfer_administration are admin-only
// and explicitly out of scope per the request.
//
// Run: node scripts/four_product_showcase.mjs

import { createClient, createAccount } from "genlayer-js";
import { studionet } from "genlayer-js/chains";
import { createHash } from "node:crypto";
import { makeProductImage } from "./lib/make_product_image.mjs";

const CONTRACT_ADDRESS = "0xb2CB610EBbB773e2a6B9895CD49E3032C0722a70";
const RPC_URL = "https://studio.genlayer.com/api";
const API_BASE = "https://recallraid-api.fly.dev";
const WEB_BASE = "https://recall-raid.vercel.app";

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
  const client = createClient({
    chain: { ...studionet, rpcUrls: { default: { http: [RPC_URL] } } },
    account,
  });
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

function sha256(buf) { return createHash("sha256").update(buf).digest("hex"); }

// A real, visible generated photo per product — NOT a 1x1 test pixel.
// The first run of this script reused full_contract_test_suite.mjs's
// TEST_PNG fixture (a genuine 1x1 transparent pixel meant for
// regression-test speed, not visual display), which rendered as a solid
// black box once stretched to fill the evidence gallery's photo frame.
// See memory.md for the full story.
const PRODUCT_IMAGES = {
  rockNPlay: makeProductImage({ seed: [176, 58, 46] }),   // Fisher-Price red
  treadPlus: makeProductImage({ seed: [30, 30, 30] }),    // Peloton black
  malm: makeProductImage({ seed: [60, 110, 160] }),        // IKEA blue
};

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
  const challenger = makeClient(WALLETS.challenger);
  const seller = makeClient(WALLETS.seller);
  console.log("hunter:", hunter.address);
  console.log("challenger:", challenger.address);
  console.log("seller:", seller.address);
  console.log("contract:", CONTRACT_ADDRESS);

  section("Wallet auth for all three roles");
  await authenticate("hunter", hunter.address, hunter.client);
  record("auth (hunter)", "auth", true, "session established");
  await authenticate("challenger", challenger.address, challenger.client);
  record("auth (challenger)", "auth", true, "session established");
  await authenticate("seller", seller.address, seller.client);
  record("auth (seller)", "auth", true, "session established");

  section("Baseline reads");
  const protocolInfo = await read(hunter.client, "get_protocol_info");
  record("get_protocol_info", "view", true, JSON.stringify(protocolInfo));
  const hunterBalancePre = await read(hunter.client, "get_balance", [hunter.address]);
  record("get_balance (hunter, pre)", "view", true, String(hunterBalancePre));
  const hunterRepPre = await read(hunter.client, "get_reputation", [hunter.address]);
  record("get_reputation (hunter, pre)", "view", true, JSON.stringify(hunterRepPre));

  const investigationIds = {};

  // =====================================================================
  // PRODUCT 1 — Fisher-Price Rock 'n Play Sleeper (real, CPSC-recalled
  // 2019, reannounced 2023 — infant fatalities from rolling over
  // unrestrained). Full lifecycle: evidence, verdict, challenge, resolve.
  // =====================================================================
  section("PRODUCT 1 — Fisher-Price Rock 'n Play Sleeper (real CPSC recall)");
  const bounty1 = 5n * 10n ** 16n;
  const sub1 = await write(hunter.client, "submit_investigation", [
    "Rock 'n Play Sleeper (TEST ENTRY — real product, CPSC recall 2019/2023)",
    "Fisher-Price",
    "Rock 'n Play Sleeper",
    "",
    "TestMarketplace",
    `${WEB_BASE}/demo-listing/1?code=product1-marketplace-listing`,
    "https://www.fisher-price.com",
    "https://www.cpsc.gov/Recalls/2019/Fisher-Price-Recalls-Rock-n-Play-Sleepers-Due-to-Reports-of-Deaths",
    "TEST DATA — real recalled product used to demonstrate a genuine CPSC-confirmed infant-sleep hazard. CPSC and Fisher-Price recalled 4.7 million Rock 'n Play Sleepers in April 2019 after infant fatalities from rolling over while unrestrained; the recall was reannounced in 2023 after additional deaths were reported. This listing represents a hypothetical marketplace reseller still offering the recalled unit.",
    "Infant/Nursery",
    1,
  ], bounty1);
  record("submit_investigation (product 1)", "write", (!sub1.leaderErrored && sub1.consensusHealthy), `tx=${sub1.txHash} result=${sub1.resultName} parsed=${JSON.stringify(sub1.parsedResult)}`);
  const inv1Id = sub1.parsedResult?.investigation_id;
  investigationIds.rockNPlay = inv1Id;

  const photo1Url = await uploadEvidencePhoto("hunter", inv1Id, "rock-n-play-listing-photo.png", PRODUCT_IMAGES.rockNPlay);
  record("Cloudinary upload (product 1 photo)", "integration", true, photo1Url);
  const ev1a = await write(hunter.client, "add_evidence", [inv1Id, "product_photo", sha256(PRODUCT_IMAGES.rockNPlay), photo1Url, "Photo of the Rock 'n Play Sleeper as listed by the reseller, showing the original Fisher-Price branding and inclined sleeper design (TEST DATA)."]);
  record("add_evidence (product 1, photo)", "write", (!ev1a.leaderErrored && ev1a.consensusHealthy), `tx=${ev1a.txHash} result=${ev1a.resultName}`);
  const recallHash1 = sha256(Buffer.from("cpsc-rock-n-play-2019|reference"));
  const ev1b = await write(hunter.client, "add_evidence", [inv1Id, "recall_notice", recallHash1, "https://www.cpsc.gov/Recalls/2019/Fisher-Price-Recalls-Rock-n-Play-Sleepers-Due-to-Reports-of-Deaths", "CPSC recall notice confirming the April 2019 recall of 4.7 million Rock 'n Play Sleepers due to infant fatalities (TEST DATA, real recall)."]);
  record("add_evidence (product 1, recall reference)", "write", (!ev1b.leaderErrored && ev1b.consensusHealthy), `tx=${ev1b.txHash} result=${ev1b.resultName}`);

  await apiCall("hunter", `/evidence/${inv1Id}/sync`, { method: "POST", body: JSON.stringify({ txHash: ev1b.txHash }) });
  await apiCall("hunter", `/investigations/${inv1Id}/sync`, { method: "POST", body: JSON.stringify({}) });

  const verdict1 = await write(hunter.client, "request_verdict", [inv1Id]);
  record("request_verdict (product 1)", "write", (!verdict1.leaderErrored && verdict1.consensusHealthy), `tx=${verdict1.txHash} result=${verdict1.resultName} parsed=${JSON.stringify(verdict1.parsedResult)}`);
  await apiCall("hunter", `/investigations/${inv1Id}/sync`, { method: "POST", body: JSON.stringify({}) });
  const inv1AfterVerdict = await read(hunter.client, "get_investigation", [inv1Id]);
  record("get_investigation (product 1, post-verdict)", "view", true, JSON.stringify(inv1AfterVerdict));

  // Only open a real challenge if a verdict was actually reached — a
  // challenge against an investigation still awaiting a verdict would be
  // a rejected (error-producing) call, not a genuine dispute.
  if (Number(inv1AfterVerdict.status) === 3 /* VERDICT_REACHED */) {
    section("Challenge + resolve — product 1 (real dispute exercise)");
    const requiredStake1 = (BigInt(inv1AfterVerdict.bounty_wei) * 2000n) / 10000n;
    const challengeRes1 = await write(challenger.client, "open_challenge", [inv1Id, "TEST DATA — challenging this verdict to exercise the real dispute/resolution mechanism end-to-end on genuine CPSC-recall product data."], requiredStake1);
    record("open_challenge (product 1)", "write", (!challengeRes1.leaderErrored && challengeRes1.consensusHealthy), `tx=${challengeRes1.txHash} result=${challengeRes1.resultName} parsed=${JSON.stringify(challengeRes1.parsedResult)}`);
    const challengeId1 = challengeRes1.parsedResult?.challenge_id;
    if (challengeId1) {
      const resolveRes1 = await write(challenger.client, "resolve_challenge", [challengeId1]);
      record("resolve_challenge (product 1)", "write", (!resolveRes1.leaderErrored && resolveRes1.consensusHealthy), `tx=${resolveRes1.txHash} result=${resolveRes1.resultName} parsed=${JSON.stringify(resolveRes1.parsedResult)}`);
      await apiCall("hunter", `/challenges/${challengeId1}/sync`, { method: "POST", body: JSON.stringify({ txHash: resolveRes1.txHash }) });
      const challenge1After = await read(hunter.client, "get_challenge", [challengeId1]);
      record("get_challenge (product 1, post-resolution)", "view", true, JSON.stringify(challenge1After));
    }
  } else {
    console.log(`(Product 1 status=${inv1AfterVerdict.status} — verdict not yet reached, e.g. NEEDS_MORE_EVIDENCE; challenge flow skipped to avoid a guaranteed-reject open_challenge call. This is a valid outcome, not an error.)`);
  }

  // =====================================================================
  // PRODUCT 2 — Peloton Tread+ (real, CPSC-recalled May 2021 — one child
  // death, 70+ incidents of entrapment under the rear roller). Also
  // where the seller-bond ownership-verification flow gets exercised,
  // linked to this exact investigation's marketplace listing.
  // =====================================================================
  section("PRODUCT 2 — Peloton Tread+ (real CPSC recall) + seller bond");
  const bondRes = await write(seller.client, "create_seller_bond", [], 3n * 10n ** 16n);
  record("create_seller_bond (bond 1)", "write", (!bondRes.leaderErrored && bondRes.consensusHealthy), `tx=${bondRes.txHash} parsed=${JSON.stringify(bondRes.parsedResult)}`);
  const bond1Id = bondRes.parsedResult?.bond_id;
  const bond1Code = bondRes.parsedResult?.verification_code;
  const listingUrl2 = `${WEB_BASE}/demo-listing/${bond1Id}?code=${encodeURIComponent(bond1Code)}`;

  const listingCheck = await fetch(listingUrl2);
  const listingText = await listingCheck.text();
  record("GET demo-listing page contains bond's verification code", "integration", listingCheck.ok && listingText.includes(bond1Code), listingUrl2);

  const verifyRes = await write(seller.client, "verify_seller_bond_listing", [bond1Id, listingUrl2]);
  record("verify_seller_bond_listing (bond 1, real code match)", "write", (!verifyRes.leaderErrored && verifyRes.consensusHealthy), `tx=${verifyRes.txHash} result=${verifyRes.resultName}`);
  const bond1AfterVerify = await read(seller.client, "get_seller_bond", [bond1Id]);
  record("get_seller_bond (bond 1, post-verify)", "view", true, JSON.stringify(bond1AfterVerify));

  const bounty2 = 6n * 10n ** 16n;
  const sub2 = await write(hunter.client, "submit_investigation", [
    "Tread+ Treadmill (TEST ENTRY — real product, CPSC recall May 2021)",
    "Peloton",
    "Tread+",
    "",
    "TestMarketplace",
    listingUrl2,
    "https://www.onepeloton.com",
    "https://www.cpsc.gov/Recalls/2021/Peloton-Recalls-Tread-Plus-Treadmills-After-One-Child-Died-and-More-than-70-Incidents-Reported",
    "TEST DATA — real recalled product. CPSC and Peloton recalled the Tread+ in May 2021 after a child died and more than 70 incidents were reported of people, pets, or objects being pulled underneath the rear roller. Peloton later paid a $19,065,000 civil penalty for failing to promptly report the hazard. This listing represents a hypothetical marketplace reseller still offering the recalled unit, with the seller having posted a Clean Inventory Bond and verified ownership of this exact listing.",
    "Fitness Equipment",
    1,
  ], bounty2);
  record("submit_investigation (product 2)", "write", (!sub2.leaderErrored && sub2.consensusHealthy), `tx=${sub2.txHash} result=${sub2.resultName} parsed=${JSON.stringify(sub2.parsedResult)}`);
  const inv2Id = sub2.parsedResult?.investigation_id;
  investigationIds.treadPlus = inv2Id;

  const linkRes = await write(seller.client, "link_seller_bond", [inv2Id, bond1Id]);
  record("link_seller_bond (bond 1 -> product 2, verified + matching listing)", "write", (!linkRes.leaderErrored && linkRes.consensusHealthy), `tx=${linkRes.txHash} result=${linkRes.resultName}`);

  const photo2Url = await uploadEvidencePhoto("hunter", inv2Id, "tread-plus-listing-photo.png", PRODUCT_IMAGES.treadPlus);
  record("Cloudinary upload (product 2 photo)", "integration", true, photo2Url);
  const ev2a = await write(hunter.client, "add_evidence", [inv2Id, "product_photo", sha256(PRODUCT_IMAGES.treadPlus), photo2Url, "Photo of the Tread+ unit as listed, showing the rear roller area referenced in the CPSC recall notice (TEST DATA)."]);
  record("add_evidence (product 2, photo)", "write", (!ev2a.leaderErrored && ev2a.consensusHealthy), `tx=${ev2a.txHash} result=${ev2a.resultName}`);
  const recallHash2 = sha256(Buffer.from("cpsc-peloton-tread-plus-2021|reference"));
  const ev2b = await write(hunter.client, "add_evidence", [inv2Id, "recall_notice", recallHash2, "https://www.cpsc.gov/Recalls/2021/Peloton-Recalls-Tread-Plus-Treadmills-After-One-Child-Died-and-More-than-70-Incidents-Reported", "CPSC recall notice confirming the May 2021 Tread+ recall due to entrapment hazard (TEST DATA, real recall)."]);
  record("add_evidence (product 2, recall reference)", "write", (!ev2b.leaderErrored && ev2b.consensusHealthy), `tx=${ev2b.txHash} result=${ev2b.resultName}`);

  await apiCall("hunter", `/evidence/${inv2Id}/sync`, { method: "POST", body: JSON.stringify({ txHash: ev2b.txHash }) });
  await apiCall("hunter", `/investigations/${inv2Id}/sync`, { method: "POST", body: JSON.stringify({}) });

  const verdict2 = await write(hunter.client, "request_verdict", [inv2Id]);
  record("request_verdict (product 2)", "write", (!verdict2.leaderErrored && verdict2.consensusHealthy), `tx=${verdict2.txHash} result=${verdict2.resultName} parsed=${JSON.stringify(verdict2.parsedResult)}`);
  await apiCall("hunter", `/investigations/${inv2Id}/sync`, { method: "POST", body: JSON.stringify({}) });
  const inv2After = await read(hunter.client, "get_investigation", [inv2Id]);
  record("get_investigation (product 2, post-verdict)", "view", true, JSON.stringify(inv2After));

  // =====================================================================
  // PRODUCT 3 — IKEA MALM chest/dresser (real, CPSC-recalled 2016,
  // reannounced 2018 — tip-over hazard, 8 child fatalities). Straight
  // submit -> evidence -> verdict, no challenge, for a clean contrast.
  // =====================================================================
  section("PRODUCT 3 — IKEA MALM Dresser (real CPSC recall)");
  const bounty3 = 4n * 10n ** 16n;
  const sub3 = await write(hunter.client, "submit_investigation", [
    "MALM 6-Drawer Chest (TEST ENTRY — real product, CPSC recall 2016/2018)",
    "IKEA",
    "MALM",
    "",
    "TestMarketplace",
    `${WEB_BASE}/demo-listing/3?code=product3-marketplace-listing`,
    "https://www.ikea.com",
    "https://www.cpsc.gov/Recalls/2018/IKEA-Reannounces-Recall-of-MALM-and-Other-Models-of-Chests-and-Dressers-Due-to-Serious-Tip-over-Hazard",
    "TEST DATA — real recalled product. IKEA recalled 29 million MALM and other chests/dressers in 2016 (reannounced 2018) due to a serious tip-over hazard when not anchored to the wall; 8 child fatalities were reported. This listing represents a hypothetical marketplace reseller still offering an unanchored, un-repaired unit.",
    "Furniture",
    1,
  ], bounty3);
  record("submit_investigation (product 3)", "write", (!sub3.leaderErrored && sub3.consensusHealthy), `tx=${sub3.txHash} result=${sub3.resultName} parsed=${JSON.stringify(sub3.parsedResult)}`);
  const inv3Id = sub3.parsedResult?.investigation_id;
  investigationIds.malm = inv3Id;

  const photo3Url = await uploadEvidencePhoto("hunter", inv3Id, "malm-dresser-listing-photo.png", PRODUCT_IMAGES.malm);
  record("Cloudinary upload (product 3 photo)", "integration", true, photo3Url);
  const ev3a = await write(hunter.client, "add_evidence", [inv3Id, "product_photo", sha256(PRODUCT_IMAGES.malm), photo3Url, "Photo of the MALM chest as listed, with no visible anti-tip wall-anchoring hardware installed (TEST DATA)."]);
  record("add_evidence (product 3, photo)", "write", (!ev3a.leaderErrored && ev3a.consensusHealthy), `tx=${ev3a.txHash} result=${ev3a.resultName}`);
  const recallHash3 = sha256(Buffer.from("cpsc-ikea-malm-2018|reference"));
  const ev3b = await write(hunter.client, "add_evidence", [inv3Id, "recall_notice", recallHash3, "https://www.cpsc.gov/Recalls/2018/IKEA-Reannounces-Recall-of-MALM-and-Other-Models-of-Chests-and-Dressers-Due-to-Serious-Tip-over-Hazard", "CPSC recall notice confirming the MALM tip-over recall (TEST DATA, real recall)."]);
  record("add_evidence (product 3, recall reference)", "write", (!ev3b.leaderErrored && ev3b.consensusHealthy), `tx=${ev3b.txHash} result=${ev3b.resultName}`);

  await apiCall("hunter", `/evidence/${inv3Id}/sync`, { method: "POST", body: JSON.stringify({ txHash: ev3b.txHash }) });
  await apiCall("hunter", `/investigations/${inv3Id}/sync`, { method: "POST", body: JSON.stringify({}) });

  const verdict3 = await write(hunter.client, "request_verdict", [inv3Id]);
  record("request_verdict (product 3)", "write", (!verdict3.leaderErrored && verdict3.consensusHealthy), `tx=${verdict3.txHash} result=${verdict3.resultName} parsed=${JSON.stringify(verdict3.parsedResult)}`);
  await apiCall("hunter", `/investigations/${inv3Id}/sync`, { method: "POST", body: JSON.stringify({}) });
  const inv3After = await read(hunter.client, "get_investigation", [inv3Id]);
  record("get_investigation (product 3, post-verdict)", "view", true, JSON.stringify(inv3After));

  // =====================================================================
  // PRODUCT 4 — Instant Pot Duo Plus (real product, NOT recalled — a
  // deliberate contrast case). Submitted then cancelled before any
  // evidence is attached, exercising cancel_investigation's real refund
  // path and withdraw() cleanly.
  // =====================================================================
  section("PRODUCT 4 — Instant Pot Duo Plus (real product, no recall) — submit + cancel + withdraw");
  const bounty4 = 2n * 10n ** 16n;
  const sub4 = await write(hunter.client, "submit_investigation", [
    "Instant Pot Duo Plus 9-in-1, 6 Quart (TEST ENTRY — real product, no known recall)",
    "Instant Pot",
    "Duo Plus 9-in-1 6 Quart",
    "",
    "TestMarketplace",
    `${WEB_BASE}/demo-listing/4?code=product4-marketplace-listing`,
    "https://instantpot.com",
    "",
    "TEST DATA — real, currently-sold product included as a deliberate contrast case (no known CPSC recall exists for this model). Submitted to exercise cancel_investigation's real refund path before any evidence is attached, rather than to assert a genuine safety claim.",
    "Kitchen Appliances",
    3,
  ], bounty4);
  record("submit_investigation (product 4)", "write", (!sub4.leaderErrored && sub4.consensusHealthy), `tx=${sub4.txHash} result=${sub4.resultName} parsed=${JSON.stringify(sub4.parsedResult)}`);
  const inv4Id = sub4.parsedResult?.investigation_id;
  investigationIds.instantPot = inv4Id;

  const cancelRes = await write(hunter.client, "cancel_investigation", [inv4Id]);
  record("cancel_investigation (product 4)", "write", (!cancelRes.leaderErrored && cancelRes.consensusHealthy), `tx=${cancelRes.txHash} result=${cancelRes.resultName}`);
  await apiCall("hunter", `/investigations/${inv4Id}/sync`, { method: "POST", body: JSON.stringify({ txHash: cancelRes.txHash }) });
  const inv4After = await read(hunter.client, "get_investigation", [inv4Id]);
  record("get_investigation (product 4, post-cancel)", "view", Number(inv4After.status) === 7, JSON.stringify(inv4After));

  // =====================================================================
  // Seller-bond lifecycle completion — a second, unlinked bond exercises
  // topup_seller_bond + withdraw_seller_bond's full happy path without
  // needing to wait on a linked investigation's settlement.
  // =====================================================================
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
    console.log("(hunter balance is 0 — no bounty settlement has occurred yet since settle_investigation is deadline-gated; skipping withdraw to avoid a guaranteed-reject zero-balance call.)");
  }
  const sellerBalance = await read(seller.client, "get_balance", [seller.address]);
  record("get_balance (seller, pre-withdraw)", "view", true, String(sellerBalance));
  if (BigInt(sellerBalance) > 0n) {
    const sellerWithdraw = await write(seller.client, "withdraw", [BigInt(sellerBalance)]);
    record("withdraw (seller)", "write", (!sellerWithdraw.leaderErrored && sellerWithdraw.consensusHealthy), `tx=${sellerWithdraw.txHash} result=${sellerWithdraw.resultName}`);
  } else {
    console.log("(seller balance is 0; skipping withdraw to avoid a guaranteed-reject zero-balance call.)");
  }

  section("Full view-method sweep");
  const countAfter = await read(hunter.client, "get_investigation_count");
  record("get_investigation_count", "view", true, String(countAfter));
  const idAt0 = await read(hunter.client, "get_investigation_id_at", [0]);
  record("get_investigation_id_at(0)", "view", true, String(idAt0));
  const list = await read(hunter.client, "list_investigations", [0, 10]);
  record("list_investigations(0,10)", "view", true, `total=${list.total} items=${list.items.length}`);
  for (const [name, id] of Object.entries(investigationIds)) {
    const evIds = await read(hunter.client, "get_evidence_ids_for_investigation", [id]);
    record(`get_evidence_ids_for_investigation (${name})`, "view", true, JSON.stringify(evIds));
    for (const evId of evIds) {
      const ev = await read(hunter.client, "get_evidence", [evId]);
      record(`get_evidence(${evId}) (${name})`, "view", true, JSON.stringify(ev));
    }
  }
  const bondCount = await read(hunter.client, "get_seller_bond_count");
  record("get_seller_bond_count", "view", true, String(bondCount));
  const hunterRepFinal = await read(hunter.client, "get_reputation", [hunter.address]);
  record("get_reputation (hunter, final)", "view", true, JSON.stringify(hunterRepFinal));
  const challengerRepFinal = await read(challenger.client, "get_reputation", [challenger.address]);
  record("get_reputation (challenger, final)", "view", true, JSON.stringify(challengerRepFinal));
  const protocolInfoFinal = await read(hunter.client, "get_protocol_info");
  record("get_protocol_info (final)", "view", true, JSON.stringify(protocolInfoFinal));

  section("Final live API sync + shape verification");
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
  console.log("\nInvestigation IDs:", JSON.stringify(investigationIds));
  console.log("Deferred (real time required, not run today): claim_evidence_timeout, claim_verdict_timeout, claim_challenge_timeout, settle_investigation.");
}

main().catch((err) => {
  console.error("SCRIPT ERROR:", err);
  process.exitCode = 1;
});
