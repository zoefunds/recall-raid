import { ethers } from "ethers";
import { config } from "./config.js";
import { ERC20_ABI, RECALLRAID_ESCROW_ABI } from "./escrow-abi.js";

let provider: ethers.JsonRpcProvider | undefined;
let relayerContract: ethers.Contract | undefined;

function getProvider() {
  provider ??= new ethers.JsonRpcProvider(config.baseSepolia.rpcUrl);
  return provider;
}

function getReadContract() {
  if (!config.baseSepolia.escrowAddress) throw new Error("RECALLRAID_ESCROW_ADDRESS is not configured");
  return new ethers.Contract(config.baseSepolia.escrowAddress, RECALLRAID_ESCROW_ABI, getProvider());
}

function getRelayerContract() {
  if (!config.baseSepolia.escrowAddress || !config.baseSepolia.relayerPrivateKey) {
    throw new Error("Base Sepolia escrow relayer is not configured");
  }
  relayerContract ??= new ethers.Contract(
    config.baseSepolia.escrowAddress,
    RECALLRAID_ESCROW_ABI,
    new ethers.Wallet(config.baseSepolia.relayerPrivateKey, getProvider()),
  );
  return relayerContract;
}

export function caseIdToBytes32(caseId: string) {
  return caseId.startsWith("0x") && caseId.length === 66 ? caseId : ethers.id(caseId);
}

export async function getCaseEscrow(caseId: string) {
  const item = await getReadContract().getCase(caseIdToBytes32(caseId));
  return {
    submitter: item.submitter as string,
    challenger: item.challenger as string,
    hunter: item.hunter as string,
    sellerBondId: item.sellerBondId as string,
    bountyUsdcBaseUnits: (item.bounty as bigint).toString(),
    challengeStakeUsdcBaseUnits: (item.challengeStake as bigint).toString(),
    verdict: Number(item.verdict),
    finalized: item.finalized as boolean,
    genlayerDecisionHash: item.genlayerDecisionHash as string,
  };
}

export async function getClaimable(address: string) {
  return ((await getReadContract().claimable(address)) as bigint).toString();
}

export async function getWalletUsdcBalance(address: string) {
  const token = new ethers.Contract(config.baseSepolia.usdcAddress, ERC20_ABI, getProvider());
  return ((await token.balanceOf(address)) as bigint).toString();
}

export async function relayAdjudication(input: {
  caseId: string;
  verdict: number;
  hunter: string;
  challengeOverturned: boolean;
  decisionHash: string;
}) {
  const tx = await getRelayerContract().relayAdjudication(
    caseIdToBytes32(input.caseId),
    input.verdict,
    input.hunter,
    input.challengeOverturned,
    input.decisionHash,
  );
  const receipt = await tx.wait();
  if (!receipt || receipt.status !== 1) throw new Error("Base Sepolia adjudication relay failed");
  return tx.hash as string;
}

export async function relayCancellation(caseId: string, decisionHash: string) {
  const tx = await getRelayerContract().relayCancellation(caseIdToBytes32(caseId), decisionHash);
  const receipt = await tx.wait();
  if (!receipt || receipt.status !== 1) throw new Error("Base Sepolia cancellation relay failed");
  return tx.hash as string;
}

export function isBaseEscrowConfigured() {
  return Boolean(config.baseSepolia.escrowAddress);
}
