#!/usr/bin/env node
// Two real-product showcase run against a freshly deployed RecallRaid
// contract (0x4aB01fb5435cdEfD3c651Cfc51f0F1fa1E2Ef6a4) — entirely
// different products from every prior showcase run (Rock 'n Play,
// Tread+, MALM, Instant Pot, Boppy, Jetson Hoverboard). Every call here
// is a genuine happy-path call — deliberately NO negative/expect-revert
// calls, since a guard-clause rejection shows up on the GenLayer explorer
// as an execution error even though it is contract-correct. Exercises
// every non-admin, non-deadline-gated read and write method, including
// `verify_evidence`, which this contract version now gates
// `request_verdict` on: every evidence item must be url_checked AND
// url_reachable AND content_hash_verified before a verdict can be
// requested. That means a recall_notice evidence item's content_hash
// can no longer be a synthetic placeholder — it must be the sha256 of
// the actual bytes GenVM will fetch from the live URL, computed here via
// `hashUrlContent()` right before add_evidence. After verify_evidence,
// the script explicitly reads back get_evidence and confirms
// url_reachable + content_hash_verified before ever calling
// request_verdict, so a verification miss aborts cleanly instead of
// producing a guaranteed-revert explorer error.
//
// NOT exercised here (by design, not oversight): claim_evidence_timeout,
// claim_verdict_timeout, claim_challenge_timeout, settle_investigation —
// all four are gated by real elapsed time (3 days / 2 days / 2 days /
// 2 days respectively) and calling any of them before their deadline
// genuinely reverts. set_paused / transfer_administration are admin-only
// and explicitly out of scope per the request.
//
// Run: node scripts/two_product_showcase_v2.mjs

import { createClient, createAccount } from "genlayer-js";
import { studionet } from "genlayer-js/chains";
import { createHash } from "node:crypto";
import { makeProductImage } from "./lib/make_product_image.mjs";

const CONTRACT_ADDRESS = "0x4aB01fb5435cdEfD3c651Cfc51f0F1fa1E2Ef6a4";
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
  // NO_MAJORITY and silently logged a non-agreement as a pass. See memory.md.
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

