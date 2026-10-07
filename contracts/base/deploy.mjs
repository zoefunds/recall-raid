#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import solc from "solc";
import { ethers } from "ethers";

const here = path.dirname(fileURLToPath(import.meta.url));
const required = (name) => {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
};

const source = fs.readFileSync(path.join(here, "RecallRaidEscrow.sol"), "utf8");
const input = {
  language: "Solidity",
  sources: { "RecallRaidEscrow.sol": { content: source } },
  settings: {
    optimizer: { enabled: true, runs: 200 },
    outputSelection: { "*": { "*": ["abi", "evm.bytecode.object"] } },
  },
};
const output = JSON.parse(solc.compile(JSON.stringify(input)));
for (const diagnostic of output.errors ?? []) {
  const destination = diagnostic.severity === "error" ? console.error : console.warn;
  destination(diagnostic.formattedMessage);
}
if ((output.errors ?? []).some((item) => item.severity === "error")) process.exit(1);

const artifact = output.contracts["RecallRaidEscrow.sol"].RecallRaidEscrow;
const rpcUrl = process.env.BASE_SEPOLIA_RPC_URL || "https://sepolia.base.org";
const usdc = process.env.BASE_SEPOLIA_USDC_ADDRESS || "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
const privateKey = required("DEPLOYER_PRIVATE_KEY");
const relayer = process.env.RELAYER_ADDRESS || new ethers.Wallet(privateKey).address;
const provider = new ethers.JsonRpcProvider(rpcUrl);
const wallet = new ethers.Wallet(privateKey, provider);

console.log(`Deploying RecallRaidEscrow from ${wallet.address} on Base Sepolia`);
const factory = new ethers.ContractFactory(artifact.abi, artifact.evm.bytecode.object, wallet);
const contract = await factory.deploy(usdc, relayer);
console.log(`Deployment transaction: ${contract.deploymentTransaction().hash}`);
await contract.waitForDeployment();
console.log(`RECALLRAID_ESCROW_ADDRESS=${await contract.getAddress()}`);
console.log(`BASE_SEPOLIA_USDC_ADDRESS=${usdc}`);
console.log(`RELAYER_ADDRESS=${relayer}`);
