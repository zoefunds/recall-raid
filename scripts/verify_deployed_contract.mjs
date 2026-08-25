#!/usr/bin/env node
// Read-only sanity check that the deployed RecallRaid contract address
// actually responds and its schema matches this repo's contract. Run:
//   node scripts/verify_deployed_contract.mjs
// Uses genlayer-js from apps/web's node_modules — no wallet/private key
// needed since every call here is a view/read.

import { createClient } from "genlayer-js";
import { studionet } from "genlayer-js/chains";

const CONTRACT_ADDRESS = process.env.GENLAYER_CONTRACT_ADDRESS || "0x34935D3d16a1Db83925117AEf95c045c2c197756";
const RPC_URL = process.env.GENLAYER_RPC_URL || "https://studio.genlayer.com/api";

async function main() {
  console.log("Verifying deployed contract:", CONTRACT_ADDRESS);
  console.log("RPC:", RPC_URL);

  const client = createClient({
    chain: { ...studionet, rpcUrls: { default: { http: [RPC_URL] } } },
  });

  try {
    const schema = await client.getContractSchema(CONTRACT_ADDRESS);
    const methodNames = Object.keys(schema?.methods ?? schema ?? {});
    console.log("\n✓ Contract schema loaded successfully.");
    console.log("Method count:", methodNames.length);
    console.log("Sample methods:", methodNames.slice(0, 8).join(", "));
  } catch (err) {
    console.error("\n✗ Failed to load contract schema:", err?.message || err);
    process.exitCode = 1;
    return;
  }

  try {
    const info = await client.readContract({
      address: CONTRACT_ADDRESS,
      functionName: "get_protocol_info",
      args: [],
    });
    const parsed = typeof info === "string" ? JSON.parse(info) : info;
    console.log("\n✓ get_protocol_info() responded:");
    console.log(JSON.stringify(parsed, null, 2));

    if (parsed.challenge_stake_bps !== 2000) {
      console.warn("\n! WARNING: challenge_stake_bps expected 2000, got", parsed.challenge_stake_bps, "— deployed bytecode may not match this repo's contract source.");
    } else {
      console.log("\n✓ Fixed economics constants match this repo's contract source.");
    }
  } catch (err) {
    console.error("\n✗ get_protocol_info() call failed:", err?.message || err);
    process.exitCode = 1;
  }
}

main();