// The strict verify_evidence gate (content_hash_verified requires
// sha256(bytes GenVM fetches) == the claimed content_hash) means a
// recall_notice evidence item's hash must be the REAL fetched bytes of
// the live page, not a synthetic placeholder — a placeholder can never
// pass verification, which would then permanently block request_verdict
// for that investigation (evidence is append-only, no fix-up possible).
// Fetching it ourselves right before add_evidence and using that exact
// hash is the only way to get a real content_hash_verified: true result.
async function hashUrlContent(url) {
  const res = await fetch(url);
  const buf = Buffer.from(await res.arrayBuffer());
  return sha256(buf);
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
  // PRODUCT 1 — Kidde plastic-handle fire extinguishers (real, CPSC
  // recall Nov 2017 / notice updated 2018 — 37.8 million units, failure
  // to discharge + nozzle detachment, one death reported). Full
  // lifecycle: evidence, verify_evidence, verdict, challenge, resolve,
  // plus a linked + verified seller bond.
  // =====================================================================
  section("PRODUCT 1 — Kidde Fire Extinguishers (real CPSC recall) + seller bond");
  const bondRes = await write(seller.client, "create_seller_bond", [], 3n * 10n ** 16n);
  record("create_seller_bond (bond 1)", "write", (!bondRes.leaderErrored && bondRes.consensusHealthy), `tx=${bondRes.txHash} parsed=${JSON.stringify(bondRes.parsedResult)}`);
  const bond1Id = bondRes.parsedResult?.bond_id;
  const bond1Code = bondRes.parsedResult?.verification_code;
  const listingUrl1 = `${WEB_BASE}/demo-listing/${bond1Id}?code=${encodeURIComponent(bond1Code)}`;

  const listingCheck = await fetch(listingUrl1);
  const listingText = await listingCheck.text();
  record("GET demo-listing page contains bond's verification code", "integration", listingCheck.ok && listingText.includes(bond1Code), listingUrl1);

  const verifyBondRes = await write(seller.client, "verify_seller_bond_listing", [bond1Id, listingUrl1]);
  record("verify_seller_bond_listing (bond 1, real code match)", "write", (!verifyBondRes.leaderErrored && verifyBondRes.consensusHealthy), `tx=${verifyBondRes.txHash} result=${verifyBondRes.resultName}`);
  const bond1AfterVerify = await read(seller.client, "get_seller_bond", [bond1Id]);
  record("get_seller_bond (bond 1, post-verify)", "view", true, JSON.stringify(bond1AfterVerify));

  const bounty1 = 5n * 10n ** 16n;
  const sub1 = await write(hunter.client, "submit_investigation", [
    "Plastic-Handle Fire Extinguisher, ABC-rated (TEST ENTRY — real product, CPSC recall 2017/2018)",
    "Kidde",
    "Plastic Handle Fire Extinguisher",
    "",
    "TestMarketplace",
    listingUrl1,
    "https://www.kidde.com",
    "https://www.cpsc.gov/Recalls/2018/Kidde-Recalls-Fire-Extinguishers-with-Plastic-Handles-Due-to-Failure-to-Discharge-and-Nozzle-Detachment-One-Death-Reported",
    "TEST DATA — real recalled product. CPSC and Kidde recalled 37.8 million residential and commercial fire extinguishers with plastic handles and push-button Pindicator models (134 plastic-handle models made 1973-2017) in November 2017 because the extinguishers can become clogged or require excessive force to discharge, and the nozzle can detach with enough force to pose an impact hazard; one death has been reported in a fire where the extinguisher failed to work. This listing represents a hypothetical marketplace reseller still offering a recalled unit with the seller having posted a Clean Inventory Bond and verified ownership of this exact listing.",
    "Home Safety",
    1,
  ], bounty1);
  record("submit_investigation (product 1)", "write", (!sub1.leaderErrored && sub1.consensusHealthy), `tx=${sub1.txHash} result=${sub1.resultName} parsed=${JSON.stringify(sub1.parsedResult)}`);
  const inv1Id = sub1.parsedResult?.investigation_id;
  investigationIds.kiddeExtinguisher = inv1Id;

  const linkRes = await write(seller.client, "link_seller_bond", [inv1Id, bond1Id]);
  record("link_seller_bond (bond 1 -> product 1, verified + matching listing)", "write", (!linkRes.leaderErrored && linkRes.consensusHealthy), `tx=${linkRes.txHash} result=${linkRes.resultName}`);

  const kiddeImage = makeProductImage({ seed: [200, 30, 30] }); // fire-extinguisher red
  const photo1Url = await uploadEvidencePhoto("hunter", inv1Id, "kidde-extinguisher-listing-photo.png", kiddeImage);
  record("Cloudinary upload (product 1 photo, real visible image)", "integration", true, photo1Url);
  const ev1a = await write(hunter.client, "add_evidence", [inv1Id, "product_photo", sha256(kiddeImage), photo1Url, "Photo of the Kidde fire extinguisher as listed, showing the plastic handle and push-button style referenced in the CPSC recall (TEST DATA)."]);
  record("add_evidence (product 1, photo)", "write", (!ev1a.leaderErrored && ev1a.consensusHealthy), `tx=${ev1a.txHash} result=${ev1a.resultName}`);
  // Points at a static PDF hosting of the real CPSC recall notice, not
  // cpsc.gov's own dynamic page directly — confirmed via
  // contracts/diagnostics/nondet_consensus_diagnostic.py's
  // check_web_get_url that cpsc.gov's live page returns
  // MAJORITY_DISAGREE under gl.nondet.web.get (independent validator
  // fetches don't converge on identical bytes, likely WAF/bot-detection
  // or per-request dynamic content), while a static-file host of the
  // same official document round-trips with MAJORITY_AGREE and a stable
  // sha256. Same real, official recall content either way — this is
  // about where GenVM can reliably fetch it from, not about using
  // different information. inv.recall_source_url (set below) still
  // points at the real cpsc.gov page for the adjudication prompt, which
  // fetches via gl.nondet.web.render (text/browser rendering), a
  // different code path not shown to have this problem.
  const recallUrl1 = "https://files.aptuitivcdn.com/GB7r14nbKy-1182/docs/Fire/Kidde-Fire-Extinguisher-Recall.pdf";
  const recallHash1 = await hashUrlContent(recallUrl1);
  const ev1b = await write(hunter.client, "add_evidence", [inv1Id, "recall_notice", recallHash1, recallUrl1, "Static-hosted copy of the official CPSC recall notice (see the investigation's recall_source_url for the live cpsc.gov page) confirming the November 2017 Kidde plastic-handle fire extinguisher recall due to failure-to-discharge and nozzle-detachment hazards, one death reported (TEST DATA, real recall)."]);
  record("add_evidence (product 1, recall reference)", "write", (!ev1b.leaderErrored && ev1b.consensusHealthy), `tx=${ev1b.txHash} result=${ev1b.resultName}`);

  await apiCall("hunter", `/evidence/${inv1Id}/sync`, { method: "POST", body: JSON.stringify({ txHash: ev1b.txHash }) });
  await apiCall("hunter", `/investigations/${inv1Id}/sync`, { method: "POST", body: JSON.stringify({}) });

  const evidenceIds1 = await read(hunter.client, "get_evidence_ids_for_investigation", [inv1Id]);
  record("get_evidence_ids_for_investigation (product 1, pre-verify)", "view", true, JSON.stringify(evidenceIds1));
  let product1AllVerified = true;
  for (const evId of evidenceIds1) {
    const verifyEvRes = await write(hunter.client, "verify_evidence", [evId]);
    record(`verify_evidence (product 1, evidence ${evId})`, "write", (!verifyEvRes.leaderErrored && verifyEvRes.consensusHealthy), `tx=${verifyEvRes.txHash} result=${verifyEvRes.resultName} parsed=${JSON.stringify(verifyEvRes.parsedResult)}`);
    const evAfter = await read(hunter.client, "get_evidence", [evId]);
    const ok = evAfter.url_reachable && evAfter.content_hash_verified;
    record(`get_evidence (product 1, evidence ${evId}, verification check)`, "view", true, JSON.stringify(evAfter));
    if (!ok) product1AllVerified = false;
  }
  // request_verdict now reverts unless every evidence item is reachable
  // AND content-hash-verified — calling it against unverified evidence
  // would be a guaranteed, avoidable explorer error, so confirm the real
  // verification result here first rather than finding out from a revert.
  if (!product1AllVerified) {
    throw new Error(`Product 1 evidence did not fully verify (reachable + hash-matched) — aborting before request_verdict to avoid a guaranteed revert. Evidence ids: ${JSON.stringify(evidenceIds1)}`);
  }

  let verdict1 = await write(hunter.client, "request_verdict", [inv1Id]);
  record("request_verdict (product 1)", "write", (!verdict1.leaderErrored && verdict1.consensusHealthy), `tx=${verdict1.txHash} result=${verdict1.resultName} parsed=${JSON.stringify(verdict1.parsedResult)}`);
  // If consensus wasn't reached, the investigation stays in its prior
  // state untouched (no partial commit) — a plain retry is legitimate,
  // not a forced/guaranteed-reject call. See memory.md.
  while (!verdict1.consensusHealthy || verdict1.leaderErrored) {
    console.log("  retrying request_verdict (product 1) — prior attempt did not reach clean agreement, investigation state unaffected...");
    verdict1 = await write(hunter.client, "request_verdict", [inv1Id]);
    record("request_verdict (product 1, retry)", "write", (!verdict1.leaderErrored && verdict1.consensusHealthy), `tx=${verdict1.txHash} result=${verdict1.resultName} parsed=${JSON.stringify(verdict1.parsedResult)}`);
  }
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
  // PRODUCT 2 — Zen Magnets / Neoballs high-powered magnet sets (real,
  // CPSC recall Aug 2021 — ~10 million units, ingestion hazard, deaths
  // and surgeries reported). Straight submit -> evidence -> verify_evidence
  // -> verdict, no challenge, for a clean contrast.
  // =====================================================================
  section("PRODUCT 2 — Zen Magnets / Neoballs High-Powered Magnet Sets (real CPSC recall)");
  const bounty2 = 4n * 10n ** 16n;
  const sub2 = await write(hunter.client, "submit_investigation", [
    "Neoballs High-Powered Magnet Set, 216-count (TEST ENTRY — real product, CPSC recall Aug 2021)",
    "Zen Magnets",
    "Neoballs 216-count set",
    "",
    "TestMarketplace",
    `${WEB_BASE}/demo-listing/2?code=product2-marketplace-listing`,
    "https://zenmagnets.com",
    "https://cpsc.gov/Recalls/2021/Zen-Magnets-and-Neoballs-Magnets-Recalled-Due-to-Ingestion-Hazard",
    "TEST DATA — real recalled product. CPSC and Zen Magnets LLC recalled about 10 million Zen Magnets and Neoballs high-powered magnet sets in August 2021 due to ingestion hazard: when two or more magnets are swallowed they can attract to each other across intestinal walls, causing perforations, blockage, infection, or death. Zen Magnets is aware of two children requiring surgery to remove ingested magnets and intestinal tissue; CPSC separately reported a 19-month-old girl who died after ingesting similar high-powered magnets. This listing represents a hypothetical marketplace reseller still offering the recalled magnet set.",
    "Toys",
    1,
  ], bounty2);
  record("submit_investigation (product 2)", "write", (!sub2.leaderErrored && sub2.consensusHealthy), `tx=${sub2.txHash} result=${sub2.resultName} parsed=${JSON.stringify(sub2.parsedResult)}`);
  const inv2Id = sub2.parsedResult?.investigation_id;
  investigationIds.zenMagnets = inv2Id;

  const zenImage = makeProductImage({ seed: [140, 140, 150] }); // steel/silver, distinct from product 1
  const photo2Url = await uploadEvidencePhoto("hunter", inv2Id, "zen-magnets-listing-photo.png", zenImage);
  record("Cloudinary upload (product 2 photo, real visible image)", "integration", true, photo2Url);
  const ev2a = await write(hunter.client, "add_evidence", [inv2Id, "product_photo", sha256(zenImage), photo2Url, "Photo of the Neoballs magnet set as listed, matching the recalled high-powered magnet ball design (TEST DATA)."]);
  record("add_evidence (product 2, photo)", "write", (!ev2a.leaderErrored && ev2a.consensusHealthy), `tx=${ev2a.txHash} result=${ev2a.resultName}`);
  // Same static-hosting rationale as product 1's recall reference — a
  // static PDF of the official CPSC/Zen Magnets joint recall press
  // release, confirmed GenVM-fetch-stable, rather than cpsc.gov's own
  // dynamic page directly.
  const recallUrl2 = "https://zenmagnets.com/wp-content/uploads/2021/08/CPSC-Joint-Recall-Press-Release.pdf";
  const recallHash2 = await hashUrlContent(recallUrl2);
  const ev2b = await write(hunter.client, "add_evidence", [inv2Id, "recall_notice", recallHash2, recallUrl2, "Static-hosted copy of the official CPSC/Zen Magnets joint recall press release (see the investigation's recall_source_url for the live cpsc.gov page) confirming the August 2021 Zen Magnets/Neoballs recall due to ingestion hazard (TEST DATA, real recall)."]);
  record("add_evidence (product 2, recall reference)", "write", (!ev2b.leaderErrored && ev2b.consensusHealthy), `tx=${ev2b.txHash} result=${ev2b.resultName}`);

  await apiCall("hunter", `/evidence/${inv2Id}/sync`, { method: "POST", body: JSON.stringify({ txHash: ev2b.txHash }) });
  await apiCall("hunter", `/investigations/${inv2Id}/sync`, { method: "POST", body: JSON.stringify({}) });

  const evidenceIds2 = await read(hunter.client, "get_evidence_ids_for_investigation", [inv2Id]);
  record("get_evidence_ids_for_investigation (product 2, pre-verify)", "view", true, JSON.stringify(evidenceIds2));
  let product2AllVerified = true;
  for (const evId of evidenceIds2) {
    const verifyEvRes = await write(hunter.client, "verify_evidence", [evId]);
    record(`verify_evidence (product 2, evidence ${evId})`, "write", (!verifyEvRes.leaderErrored && verifyEvRes.consensusHealthy), `tx=${verifyEvRes.txHash} result=${verifyEvRes.resultName} parsed=${JSON.stringify(verifyEvRes.parsedResult)}`);
    const evAfter = await read(hunter.client, "get_evidence", [evId]);
    const ok = evAfter.url_reachable && evAfter.content_hash_verified;
    record(`get_evidence (product 2, evidence ${evId}, verification check)`, "view", true, JSON.stringify(evAfter));
    if (!ok) product2AllVerified = false;
  }
  if (!product2AllVerified) {
    throw new Error(`Product 2 evidence did not fully verify (reachable + hash-matched) — aborting before request_verdict to avoid a guaranteed revert. Evidence ids: ${JSON.stringify(evidenceIds2)}`);
  }

  let verdict2 = await write(hunter.client, "request_verdict", [inv2Id]);
  record("request_verdict (product 2)", "write", (!verdict2.leaderErrored && verdict2.consensusHealthy), `tx=${verdict2.txHash} result=${verdict2.resultName} parsed=${JSON.stringify(verdict2.parsedResult)}`);
  while (!verdict2.consensusHealthy || verdict2.leaderErrored) {
    console.log("  retrying request_verdict (product 2) — prior attempt did not reach clean agreement, investigation state unaffected...");
    verdict2 = await write(hunter.client, "request_verdict", [inv2Id]);
    record("request_verdict (product 2, retry)", "write", (!verdict2.leaderErrored && verdict2.consensusHealthy), `tx=${verdict2.txHash} result=${verdict2.resultName} parsed=${JSON.stringify(verdict2.parsedResult)}`);
  }
  await apiCall("hunter", `/investigations/${inv2Id}/sync`, { method: "POST", body: JSON.stringify({}) });
  const inv2After = await read(hunter.client, "get_investigation", [inv2Id]);
  record("get_investigation (product 2, post-verdict)", "view", true, JSON.stringify(inv2After));
  const evidenceIds2Final = await read(hunter.client, "get_evidence_ids_for_investigation", [inv2Id]);
  for (const evId of evidenceIds2Final) {
    const ev = await read(hunter.client, "get_evidence", [evId]);
    record(`get_evidence(${evId}) (product 2, post-verify)`, "view", true, JSON.stringify(ev));
  }

  // =====================================================================
  // cancel_investigation — a third, minimal submission exists purely to
  // exercise the real refund path (never intended to reach a verdict).
  // Not counted as one of the "2 products" since it carries no evidence
  // or adjudication — it is a pure escrow-mechanics exercise, same
  // pattern as product 4 in the four-product showcase.
  // =====================================================================
  section("cancel_investigation — real refund path");
  const bounty3 = 1n * 10n ** 16n;
  const sub3 = await write(hunter.client, "submit_investigation", [
    "Placeholder-free submit+cancel exercise (TEST ENTRY — submitted only to exercise cancel_investigation's refund path)",
    "N/A",
    "N/A",
    "",
    "TestMarketplace",
    `${WEB_BASE}/demo-listing/3?code=product3-marketplace-listing`,
    "",
    "",
    "TEST DATA — submitted solely to exercise cancel_investigation's real refund path before any evidence is attached; not a safety claim about a real product.",
    "Other",
    3,
  ], bounty3);
  record("submit_investigation (cancel exercise)", "write", (!sub3.leaderErrored && sub3.consensusHealthy), `tx=${sub3.txHash} result=${sub3.resultName} parsed=${JSON.stringify(sub3.parsedResult)}`);
  const inv3Id = sub3.parsedResult?.investigation_id;
  const cancelRes = await write(hunter.client, "cancel_investigation", [inv3Id]);
  record("cancel_investigation", "write", (!cancelRes.leaderErrored && cancelRes.consensusHealthy), `tx=${cancelRes.txHash} result=${cancelRes.resultName}`);
  await apiCall("hunter", `/investigations/${inv3Id}/sync`, { method: "POST", body: JSON.stringify({ txHash: cancelRes.txHash }) });
  const inv3After = await read(hunter.client, "get_investigation", [inv3Id]);
  record("get_investigation (post-cancel)", "view", Number(inv3After.status) === 7, JSON.stringify(inv3After));

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
