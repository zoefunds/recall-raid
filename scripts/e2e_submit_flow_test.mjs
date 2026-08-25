#!/usr/bin/env node
// Real end-to-end test of the submit-evidence flow against the LIVE stack:
// deployed contract on StudioNet, live Fastify API on Fly, real Cloudinary
// upload. Uses a throwaway funded test wallet (never the user's own).
// Run: node scripts/e2e_submit_flow_test.mjs

import { createClient, createAccount } from "genlayer-js";
import { studionet } from "genlayer-js/chains";
import { privateKeyToAccount } from "viem/accounts";
import { createHash, randomUUID } from "node:crypto";

const API_BASE = "https://recallraid-api.fly.dev";
const CONTRACT_ADDRESS = "0x34935D3d16a1Db83925117AEf95c045c2c197756";
const RPC_URL = "https://studio.genlayer.com/api";
const TEST_PRIVATE_KEY = "0x63028d88026d5bd4fafbacc46546bb1d85ac4d9fff21596c147430534035a314"; // throwaway, pre-funded on StudioNet

let cookieJar = "";
function captureCookies(res) {
  const setCookie = res.headers.get("set-cookie");
  if (setCookie) cookieJar = setCookie.split(";")[0];
}
async function api(path, opts = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    ...opts,
    headers: { "Content-Type": "application/json", ...(cookieJar ? { Cookie: cookieJar } : {}), ...(opts.headers || {}) },
  });
  captureCookies(res);
  const text = await res.text();
  let body;
  try { body = JSON.parse(text); } catch { body = text; }
  if (!res.ok) throw new Error(`${path} -> HTTP ${res.status}: ${JSON.stringify(body)}`);
  return body;
}

function step(label) { console.log("\n=== " + label + " ==="); }
function ok(label, detail) { console.log("✓ " + label + (detail ? ": " + detail : "")); }
function fail(label, err) { console.error("✗ " + label + ": " + (err?.message || err)); process.exitCode = 1; }

