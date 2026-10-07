#!/usr/bin/env node
import { ethers } from "ethers";

const key = process.env.DEPLOYER_PRIVATE_KEY;
if (!key) throw new Error("DEPLOYER_PRIVATE_KEY is required");
const rpc = process.env.BASE_SEPOLIA_RPC_URL || "https://sepolia.base.org";
const escrowAddress = process.env.RECALLRAID_ESCROW_ADDRESS || "0xce45b80019A59C153659f014bC74900d930A6886";
const usdcAddress = process.env.BASE_SEPOLIA_USDC_ADDRESS || "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
const provider = new ethers.JsonRpcProvider(rpc);
const wallet = new ethers.Wallet(key, provider);
const usdc = new ethers.Contract(usdcAddress, [
  "function approve(address,uint256) returns (bool)",
  "function balanceOf(address) view returns (uint256)",
], wallet);
const escrow = new ethers.Contract(escrowAddress, [
  "function fundInvestigation(bytes32,uint256)",
  "function fundChallenge(bytes32,uint256)",
  "function fundSellerBond(bytes32,uint256)",
  "function linkSellerBond(bytes32,bytes32)",
  "function relayAdjudication(bytes32,uint8,address,bool,bytes32)",
  "function claim()",
  "function claimable(address) view returns (uint256)",
  "function getCase(bytes32) view returns ((address submitter,address challenger,address hunter,bytes32 sellerBondId,uint256 bounty,uint256 challengeStake,uint8 verdict,bool finalized,bytes32 genlayerDecisionHash))",
  "function getSellerBond(bytes32) view returns ((address seller,uint256 balance,uint256 totalDeposited,uint256 totalSlashed,uint256 linkedCases,bool withdrawn))",
], wallet);

async function confirmed(txPromise) {
  const tx = await txPromise;
  // Public Base Sepolia RPC nodes can briefly disagree immediately after a
  // block; two confirmations keep the next estimateGas call from reading a
  // stale allowance/claimable value from another backend.
  const receipt = await tx.wait(2);
  if (!receipt || receipt.status !== 1) throw new Error(`transaction failed: ${tx.hash}`);
  return tx.hash;
}

async function approveAnd(method, id, amount) {
  const approvalTx = await confirmed(usdc.approve(escrowAddress, amount));
  const fundingTx = await confirmed(escrow[method](id, amount));
  return { approvalTx, fundingTx };
}

const runId = new Date().toISOString();
const fixtures = [
  {
    slug: "fisher-price-rock-n-play-no-issue",
    title: "Fisher-Price Rock 'n Play Sleeper listing re-check",
    product: "Fisher-Price Rock 'n Play Sleeper",
    marketplace: "Independent resale listing",
    evidence: "CPSC recall notice 19-105 and listing identifiers were re-checked; this fixture exercises the NO_ISSUE refund route.",
    bounty: 500_000n,
    verdict: 1,
    challenge: 0n,
    challengeOverturned: false,
  },
  {
    slug: "peloton-tread-recall-confirmed",
    title: "Peloton Tread+ recall-confirmed seller-bond settlement",
    product: "Peloton Tread+ Treadmill",
    marketplace: "Second-hand fitness equipment listing",
    evidence: "CPSC recall 21-129 identifies the Tread+ hazard; this fixture exercises bounty payout plus a proportional seller-bond slash.",
    bounty: 750_000n,
    bond: 500_000n,
    verdict: 3,
    challenge: 0n,
    challengeOverturned: false,
  },
  {
    slug: "anker-power-bank-challenge-overturned",
    title: "Anker power-bank potential-issue challenged outcome",
    product: "Anker 535 Power Bank",
    marketplace: "Consumer electronics marketplace listing",
    evidence: "Model and serial evidence supports a potential battery-safety issue; this fixture exercises a funded challenge and overturned-stake return.",
    bounty: 600_000n,
    verdict: 2,
    challenge: 120_000n,
    challengeOverturned: true,
  },
];

const output = [];
const initialUsdc = await usdc.balanceOf(wallet.address);
for (let index = 0; index < fixtures.length; index += 1) {
  const item = fixtures[index];
  const caseId = ethers.id(`recallraid:e2e:${runId}:${item.slug}`);
  const funded = await approveAnd("fundInvestigation", caseId, item.bounty);
  let bond;
  if (item.bond) {
    const bondId = ethers.id(`recallraid:e2e:${runId}:bond:${item.slug}`);
    const bondFunding = await approveAnd("fundSellerBond", bondId, item.bond);
    const linkTx = await confirmed(escrow.linkSellerBond(caseId, bondId));
    bond = { bondId, amountUsdcBaseUnits: item.bond.toString(), ...bondFunding, linkTx };
  }
  let challenge;
  if (item.challenge) {
    const challengeFunding = await approveAnd("fundChallenge", caseId, item.challenge);
    challenge = { amountUsdcBaseUnits: item.challenge.toString(), ...challengeFunding };
  }
  const decisionHash = ethers.id(JSON.stringify({ runId, caseId, verdict: item.verdict, evidence: item.evidence }));
  const relayTx = await confirmed(escrow.relayAdjudication(caseId, item.verdict, wallet.address, item.challengeOverturned, decisionHash));
  const onchain = await escrow.getCase(caseId);
  const claimableBeforeClaim = await escrow.claimable(wallet.address);
  const claimTx = await confirmed(escrow.claim());
  output.push({
    number: index + 1,
    ...item,
    bounty: undefined,
    bond: bond ?? null,
    challenge: challenge ?? null,
    bountyUsdcBaseUnits: item.bounty.toString(),
    caseId,
    decisionHash,
    approvalTx: funded.approvalTx,
    fundingTx: funded.fundingTx,
    relayTx,
    claimTx,
    claimableBeforeClaimUsdcBaseUnits: claimableBeforeClaim.toString(),
    verifiedState: {
      submitter: onchain.submitter,
      hunter: onchain.hunter,
      verdict: Number(onchain.verdict),
      finalized: onchain.finalized,
      challengeStakeUsdcBaseUnits: onchain.challengeStake.toString(),
      genlayerDecisionHash: onchain.genlayerDecisionHash,
    },
  });
}

console.log(JSON.stringify({
  network: "Base Sepolia",
  chainId: 84532,
  runAt: runId,
  wallet: wallet.address,
  usdcAddress,
  escrowAddress,
  initialWalletUsdcBaseUnits: initialUsdc.toString(),
  finalWalletUsdcBaseUnits: (await usdc.balanceOf(wallet.address)).toString(),
  cases: output,
}, null, 2));
