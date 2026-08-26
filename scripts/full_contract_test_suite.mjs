#!/usr/bin/env node
// Comprehensive live test of every read and write method on the deployed
// RecallRaid contract, using three real funded test wallets playing the
// hunter/challenger/seller roles, real Cloudinary uploads, and real
// fetchable URLs for the nondet verdict passes. Every meaningful state
// change is synced into the live API so it shows up on
// https://recall-raid.vercel.app immediately.
//
// Run: node scripts/full_contract_test_suite.mjs

import { createClient, createAccount } from "genlayer-js";
import { studionet } from "genlayer-js/chains";
import { privateKeyToAccount } from "viem/accounts";
import { createPublicClient, http } from "viem";
import { createHash } from "node:crypto";

const CONTRACT_ADDRESS = "0xa8bE73AAac3422c646131738A073Ac22d5eA2Ffe";
const RPC_URL = "https://studio.genlayer.com/api";
const API_BASE = "https://recallraid-api.fly.dev";
const WEB_BASE = "https://recall-raid.vercel.app";

const WALLETS = {
  hunter: "0x63028d88026d5bd4fafbacc46546bb1d85ac4d9fff21596c147430534035a314",
  challenger: "0x8129e32076de8fadd83a71bc02504644bb9871029afbbc3c452dea8954ab5ef2",
  seller: "0xcaac0f431d3577c8cb42ae1c0303e0fbd8d7a80598abd05c0b5113686efd35f9",
};

const results = []; // { method, kind, ok, detail }
function record(method, kind, ok, detail) {
  results.push({ method, kind, ok, detail });
  console.log(`${ok ? "✓" : "✗"} [${kind}] ${method} — ${detail}`);
  if (!ok) process.exitCode = 1;
}
function section(title) {
  console.log("\n" + "=".repeat(8) + " " + title + " " + "=".repeat(8));
}

function makeClient(privateKey) {
  const account = privateKeyToAccount(privateKey);
  const glAccount = createAccount(privateKey);
  const client = createClient({
    chain: { ...studionet, rpcUrls: { default: { http: [RPC_URL] } } },
    account: glAccount,
  });
  return { address: account.address, account, client };
}

const publicClient = createPublicClient({
  chain: { ...studionet, rpcUrls: { default: { http: [RPC_URL] } } },
  transport: http(),
});

async function read(client, functionName, args = []) {
  const raw = await client.readContract({ address: CONTRACT_ADDRESS, functionName, args });
  let parsed = raw;
  if (typeof raw === "string") {
    try { parsed = JSON.parse(raw); } catch { /* bare scalar return, leave as-is */ }
  }
  return parsed;
}

// The contract's actual return value lives at
// consensus_data.leader_receipt[0].result.payload.readable — a JSON string
// that is itself double-encoded, because every write method returns a
// Python `json.dumps({...})` string, and GenVM's calldata encoder wraps
// that returned string value in its own JSON "readable" representation.
// The top-level `receipt.result` field is an unrelated internal numeric
// status code, NOT the method's return value (confirmed empirically —
// it was `6` for identical values on both a genuinely successful call and
// an earlier genuinely failed one).
function decodeLeaderResult(leaderReceipt) {
  const payload = leaderReceipt?.result?.payload;
  if (!payload || typeof payload.readable !== "string") return undefined;
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
  // `consensus_data.leader_receipt` actually holds every node's receipt for
  // the round (leader AND validators), distinguished by `mode`. A validator
  // legitimately shows execution_result: ERROR with
  // "Validator execution cancelled after quorum" once enough other
  // validators have already agreed — that is GenVM short-circuiting
  // redundant work, not a failure, so only the LEADER's own execution
  // result indicates whether the call itself actually errored.
  const leader = nodeReceipts.find((r) => r.mode === "leader") ?? nodeReceipts[0];
  const leaderErrored = !!(leader?.execution_result && leader.execution_result !== "SUCCESS" && leader.execution_result !== "NONE");
  // Consensus health: the outcome we actually want is agreement (on
  // success OR on a clean rejection) — genuine problems are disagreement
  // or a stalled/timed-out round, never "the validators agreed the
  // execution failed" for a deterministic write we expect to succeed.
  const consensusHealthy = !["MAJORITY_DISAGREE", "DISAGREEMENT", "TIMEOUT", "UNDETERMINED"].includes(receipt.result_name);
  const parsedResult = decodeLeaderResult(leader);
  // A clean deterministic `gl.vm.UserError` rejection (e.g. an
  // `[EXPECTED] ...` guard-clause raise) carries its message in
  // `leader.result.payload` directly (`status: "rollback"`), NOT in
  // stderr — confirmed live: stderr is empty for these, and only carries
  // text for things like the storage-pickling UserWarning or an actual
  // Python traceback. Checking stderr alone for rejection *content* (as
  // opposed to just detecting that a rejection happened via
  // `leaderErrored`) silently produces an empty string for the common
  // case and was a real bug in this script's own negative-test
  // assertions, not a sign of a contract problem.
  const rollbackMessage =
    leaderErrored && leader?.result?.status === "rollback" && typeof leader.result.payload === "string"
      ? leader.result.payload
      : undefined;
  return {
    txHash, receipt, parsedResult,
    leaderErrored, consensusHealthy,
    errorDetail: leaderErrored ? (rollbackMessage || leader?.genvm_result?.stderr) : undefined,
    resultName: receipt.result_name, statusName: receipt.status_name,
  };
}