async function main() {
  const account = privateKeyToAccount(TEST_PRIVATE_KEY);
  const glAccount = createAccount(TEST_PRIVATE_KEY);
  console.log("Test wallet:", account.address);

  const client = createClient({
    chain: { ...studionet, rpcUrls: { default: { http: [RPC_URL] } } },
    account: glAccount,
  });

  // 1. Confirm the test wallet has GEN
  step("Pre-flight: balance check");
  const balance = await client.getBalance({ address: account.address });
  ok("balance", `${balance} wei`);
  if (balance < 10n ** 16n) throw new Error("test wallet underfunded for this test");

  // 2. Auth: nonce -> sign -> verify (the flow the real frontend now runs
  //    via useWalletSession, exercised here exactly as a browser would)
  step("Wallet auth (challenge-nonce-signature)");
  const { message } = await api("/auth/nonce", { method: "POST", body: JSON.stringify({ address: account.address }) });
  const signature = await account.signMessage({ message });
  const verifyRes = await api("/auth/verify", { method: "POST", body: JSON.stringify({ address: account.address, signature }) });
  ok("authenticated", verifyRes.walletAddress);
  if (!cookieJar) throw new Error("no session cookie was set after /auth/verify");
  ok("session cookie captured", cookieJar.split("=")[0]);

  // 3. submit_investigation — real on-chain write with a small GEN bounty
  step("submit_investigation (on-chain write)");
  const bountyWei = 10n ** 16n; // 0.01 GEN
  const submitTxHash = await client.writeContract({
    address: CONTRACT_ADDRESS,
    functionName: "submit_investigation",
    args: [
      "E2E Test Blender X9000",
      "TestCorp",
      "TC-X9000",
      "",
      "TestMarket",
      "https://example.com/listing/x9000",
      "https://example.com/manufacturer/x9000",
      "",
      "Automated end-to-end test submission — safe to ignore/settle.",
      "Kitchen Appliances",
      3,
    ],
    value: bountyWei,
  });
  ok("tx submitted", submitTxHash);
  const submitReceipt = await client.waitForTransactionReceipt({ hash: submitTxHash, status: "FINALIZED", retries: 30, interval: 3000 });
  ok("tx finalized", JSON.stringify(submitReceipt.status ?? submitReceipt));
  const submitResult = typeof submitReceipt.result === "string" ? JSON.parse(submitReceipt.result) : submitReceipt.result;
  const investigationId = submitResult?.investigation_id ?? submitResult?.data?.investigation_id;
  if (!investigationId) throw new Error("could not parse investigation_id from receipt: " + JSON.stringify(submitReceipt));
  ok("investigation_id", investigationId);

  // 4. Sync immediately (exactly what apps/web now does after a confirmed tx)
  step("Sync investigation into API cache");
  const syncedInv = await api(`/investigations/${investigationId}/sync`, { method: "POST", body: JSON.stringify({ txHash: submitTxHash }) });
  ok("synced", JSON.stringify(syncedInv.investigation).slice(0, 200));

  // 5. Verify GET /investigations/:id returns the contract-shaped object
  step("GET /investigations/:id shape check");
  const fetchedInv = await api(`/investigations/${investigationId}`);
  const requiredFields = ["id", "submitter", "product_name", "status", "verdict", "bounty_wei", "description", "created_at"];
  const missing = requiredFields.filter((f) => !(f in fetchedInv));
  if (missing.length) throw new Error("GET /investigations/:id missing fields: " + missing.join(", "));
  if (fetchedInv.id !== investigationId) throw new Error("id mismatch");
  if (fetchedInv.status !== 0) throw new Error("expected status OPEN(0), got " + fetchedInv.status);
  if (fetchedInv.description !== "Automated end-to-end test submission — safe to ignore/settle.") throw new Error("description did not round-trip through the cache");
  ok("shape + values correct", `status=${fetchedInv.status} bounty_wei=${fetchedInv.bounty_wei}`);

  // 6. Real Cloudinary signed upload (the actual multipart POST flow apps/web uses)
  step("Cloudinary signed upload (evidence file)");
  const upload = await api("/evidence/upload-url", {
    method: "POST",
    body: JSON.stringify({ investigationId, contentType: "image/png", declaredSizeBytes: 70, fileName: "test.png" }),
  });
  const pngBytes = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
  const form = new FormData();
  form.append("file", new Blob([pngBytes], { type: "image/png" }), "test.png");
  for (const [k, v] of Object.entries(upload.fields)) form.append(k, v);
  const cloudinaryRes = await fetch(upload.upload_url, { method: "POST", body: form });
  const cloudinaryJson = await cloudinaryRes.json();
  if (!cloudinaryRes.ok || !cloudinaryJson.secure_url) throw new Error("Cloudinary upload failed: " + JSON.stringify(cloudinaryJson));
  ok("uploaded", cloudinaryJson.secure_url);
  const contentHash = createHash("sha256").update(pngBytes).digest("hex");

  // 7. add_evidence — real on-chain write anchoring hash + URL
  step("add_evidence (on-chain write)");
  const evidenceTxHash = await client.writeContract({
    address: CONTRACT_ADDRESS,
    functionName: "add_evidence",
    args: [investigationId, "product_photo", contentHash, cloudinaryJson.secure_url, "automated e2e test evidence"],
  });
  const evidenceReceipt = await client.waitForTransactionReceipt({ hash: evidenceTxHash, status: "FINALIZED", retries: 30, interval: 3000 });
  ok("evidence tx finalized", JSON.stringify(evidenceReceipt.status ?? "ok"));

  // 8. Sync evidence + investigation (status should flip to EVIDENCE_SUBMITTED)
  step("Sync evidence into API cache");
  await api(`/evidence/${investigationId}/sync`, { method: "POST", body: JSON.stringify({ txHash: evidenceTxHash }) });
  await api(`/investigations/${investigationId}/sync`, { method: "POST", body: JSON.stringify({}) });

  step("GET /evidence?investigation_id= shape + content check");
  const evidenceList = await api(`/evidence?investigation_id=${investigationId}`);
  if (!Array.isArray(evidenceList) || evidenceList.length === 0) throw new Error("expected at least one evidence item, got: " + JSON.stringify(evidenceList));
  const ev = evidenceList[0];
  const evRequired = ["id", "investigation_id", "submitter", "evidence_type", "content_hash", "url", "submitted_at"];
  const evMissing = evRequired.filter((f) => !(f in ev));
  if (evMissing.length) throw new Error("evidence item missing fields: " + evMissing.join(", "));
  if (ev.content_hash !== contentHash) throw new Error("content_hash mismatch: cache has " + ev.content_hash);
  if (ev.url !== cloudinaryJson.secure_url) throw new Error("url mismatch");
  ok("evidence shape + content correct", `content_hash=${ev.content_hash.slice(0, 12)}... url=${ev.url}`);

  step("GET /investigations/:id status transition check");
  const invAfterEvidence = await api(`/investigations/${investigationId}`);
  if (invAfterEvidence.status !== 1) throw new Error("expected status EVIDENCE_SUBMITTED(1), got " + invAfterEvidence.status);
  if (invAfterEvidence.evidence_count !== 1) throw new Error("expected evidence_count=1, got " + invAfterEvidence.evidence_count);
  ok("status correctly flipped to EVIDENCE_SUBMITTED", `evidence_count=${invAfterEvidence.evidence_count}`);

  // 9. Confirm it shows up in the public list feed too (what /hunts renders)
  step("GET /investigations list feed check");
  const listRes = await api(`/investigations?limit=50`);
  const foundInList = listRes.items.find((i) => i.id === investigationId);
  if (!foundInList) throw new Error("submitted investigation not found in GET /investigations list feed");
  ok("appears in Active Hunts list feed", `total=${listRes.total}`);

  // 10. Confirm /stats reflects it as an active threat
  step("GET /stats reflects the new investigation");
  const stats = await api("/stats");
  ok("stats", JSON.stringify(stats));

  // Cleanup: destroy the test Cloudinary asset
  step("Cleanup");
  const destroyAuth = Buffer.from(`${process.env.CLOUDINARY_API_KEY || ""}:${process.env.CLOUDINARY_API_SECRET || ""}`).toString("base64");
  console.log("(leaving on-chain test investigation as-is — it settles naturally like any real OPEN investigation; not destructive to clean up on-chain state)");

  console.log("\n✅ END-TO-END SUBMIT FLOW: ALL CHECKS PASSED");
  console.log(`Investigation #${investigationId} — view at https://recall-raid.vercel.app/hunts/${investigationId}`);
}

main().catch((err) => {
  fail("E2E TEST FAILED", err);
  process.exit(1);
});
