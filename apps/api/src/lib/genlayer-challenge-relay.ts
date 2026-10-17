import { ethers } from "ethers";
import { createAccount, createClient } from "genlayer-js";
import { studionet } from "genlayer-js/chains";
import { config } from "./config.js";
import { chain, getTransactionStatus } from "./genlayer.js";
import { syncChallenge, syncInvestigation } from "./sync.js";
import { assertGenLayerCall, assertGenLayerTransactionIdentity, assertSuccessfulFinalizedGenVmExecution } from "./settlement-validation.js";

function getChallengeRelayer() {
  if (!config.baseSepolia.relayerPrivateKey) throw new Error("The GenLayer challenge relayer is not configured");
  const account = createAccount(config.baseSepolia.relayerPrivateKey as `0x${string}`);
  const wallet = new ethers.Wallet(config.baseSepolia.relayerPrivateKey);
  const rpcUrl = config.genlayer.rpcUrl || "https://studio.genlayer.com/api";
  const client = createClient({
    chain: { ...studionet, rpcUrls: { default: { http: [rpcUrl] } } },
    account,
  });
  return { address: wallet.address, client };
}

export async function submitFundedChallenge(input: {
  investigationId: number;
  challenger: string;
  reason: string;
  stake: string;
  baseTxHash: string;
}) {
  const { address, client } = getChallengeRelayer();
  const protocol = await chain.getProtocolInfo();
  if (protocol.admin.toLowerCase() !== address.toLowerCase()) {
    throw new Error("Configured challenge relayer is not the deployed GenLayer admin");
  }
  const investigation = await chain.getInvestigation(input.investigationId);
  if (investigation.open_challenge_id > 0) {
    const existing = await chain.getChallenge(investigation.open_challenge_id);
    if (existing.status === 1
      && existing.challenger.toLowerCase() === input.challenger.toLowerCase()
      && existing.base_tx_hash.toLowerCase() === input.baseTxHash.toLowerCase()
      && existing.stake_wei === input.stake) {
      return { txHash: null, challengeId: existing.id, alreadyOpen: true };
    }
    throw new Error("A different challenge already occupies this investigation's challenge slot");
  }

  const txHash = await client.writeContract({
    address: config.genlayer.contractAddress as `0x${string}`,
    functionName: "open_challenge",
    args: [input.investigationId, input.challenger, input.reason, BigInt(input.stake), input.baseTxHash],
    value: 0n,
  });
  return { txHash, challengeId: null, alreadyOpen: false };
}

export async function confirmFundedChallenge(input: {
  txHash: string;
  investigationId: number;
  challenger: string;
  reason: string;
  stake: string;
  baseTxHash: string;
}) {
  const transaction = await getTransactionStatus(input.txHash);
  const status = String(transaction.statusName ?? "").toUpperCase();
  if (status !== "FINALIZED") return { status: "pending" as const };

  assertSuccessfulFinalizedGenVmExecution(transaction);
  assertGenLayerTransactionIdentity({
    transaction,
    expectedContract: config.genlayer.contractAddress,
    // Do not compare with today's admin address here. A valid finalized
    // open_challenge may predate an admin rotation; the contract's admin gate
    // already enforced the caller at execution time. Exact calldata and the
    // resulting funded challenge record are checked below.
  });
  assertGenLayerCall({
    transaction,
    method: "open_challenge",
    args: [input.investigationId, input.challenger, input.reason, BigInt(input.stake), input.baseTxHash],
  });

  const investigation = await chain.getInvestigation(input.investigationId);
  if (investigation.status !== 4 || investigation.open_challenge_id <= 0) {
    throw new Error("Successful challenge transaction did not create an open challenge");
  }
  const challenge = await chain.getChallenge(investigation.open_challenge_id);
  if (challenge.status !== 1
    || challenge.investigation_id !== input.investigationId
    || challenge.challenger.toLowerCase() !== input.challenger.toLowerCase()
    || challenge.base_tx_hash.toLowerCase() !== input.baseTxHash.toLowerCase()
    || challenge.stake_wei !== input.stake
    || challenge.stake_deposited_wei !== input.stake) {
    throw new Error("Finalized GenLayer challenge does not match the authenticated Base-funded request");
  }
  await syncChallenge(challenge.id);
  await syncInvestigation(input.investigationId);
  return { status: "confirmed" as const, challengeId: challenge.id };
}
