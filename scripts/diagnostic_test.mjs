#!/usr/bin/env node
// Runs the three minimal nondet-consensus controls in
// contracts/diagnostics/nondet_consensus_diagnostic.py against a deployed
// instance, and prints a compact evidence report (per-check
// consensus_data.result_name plus every node's receipt) suitable for
// pasting into a GenLayer support/Discord report or into memory.md.
//
// Usage: CONTRACT_ADDRESS=0x... node scripts/diagnostic_test.mjs
// (defaults to the address below if the env var isn't set)

import { createClient, createAccount } from "genlayer-js";
import { studionet } from "genlayer-js/chains";

const CONTRACT_ADDRESS = process.env.CONTRACT_ADDRESS || "PASTE_DEPLOYED_DIAGNOSTIC_CONTRACT_ADDRESS_HERE";
const RPC_URL = process.env.GENLAYER_RPC_URL || "https://studio.genlayer.com/api";
// Any funded StudioNet test wallet works — this contract moves no value.
const PRIVATE_KEY = process.env.PRIVATE_KEY || "0x63028d88026d5bd4fafbacc46546bb1d85ac4d9fff21596c147430534035a314";

function decodeLeaderResult(leaderReceipt) {
  const payload = leaderReceipt?.result?.payload;
  if (!payload) return undefined;
  if (typeof payload === "string") return payload; // rollback case: plain string message
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

async function run(client, functionName) {
  const txHash = await client.writeContract({ address: CONTRACT_ADDRESS, functionName, args: [] });
  const receipt = await client.waitForTransactionReceipt({ hash: txHash, status: "FINALIZED", retries: 120, interval: 5000 });
  const nodes = receipt.consensus_data?.leader_receipt ?? [];
  return { txHash, resultName: receipt.result_name, statusName: receipt.status_name, nodes };
}

function summarizeNode(n) {
  return {
    mode: n.mode,
    execution_result: n.execution_result,
    result: n.result,
    stderr: n.genvm_result?.stderr,
  };
}

async function main() {
  if (CONTRACT_ADDRESS.startsWith("PASTE_")) {
    console.error("Set CONTRACT_ADDRESS to the deployed diagnostic contract's address (env var or edit this file).");
    process.exit(1);
  }
  const account = createAccount(PRIVATE_KEY);
  const client = createClient({
    chain: { ...studionet, rpcUrls: { default: { http: [RPC_URL] } } },
    account,
  });

  const report = { contract: CONTRACT_ADDRESS, rpc: RPC_URL, checks: {} };

  for (const fn of ["check_constant", "check_web_fetch", "check_web_get_raw", "check_web_request_raw", "check_llm_classification"]) {
    process.stdout.write(`Running ${fn}...\n`);
    const res = await run(client, fn);
    report.checks[fn] = {
      txHash: res.txHash,
      resultName: res.resultName,
      statusName: res.statusName,
      nodes: res.nodes.map(summarizeNode),
    };
    console.log(`  tx=${res.txHash}`);
    console.log(`  result_name=${res.resultName}`);
    for (const n of res.nodes) {
      console.log(`  -- ${n.mode}: execution_result=${n.execution_result} result=${JSON.stringify(decodeLeaderResult(n))}`);
    }
    console.log("");
  }

  console.log("======== FULL REPORT (paste this into a GenLayer support/Discord message) ========");
  console.log(JSON.stringify(report, null, 2));
}

main().catch((err) => {
  console.error("SCRIPT ERROR:", err);
  process.exit(1);
});