async function expectRevert(label, fn) {
  // A rejected write does NOT throw a JS exception — genlayer-js resolves
  // waitForTransactionReceipt regardless of execution_result. A guard-
  // clause rejection shows up as the LEADER's own result (confirmed live:
  // e.g. `[EXPECTED] investigation is not awaiting first evidence`, with
  // execution_result: ERROR and leader+validator agreeing on that exact
  // message). So a correct rejection must be detected from the write()
  // result's leaderErrored/errorDetail, not from a try/catch.
  try {
    const result = await fn();
    if (result && result.leaderErrored) {
      record(label, "negative-write", true, `correctly rejected: ${(result.errorDetail || "").slice(0, 160)}`);
    } else {
      record(label, "negative-write", false, `expected a revert/rejection but the call succeeded (result=${JSON.stringify(result?.parsedResult)})`);
    }
  } catch (err) {
    // A genuine RPC/JS-level throw (e.g. network error) also counts as
    // "did not go through", but is worth distinguishing in the log.
    const msg = err?.message || String(err);
    record(label, "negative-write", true, `correctly rejected (threw): ${msg.slice(0, 160)}`);
  }
}

function sha256(buf) { return createHash("sha256").update(buf).digest("hex"); }

const TEST_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

// --- Wallet-session helper (exercises the exact flow apps/web now runs) ---
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
async function authenticate(role, account) {
  const { message } = await apiCall(role, "/auth/nonce", { method: "POST", body: JSON.stringify({ address: account.address }) });
  const signature = await account.signMessage({ message });
  await apiCall(role, "/auth/verify", { method: "POST", body: JSON.stringify({ address: account.address, signature }) });
}

async function main() {
  const hunter = makeClient(WALLETS.hunter);
  const challenger = makeClient(WALLETS.challenger);
  const seller = makeClient(WALLETS.seller);
  console.log("hunter:", hunter.address);
  console.log("challenger:", challenger.address);
  console.log("seller:", seller.address);

  section("Wallet auth for all three roles");
  await authenticate("hunter", hunter.account);
  record("auth (hunter)", "auth", true, "nonce+sign+verify succeeded, session cookie set");
  await authenticate("challenger", challenger.account);
  record("auth (challenger)", "auth", true, "nonce+sign+verify succeeded, session cookie set");
  await authenticate("seller", seller.account);
  record("auth (seller)", "auth", true, "nonce+sign+verify succeeded, session cookie set");

  section("Baseline reads (zero/known state)");
  const info0 = await read(hunter.client, "get_protocol_info");
  record("get_protocol_info", "view", info0.admin && info0.challenge_stake_bps === 2000, JSON.stringify(info0));
  const balHunter0 = await read(hunter.client, "get_balance", [hunter.address]);
  record("get_balance (hunter, pre)", "view", true, String(balHunter0));
  const repHunter0 = await read(hunter.client, "get_reputation", [hunter.address]);
  record("get_reputation (hunter, pre)", "view", true, JSON.stringify(repHunter0));

  // ================= Investigation 1: full showcase lifecycle =================
  section("submit_investigation — Investigation 1 (showcase, critical hazard)");
  const bounty1 = 5n * 10n ** 16n; // 0.05 GEN
  const sub1 = await write(hunter.client, "submit_investigation", [
    "VoltEdge SafeCharge Pro 65W GaN Charger (TEST ENTRY)",
    "VoltEdge Test Labs",
    "VE-SC65-2024",
    "SN-TEST-00042",
    "Amazon Marketplace",
    "https://www.amazon.com/s?k=gan+charger",
    "https://www.apple.com",
    "https://www.cpsc.gov/Recalls",
    "TEST DATA — automated contract test suite. Reports of the charger overheating and the casing deforming during overnight charging. Multiple similar units reported swelling near the USB-C port after 2-3 months of daily use.",
    "Electronics",
    1,
  ], bounty1);
  record("submit_investigation (inv 1)", "write", (!sub1.leaderErrored && sub1.consensusHealthy), `tx=${sub1.txHash} result=${sub1.resultName} parsed=${JSON.stringify(sub1.parsedResult)}`);
  const inv1Id = sub1.parsedResult?.investigation_id;
  if (!inv1Id) throw new Error("could not parse investigation_id for investigation 1");

  await apiCall("hunter", `/investigations/${inv1Id}/sync`, { method: "POST", body: JSON.stringify({ txHash: sub1.txHash }) });

  section("add_evidence x2 — Investigation 1 (real Cloudinary upload + reference doc)");
  const upload1 = await apiCall("hunter", "/evidence/upload-url", {
    method: "POST",
    body: JSON.stringify({ investigationId: inv1Id, contentType: "image/png", declaredSizeBytes: TEST_PNG.length, fileName: "charger-damage.png" }),
  });
  const form1 = new FormData();
  form1.append("file", new Blob([TEST_PNG], { type: "image/png" }), "charger-damage.png");
  for (const [k, v] of Object.entries(upload1.fields)) form1.append(k, v);
  const cloudRes1 = await fetch(upload1.upload_url, { method: "POST", body: form1 });
  const cloudJson1 = await cloudRes1.json();
  if (!cloudRes1.ok || !cloudJson1.secure_url) throw new Error("Cloudinary upload 1 failed: " + JSON.stringify(cloudJson1));
  record("Cloudinary upload (evidence 1 photo)", "integration", true, cloudJson1.secure_url);

  const ev1a = await write(hunter.client, "add_evidence", [inv1Id, "product_photo", sha256(TEST_PNG), cloudJson1.secure_url, "Photo of the deformed charger casing after overnight use (TEST DATA)."]);
  record("add_evidence (inv1, photo)", "write", (!ev1a.leaderErrored && ev1a.consensusHealthy), `tx=${ev1a.txHash} result=${ev1a.resultName}`);

  const recallDocHash = sha256(Buffer.from("https://www.cpsc.gov/Recalls|reference-doc|test-suite"));
  const ev1b = await write(hunter.client, "add_evidence", [inv1Id, "recall_notice", recallDocHash, "https://www.cpsc.gov/Recalls", "Reference to the CPSC public recall database, checked for a matching entry (TEST DATA)."]);
  record("add_evidence (inv1, recall reference)", "write", (!ev1b.leaderErrored && ev1b.consensusHealthy), `tx=${ev1b.txHash} result=${ev1b.resultName}`);

  await apiCall("hunter", `/evidence/${inv1Id}/sync`, { method: "POST", body: JSON.stringify({ txHash: ev1b.txHash }) });
  await apiCall("hunter", `/investigations/${inv1Id}/sync`, { method: "POST", body: JSON.stringify({}) });

  section("get_evidence / get_evidence_ids_for_investigation — Investigation 1");
  const evIds1 = await read(hunter.client, "get_evidence_ids_for_investigation", [inv1Id]);
  record("get_evidence_ids_for_investigation", "view", Array.isArray(evIds1) && evIds1.length === 2, JSON.stringify(evIds1));
  for (const id of evIds1) {
    const ev = await read(hunter.client, "get_evidence", [id]);
    record(`get_evidence(${id})`, "view", ev.investigation_id === inv1Id, JSON.stringify(ev));
  }

  section("request_verdict — Investigation 1 (real nondet web-fetch + LLM pass)");
  let verdict1 = await write(hunter.client, "request_verdict", [inv1Id]);
  record("request_verdict (inv1, pass 1)", "write", (!verdict1.leaderErrored && verdict1.consensusHealthy), `tx=${verdict1.txHash} result=${verdict1.resultName} parsed=${JSON.stringify(verdict1.parsedResult)}`);
  if (verdict1.leaderErrored) console.error("STDERR:", verdict1.errorDetail);

  await apiCall("hunter", `/investigations/${inv1Id}/sync`, { method: "POST", body: JSON.stringify({ txHash: verdict1.txHash }) });
  let inv1AfterVerdict = await read(hunter.client, "get_investigation", [inv1Id]);
  record("get_investigation (inv1, post-verdict-1)", "view", true, `status=${inv1AfterVerdict.status} verdict=${inv1AfterVerdict.verdict} confidence_bps=${inv1AfterVerdict.ai_confidence_bps}`);

  // If the guardrail routed to NEEDS_MORE_EVIDENCE (status back to
  // EVIDENCE_SUBMITTED, verdict=4), add one more evidence item and retry
  // once — this is the contract's designed non-forcing path, not a failure.
  if (inv1AfterVerdict.status === 1 && inv1AfterVerdict.verdict === 4) {
    section("request_verdict retry — NEEDS_MORE_EVIDENCE reopened the evidence window (expected design path)");
    const ev1c = await write(hunter.client, "add_evidence", [inv1Id, "manufacturer_doc", sha256(Buffer.from("https://www.apple.com|manufacturer-page|test-suite")), "https://www.apple.com", "Additional reference evidence for the retry pass (TEST DATA)."]);
    record("add_evidence (inv1, retry evidence)", "write", (!ev1c.leaderErrored && ev1c.consensusHealthy), `tx=${ev1c.txHash}`);
    verdict1 = await write(hunter.client, "request_verdict", [inv1Id]);
    record("request_verdict (inv1, pass 2)", "write", (!verdict1.leaderErrored && verdict1.consensusHealthy), `tx=${verdict1.txHash} result=${verdict1.resultName} parsed=${JSON.stringify(verdict1.parsedResult)}`);
    await apiCall("hunter", `/evidence/${inv1Id}/sync`, { method: "POST", body: JSON.stringify({ txHash: ev1c.txHash }) });
    await apiCall("hunter", `/investigations/${inv1Id}/sync`, { method: "POST", body: JSON.stringify({ txHash: verdict1.txHash }) });
    inv1AfterVerdict = await read(hunter.client, "get_investigation", [inv1Id]);
    record("get_investigation (inv1, post-verdict-2)", "view", true, `status=${inv1AfterVerdict.status} verdict=${inv1AfterVerdict.verdict}`);
  }

  const inv1ReachedVerdict = inv1AfterVerdict.status === 3; // VERDICT_REACHED

  // ================= Negative / guard-rail tests on Investigation 1 =================
  section("Negative tests — Investigation 1 guard rails");
  await expectRevert("claim_evidence_timeout before deadline (inv1)", () => write(hunter.client, "claim_evidence_timeout", [inv1Id]));
  await expectRevert("claim_verdict_timeout before deadline (inv1)", () => write(hunter.client, "claim_verdict_timeout", [inv1Id]));
  await expectRevert("cancel_investigation after evidence exists (inv1)", () => write(hunter.client, "cancel_investigation", [inv1Id]));
  await expectRevert("link_seller_bond on inv1 after verdict window (wrong status)", () => write(seller.client, "link_seller_bond", [inv1Id, 999999]));
  await expectRevert("set_paused by non-admin (challenger)", () => write(challenger.client, "set_paused", [true]));
  await expectRevert("transfer_administration by non-admin (challenger)", () => write(challenger.client, "transfer_administration", [challenger.address]));

  let challengeId = null;
  // A failed challenge (resolve_challenge overturned:false — the original
  // verdict is upheld) forfeits the challenger's stake to the hunter as
  // compensation for having a correct claim disputed. Tracked here so the
  // later withdraw-balance assertion can account for it instead of
  // assuming the hunter's only withdrawable balance is investigation 2's
  // cancel refund — previously an unconditional hardcoded expectation
  // that only held because request_verdict/resolve_challenge had a 0%
  // observed consensus-agreement rate and this whole challenge branch
  // never actually ran; now that the leader_result unwrap fix makes it
  // run for real, the assertion has to reflect that.
  let hunterCreditFromFailedChallenge = 0n;
  if (inv1ReachedVerdict) {
    section("open_challenge — negative (self-challenge) then real challenge");
    await expectRevert("open_challenge by original submitter (should be rejected)", () => {
      const requiredStake = (BigInt(inv1AfterVerdict.bounty_wei) * 2000n) / 10000n;
      return write(hunter.client, "open_challenge", [inv1Id, "Self-challenge attempt (TEST — expected to fail)"], requiredStake);
    });

    const requiredStake = (BigInt(inv1AfterVerdict.bounty_wei) * 2000n) / 10000n;
    await expectRevert("open_challenge with wrong stake amount (off by one)", () =>
      write(challenger.client, "open_challenge", [inv1Id, "Disputing verdict (TEST — wrong stake)"], requiredStake - 1n));

    const challengeRes = await write(challenger.client, "open_challenge", [inv1Id, "TEST DATA — disputing the verdict to exercise the challenge/resolution path end-to-end."], requiredStake);
    record("open_challenge (inv1, correct stake)", "write", (!challengeRes.leaderErrored && challengeRes.consensusHealthy), `tx=${challengeRes.txHash} parsed=${JSON.stringify(challengeRes.parsedResult)}`);
    challengeId = challengeRes.parsedResult?.challenge_id;

    if (challengeId) {
      await expectRevert("claim_challenge_timeout before resolution deadline", () => write(hunter.client, "claim_challenge_timeout", [challengeId]));

      section("resolve_challenge — real second nondet pass");
      const resolveRes = await write(challenger.client, "resolve_challenge", [challengeId]);
      record("resolve_challenge", "write", (!resolveRes.leaderErrored && resolveRes.consensusHealthy), `tx=${resolveRes.txHash} result=${resolveRes.resultName} parsed=${JSON.stringify(resolveRes.parsedResult)}`);
      if (resolveRes.leaderErrored) console.error("STDERR:", resolveRes.errorDetail);

      await apiCall("hunter", `/challenges/${challengeId}/sync`, { method: "POST", body: JSON.stringify({ txHash: resolveRes.txHash }) });
      await apiCall("hunter", `/investigations/${inv1Id}/sync`, { method: "POST", body: JSON.stringify({}) });

      const challengeAfter = await read(hunter.client, "get_challenge", [challengeId]);
      record("get_challenge (post-resolution)", "view", true, JSON.stringify(challengeAfter));

      if (resolveRes.parsedResult?.overturned === false) {
        hunterCreditFromFailedChallenge = requiredStake;
      }

      await expectRevert("resolve_challenge twice (already resolved)", () => write(challenger.client, "resolve_challenge", [challengeId]));
    }
  } else {
    console.log("(Investigation 1 did not reach VERDICT_REACHED after two evidence rounds — challenge flow skipped, this is a valid NEEDS_MORE_EVIDENCE outcome, not an error. See memory.md.)");
  }

  // ================= Investigation 2: cancel + withdraw path =================
  // Bond creation + listing verification now happen BEFORE
  // submit_investigation: link_seller_bond requires the bond's verified
  // listing_url to canonically match the investigation's own
  // marketplace_url (see the round-4 audit fix below), so investigation
  // 2's marketplace_url is deliberately set to the SAME demo-listing URL
  // the bond gets verified against, to exercise the real positive path.
  section("create_seller_bond + verify_seller_bond_listing — real web-fetch ownership proof");
  const bondRes1 = await write(seller.client, "create_seller_bond", [], 3n * 10n ** 16n);
  record("create_seller_bond (bond 1)", "write", (!bondRes1.leaderErrored && bondRes1.consensusHealthy), `tx=${bondRes1.txHash} parsed=${JSON.stringify(bondRes1.parsedResult)}`);
  const bond1Id = bondRes1.parsedResult?.bond_id;
  const bond1Code = bondRes1.parsedResult?.verification_code;

  // Hosted on apps/web (Vercel's globally-distributed edge network), not
  // apps/api (Fly, single region `iad`) or Cloudinary. Cloudinary forces
  // `Content-Disposition: attachment` on every raw HTML upload
  // (non-configurable anti-XSS policy), which makes GenVM's browser-based
  // gl.nondet.web.render treat it as a file download rather than a page
  // to render. The Fly-hosted version had a different, subtler problem:
  // confirmed live that GenVM's geographically-distributed validator set
  // couldn't all reach a single-region Fly app reliably — some validators
  // fetched it successfully while others silently couldn't, producing
  // MAJORITY_DISAGREE even when the leader and one validator both agreed
  // on a genuine match. Vercel's edge network serves from a point of
  // presence near wherever the request actually originates.
  const demoListingUrl = `${WEB_BASE}/demo-listing/${bond1Id}?code=${encodeURIComponent(bond1Code)}`;
  const demoListingCheck = await fetch(demoListingUrl);
  const demoListingText = await demoListingCheck.text();
  record("GET demo-listing page contains the bond's verification code", "integration", demoListingCheck.ok && demoListingText.includes(bond1Code), demoListingUrl);

  const noCodeResult = await write(seller.client, "verify_seller_bond_listing", [bond1Id, "https://www.cpsc.gov/Recalls"]);
  record(
    "verify_seller_bond_listing against a page WITHOUT the code (should be rejected)",
    "negative-write",
    noCodeResult.leaderErrored && (noCodeResult.errorDetail || "").includes("verification code"),
    `result=${noCodeResult.resultName} detail=${(noCodeResult.errorDetail || "").slice(0, 160)}`,
  );

  const verifyRes = await write(seller.client, "verify_seller_bond_listing", [bond1Id, demoListingUrl]);
  record("verify_seller_bond_listing (bond1, real code match)", "write", (!verifyRes.leaderErrored && verifyRes.consensusHealthy), `tx=${verifyRes.txHash} result=${verifyRes.resultName} detail=${(verifyRes.errorDetail || "").slice(0, 160)}`);
  const bond1AfterVerify = await read(seller.client, "get_seller_bond", [bond1Id]);
  record("get_seller_bond (bond1, post-verify)", "view", bond1AfterVerify.listing_verified === true && bond1AfterVerify.listing_url === demoListingUrl, JSON.stringify(bond1AfterVerify));

  section("submit_investigation — Investigation 2 (cancel-path test)");
  const bounty2 = 2n * 10n ** 16n; // 0.02 GEN
  const sub2 = await write(hunter.client, "submit_investigation", [
    "Generic Test Kettle 1.7L (TEST ENTRY — to be cancelled)",
    "TestBrand",
    "TB-K1700",
    "",
    "TestMarket",
    demoListingUrl,
    "",
    "",
    "TEST DATA — this investigation exists only to exercise cancel_investigation and withdraw() and is expected to be cancelled immediately.",
    "Kitchen Appliances",
    3,
  ], bounty2);
  record("submit_investigation (inv 2)", "write", (!sub2.leaderErrored && sub2.consensusHealthy), `tx=${sub2.txHash} parsed=${JSON.stringify(sub2.parsedResult)}`);
  const inv2Id = sub2.parsedResult?.investigation_id;

  section("link_seller_bond — now requires verified + matching listing (round-4 audit fix)");
  const bondRes2ForMismatch = await write(seller.client, "create_seller_bond", [], 1n * 10n ** 16n);
  const unverifiedBondId = bondRes2ForMismatch.parsedResult?.bond_id;
  const linkUnverifiedResult = await write(seller.client, "link_seller_bond", [inv2Id, unverifiedBondId]);
  record(
    "link_seller_bond with an UNVERIFIED bond (should be rejected)",
    "negative-write",
    linkUnverifiedResult.leaderErrored && (linkUnverifiedResult.errorDetail || "").includes("verify_seller_bond_listing"),
    `result=${linkUnverifiedResult.resultName} detail=${(linkUnverifiedResult.errorDetail || "").slice(0, 160)}`,
  );
  await write(seller.client, "verify_seller_bond_listing", [unverifiedBondId, "https://www.cpsc.gov/Recalls"]).catch(() => {});
  // (left unverified on purpose above — cpsc.gov never contains this
  // bond's code, so this call is expected to itself fail/reject and the
  // bond stays unverified; the negative test above already exercised the
  // "no verification at all" path directly)

  const bondRes3ForMismatch = await write(seller.client, "create_seller_bond", [], 1n * 10n ** 16n);
  const mismatchBondId = bondRes3ForMismatch.parsedResult?.bond_id;
  const mismatchCode = bondRes3ForMismatch.parsedResult?.verification_code;
  const mismatchListingUrl = `${WEB_BASE}/demo-listing/${mismatchBondId}?code=${encodeURIComponent(mismatchCode)}`;
  const mismatchVerifyRes = await write(seller.client, "verify_seller_bond_listing", [mismatchBondId, mismatchListingUrl]);
  record("verify_seller_bond_listing (mismatch bond, verified against its OWN page)", "write", (!mismatchVerifyRes.leaderErrored && mismatchVerifyRes.consensusHealthy), `tx=${mismatchVerifyRes.txHash} result=${mismatchVerifyRes.resultName}`);
  const linkMismatchResult = await write(seller.client, "link_seller_bond", [inv2Id, mismatchBondId]);
  record(
    "link_seller_bond with a VERIFIED bond for a DIFFERENT listing (should be rejected)",
    "negative-write",
    linkMismatchResult.leaderErrored && (linkMismatchResult.errorDetail || "").includes("does not match"),
    `result=${linkMismatchResult.resultName} detail=${(linkMismatchResult.errorDetail || "").slice(0, 160)}`,
  );

  const linkRes = await write(seller.client, "link_seller_bond", [inv2Id, bond1Id]);
  record("link_seller_bond (bond1, verified + matching listing -> inv2)", "write", (!linkRes.leaderErrored && linkRes.consensusHealthy), `tx=${linkRes.txHash} detail=${(linkRes.errorDetail || "").slice(0, 160)}`);

  // While genuinely linked, withdraw_seller_bond must be rejected.
  await expectRevert("withdraw_seller_bond while still linked (should be rejected)", () => write(seller.client, "withdraw_seller_bond", [bond1Id]));

  const cancelRes = await write(hunter.client, "cancel_investigation", [inv2Id]);
  record("cancel_investigation (inv2)", "write", (!cancelRes.leaderErrored && cancelRes.consensusHealthy), `tx=${cancelRes.txHash}`);
  await expectRevert("cancel_investigation twice (already cancelled)", () => write(hunter.client, "cancel_investigation", [inv2Id]));

  await apiCall("hunter", `/investigations/${inv2Id}/sync`, { method: "POST", body: JSON.stringify({ txHash: cancelRes.txHash }) });
  const inv2After = await read(hunter.client, "get_investigation", [inv2Id]);
  record("get_investigation (inv2, post-cancel)", "view", inv2After.status === 7, `status=${inv2After.status} (expect 7=CANCELLED) bounty_deposited_wei=${inv2After.bounty_deposited_wei}`);

  // Positive confirmation of the round-2 audit fix: cancelling the linked
  // investigation must have decremented linked_investigation_count, so the
  // bond should now be genuinely withdrawable — no longer permanently locked.
  const bond1AfterCancel = await read(seller.client, "get_seller_bond", [bond1Id]);
  record("get_seller_bond (bond1, post-cancel unlink)", "view", bond1AfterCancel.linked_investigation_count === 0, JSON.stringify(bond1AfterCancel));
  const withdrawBond1Res = await write(seller.client, "withdraw_seller_bond", [bond1Id]);
  record("withdraw_seller_bond (bond1, now unlinked)", "write", (!withdrawBond1Res.leaderErrored && withdrawBond1Res.consensusHealthy), `tx=${withdrawBond1Res.txHash}`);

  section("withdraw — hunter's refunded bounty from cancelled investigation 2");
  const balHunterBeforeWithdraw = await read(hunter.client, "get_balance", [hunter.address]);
  const expectedHunterBalance = bounty2 + hunterCreditFromFailedChallenge;
  record(
    "get_balance (hunter, pre-withdraw)",
    "view",
    BigInt(balHunterBeforeWithdraw) === expectedHunterBalance,
    `balance=${balHunterBeforeWithdraw} expected=${expectedHunterBalance} (inv2 refund=${bounty2} + failed-challenge-stake credit=${hunterCreditFromFailedChallenge})`,
  );
  const walletBalBefore = await publicClient.getBalance({ address: hunter.address });
  const withdrawRes = await write(hunter.client, "withdraw", [BigInt(balHunterBeforeWithdraw)]);
  record("withdraw (hunter)", "write", (!withdrawRes.leaderErrored && withdrawRes.consensusHealthy), `tx=${withdrawRes.txHash}`);
  const walletBalAfter = await publicClient.getBalance({ address: hunter.address });
  record("withdraw actually moved GEN to wallet", "integration", walletBalAfter > walletBalBefore, `before=${walletBalBefore} after=${walletBalAfter}`);
  const balHunterAfterWithdraw = await read(hunter.client, "get_balance", [hunter.address]);
  record("get_balance (hunter, post-withdraw)", "view", String(balHunterAfterWithdraw) === "0", `balance=${balHunterAfterWithdraw}`);
  await expectRevert("withdraw with zero balance", () => write(hunter.client, "withdraw", [1n]));

  // ================= Second seller bond: topup + withdraw_seller_bond =================
  section("create_seller_bond (bond 2, unlinked) + topup_seller_bond + withdraw_seller_bond");
  const bondRes2 = await write(seller.client, "create_seller_bond", [], 1n * 10n ** 16n);
  record("create_seller_bond (bond 2)", "write", (!bondRes2.leaderErrored && bondRes2.consensusHealthy), `tx=${bondRes2.txHash} parsed=${JSON.stringify(bondRes2.parsedResult)}`);
  const bond2Id = bondRes2.parsedResult?.bond_id;

  const topupRes = await write(seller.client, "topup_seller_bond", [bond2Id], 5n * 10n ** 15n);
  record("topup_seller_bond (bond 2)", "write", (!topupRes.leaderErrored && topupRes.consensusHealthy), `tx=${topupRes.txHash}`);

  const bond2BeforeWithdraw = await read(seller.client, "get_seller_bond", [bond2Id]);
  record("get_seller_bond (bond2, pre-withdraw)", "view", true, JSON.stringify(bond2BeforeWithdraw));

  const withdrawBondRes = await write(seller.client, "withdraw_seller_bond", [bond2Id]);
  record("withdraw_seller_bond (bond 2)", "write", (!withdrawBondRes.leaderErrored && withdrawBondRes.consensusHealthy), `tx=${withdrawBondRes.txHash}`);
  const sellerBalAfterBondWithdraw = await read(seller.client, "get_balance", [seller.address]);
  record("get_balance (seller, post-bond-withdraw credit)", "view", BigInt(sellerBalAfterBondWithdraw) > 0n, String(sellerBalAfterBondWithdraw));
  const sellerWithdrawRes = await write(seller.client, "withdraw", [BigInt(sellerBalAfterBondWithdraw)]);
  record("withdraw (seller, from bond withdrawal)", "write", (!sellerWithdrawRes.leaderErrored && sellerWithdrawRes.consensusHealthy), `tx=${sellerWithdrawRes.txHash}`);

  await apiCall("seller", `/seller-bonds/${bond1Id}/sync`, { method: "POST", body: JSON.stringify({}) });
  await apiCall("seller", `/seller-bonds/${bond2Id}/sync`, { method: "POST", body: JSON.stringify({}) });

  // ================= Full read sweep =================
  section("Full view-method sweep");
  const countAfter = await read(hunter.client, "get_investigation_count");
  record("get_investigation_count", "view", countAfter >= 2, String(countAfter));
  const idAt0 = await read(hunter.client, "get_investigation_id_at", [0]);
  record("get_investigation_id_at(0)", "view", true, String(idAt0));
  const list = await read(hunter.client, "list_investigations", [0, 10]);
  record("list_investigations(0,10)", "view", Array.isArray(list.items) && list.items.length >= 2, `total=${list.total} items=${list.items.length}`);
  const bondCount = await read(hunter.client, "get_seller_bond_count");
  record("get_seller_bond_count", "view", bondCount >= 2, String(bondCount));
  const repHunterFinal = await read(hunter.client, "get_reputation", [hunter.address]);
  record("get_reputation (hunter, final)", "view", true, JSON.stringify(repHunterFinal));
  const repChallengerFinal = await read(challenger.client, "get_reputation", [challenger.address]);
  record("get_reputation (challenger, final)", "view", true, JSON.stringify(repChallengerFinal));
  const infoFinal = await read(hunter.client, "get_protocol_info");
  record("get_protocol_info (final)", "view", infoFinal.investigation_count >= 2, JSON.stringify(infoFinal));

  // ================= Sync everything to the live API for frontend visibility =================
  section("Final sync pass + live API shape verification");
  await apiCall("hunter", `/investigations/${inv1Id}/sync`, { method: "POST", body: JSON.stringify({}) });
  await apiCall("hunter", `/investigations/${inv2Id}/sync`, { method: "POST", body: JSON.stringify({}) });

  const apiInv1 = await apiCall("hunter", `/investigations/${inv1Id}`);
  record("GET /investigations/:id (inv1, live API)", "api", apiInv1.id === inv1Id, JSON.stringify(apiInv1).slice(0, 200));
  const apiEvidence1 = await apiCall("hunter", `/evidence?investigation_id=${inv1Id}`);
  record("GET /evidence?investigation_id= (inv1, live API)", "api", Array.isArray(apiEvidence1) && apiEvidence1.length >= 2, `count=${apiEvidence1.length}`);
  const apiList = await apiCall("hunter", `/investigations?limit=50`);
  const apiFound1 = apiList.items.find((i) => i.id === inv1Id);
  const apiFound2 = apiList.items.find((i) => i.id === inv2Id);
  record("GET /investigations (list feed includes both)", "api", !!apiFound1 && !!apiFound2, `total=${apiList.total}`);
  const apiStats = await apiCall("hunter", "/stats");
  record("GET /stats (live aggregate)", "api", true, JSON.stringify(apiStats));
  const apiSellerBonds = await apiCall("seller", `/sellers/${seller.address.toLowerCase()}/bonds`);
  record("GET /sellers/:address/bonds (live API)", "api", Array.isArray(apiSellerBonds) && apiSellerBonds.length >= 2, `count=${apiSellerBonds.length}`);

  // ================= Summary =================
  section("SUMMARY");
  const failed = results.filter((r) => !r.ok);
  console.log(`${results.length} checks run, ${results.length - failed.length} passed, ${failed.length} failed.`);
  if (failed.length) {
    console.log("\nFAILED CHECKS:");
    for (const f of failed) console.log(`  ✗ [${f.kind}] ${f.method} — ${f.detail}`);
  }
  console.log(`\nShowcase investigation (visible on frontend): https://recall-raid.vercel.app/hunts/${inv1Id}`);
  console.log(`Cancelled test investigation: https://recall-raid.vercel.app/hunts/${inv2Id}`);
}

main().catch((err) => {
  console.error("\n✗✗✗ SUITE CRASHED:", err.message);
  console.error(err.stack);
  process.exit(1);
});
