#!/usr/bin/env node
// Finish the live StudioNet/Base Sepolia challenge E2E after its seven-day
// challenge deadline. Settlement is executed only from finalized GenLayer
// state and relayed by the hosted decision signer.

import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { ethers } from "ethers";
import { createAccount, createClient } from "genlayer-js";
import { studionet } from "genlayer-js/chains";

const genlayerRpc = process.env.GENLAYER_RPC_URL || "https://studio.genlayer.com/api";
const genlayerAddress = process.env.GENLAYER_CONTRACT_ADDRESS;
const baseRpc = process.env.BASE_SEPOLIA_RPC_URL || "https://sepolia.base.org";
const escrowAddress = process.env.RECALLRAID_ESCROW_ADDRESS;
const usdcAddress = process.env.BASE_SEPOLIA_USDC_ADDRESS || "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
const apiBase = process.env.RECALLRAID_API_BASE_URL || "https://recallraid-usdc-api.fly.dev";
const origin = process.env.RECALLRAID_E2E_ORIGIN || "https://recall-raid.vercel.app";
const submitterKey = process.env.BASE_SEPOLIA_RELAYER_PRIVATE_KEY;
const challengerKeyFile = process.env.RECALLRAID_CHALLENGER_KEY_FILE || "/private/tmp/recallraid-challenger-key.json";
const reportPath = process.env.RECALLRAID_E2E_REPORT || "docs/e2e-evidence/studionet-base-valid-challenge-e2e.json";
const caseId = process.env.RECALLRAID_E2E_CASE_ID || "0x010e6a1d581e35182fc4385350d449c2c34e068d36bc63fa8deb8bd5c483a51c";
const investigationId = Number(process.env.RECALLRAID_E2E_INVESTIGATION_ID || 3);
if (!genlayerAddress || !escrowAddress || !submitterKey) throw new Error("Deployment addresses and submitter key are required");

const challengerKey = JSON.parse(readFileSync(challengerKeyFile, "utf8")).privateKey;
const provider = new ethers.JsonRpcProvider(baseRpc);
const submitter = new ethers.Wallet(submitterKey, provider);
const challenger = new ethers.Wallet(challengerKey, provider);
const token = new ethers.Contract(usdcAddress, ["function balanceOf(address) view returns (uint256)"], provider);
const escrow = new ethers.Contract(escrowAddress, [
  "function getCase(bytes32) view returns ((address submitter,address challenger,address hunter,bytes32 sellerBondId,uint256 bounty,uint256 challengeStake,uint8 verdict,bool finalized,bytes32 genlayerDecisionHash,uint64 fundedAt,bool registered,address genlayerContract,uint32 genlayerInvestigationId))",
  "function getChallengeDeposit(bytes32,address) view returns ((uint256 amount,uint64 fundedAt))",
  "function claimable(address) view returns (uint256)",
  "function claim()",
  "event AdjudicationRelayed(bytes32 indexed caseId,uint8 verdict,address indexed hunter,bytes32 decisionHash)",
  "event Claimed(address indexed account,uint256 amount)",
], submitter);
const glChain = { ...studionet, rpcUrls: { default: { http: [genlayerRpc] } } };
const glClient = createClient({ chain: glChain, account: createAccount(submitterKey) });

async function glRead(method, args) {
  const value = await glClient.readContract({ address: genlayerAddress, functionName: method, args });
  return typeof value === "string" ? JSON.parse(value) : value;
}

async function glWrite(method, args) {
  const hash = await glClient.writeContract({ address: genlayerAddress, functionName: method, args, value: 0n });
  console.error(`GenLayer ${method}: ${hash}`);
  const receipt = await glClient.waitForTransactionReceipt({ hash, status: "FINALIZED", retries: 180, interval: 5000 });
  const status = String(receipt.status_name ?? receipt.statusName ?? "").toUpperCase();
  const consensus = String(receipt.result_name ?? receipt.resultName ?? "").toUpperCase();
  const leader = receipt.consensus_data?.leader_receipt?.find((entry) => entry?.mode === "leader");
  const execution = String(leader?.execution_result ?? "").toUpperCase();
  const returnStatus = String(leader?.result?.status ?? "").toLowerCase();
  if (status !== "FINALIZED" || !["AGREE", "MAJORITY_AGREE"].includes(consensus)
    || execution !== "SUCCESS" || returnStatus !== "return") {
    throw new Error(`GenLayer ${method} was not a successful finalized execution: ${status}/${consensus}/${execution}/${returnStatus}`);
  }
  return { txHash: hash, status, consensus, execution: "FINISHED_WITH_RETURN" };
}

async function authenticate() {
  const nonce = await fetch(`${apiBase}/auth/nonce`, {
    method: "POST", headers: { "content-type": "application/json", origin },
    body: JSON.stringify({ address: submitter.address }),
  });
  if (!nonce.ok) throw new Error(`Hosted API nonce failed (${nonce.status})`);
  const { message } = await nonce.json();
  const verified = await fetch(`${apiBase}/auth/verify`, {
    method: "POST", headers: { "content-type": "application/json", origin },
    body: JSON.stringify({ address: submitter.address, signature: await submitter.signMessage(message) }),
  });
  if (!verified.ok) throw new Error(`Hosted API wallet auth failed (${verified.status})`);
  const cookie = verified.headers.getSetCookie?.()[0]?.split(";", 1)[0] ?? verified.headers.get("set-cookie")?.split(";", 1)[0];
  if (!cookie) throw new Error("Hosted API did not issue an authenticated session cookie");
  return cookie;
}

async function apiPost(path, body, cookie) {
  const response = await fetch(`${apiBase}${path}`, {
    method: "POST", headers: { "content-type": "application/json", origin, cookie },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`Hosted API ${path} failed (${response.status}): ${text}`);
  return text ? JSON.parse(text) : {};
}

async function hasSettlementEvent(receipt) {
  if (!receipt || receipt.status !== 1) return false;
  return receipt.logs.some((log) => {
    if (log.address.toLowerCase() !== escrowAddress.toLowerCase()) return false;
    try {
      const parsed = escrow.interface.parseLog(log);
      return parsed.name === "AdjudicationRelayed"
        && parsed.args.caseId.toLowerCase() === caseId.toLowerCase()
        && Number(parsed.args.verdict) === 2;
    } catch { return false; }
  });
}

async function findSettlementReceipt(candidateHash, fromBlock) {
  if (/^0x[a-fA-F0-9]{64}$/.test(candidateHash ?? "")) {
    const candidate = await provider.getTransactionReceipt(candidateHash);
    if (await hasSettlementEvent(candidate)) return candidate;
  }
  const latest = await provider.getBlockNumber();
  for (let end = latest; end >= Math.max(fromBlock, latest - 10_000); end -= 200) {
    const start = Math.max(fromBlock, end - 199);
    const logs = await provider.getLogs({
      address: escrowAddress,
      topics: escrow.interface.encodeFilterTopics("AdjudicationRelayed", [caseId]),
      fromBlock: start,
      toBlock: end,
    });
    for (const log of logs.reverse()) {
      const receipt = await provider.getTransactionReceipt(log.transactionHash);
      if (await hasSettlementEvent(receipt)) return receipt;
    }
  }
  throw new Error("Could not find a successful Base AdjudicationRelayed event for the case");
}

async function findClaimReceipt(wallet, amount, fromBlock) {
  const latest = await provider.getBlockNumber();
  for (let end = latest; end >= Math.max(fromBlock, latest - 10_000); end -= 200) {
    const start = Math.max(fromBlock, end - 199);
    const logs = await provider.getLogs({
      address: escrowAddress,
      topics: escrow.interface.encodeFilterTopics("Claimed", [wallet]),
      fromBlock: start,
      toBlock: end,
    });
    for (const log of logs.reverse()) {
      const parsed = escrow.interface.parseLog(log);
      if (parsed.args.amount !== amount) continue;
      const receipt = await provider.getTransactionReceipt(log.transactionHash);
      if (receipt?.status === 1) return receipt;
    }
  }
  return null;
}

const report = JSON.parse(readFileSync(resolve(reportPath), "utf8"));
if (report.progress?.complete === true) {
  console.log(`Settlement E2E already completed: ${report.settlement?.relayTxHash ?? "recorded in report"}`);
  process.exit(0);
}
if (report.case.caseId.toLowerCase() !== caseId.toLowerCase()
  || Number(report.case.investigationId) !== investigationId) {
  throw new Error("Evidence report does not match the requested case and investigation");
}
if (report.genlayer?.challengeResolution?.overturned !== true) {
  throw new Error("This settlement runner only accepts the recorded successful overturned-challenge case");
}
const reportedDeadline = Number(report.settlement?.readyAfterUnix);
if (!Number.isFinite(reportedDeadline) || reportedDeadline <= 0) {
  throw new Error("The evidence report has no verified seven-day settlement deadline");
}
if (Math.floor(Date.now() / 1000) < reportedDeadline) {
  throw new Error(`Seven-day challenge window is open until ${new Date(reportedDeadline * 1000).toISOString()}`);
}

const investigation = await glRead("get_investigation", [investigationId]);
if (investigation.base_case_id.toLowerCase() !== caseId.toLowerCase()
  || investigation.submitter.toLowerCase() !== submitter.address.toLowerCase()
  || Number(investigation.last_challenge_id) !== Number(report.genlayer.challenge.id)
  || Number(investigation.open_challenge_id) !== 0
  || Number(investigation.verdict) !== 2) {
  throw new Error("Live GenLayer case no longer matches the report’s bound, overturned POTENTIAL_ISSUE case");
}
const challenge = await glRead("get_challenge", [investigation.last_challenge_id]);
if (Number(challenge.status) !== 3 || challenge.challenger.toLowerCase() !== challenger.address.toLowerCase()
  || challenge.base_tx_hash.toLowerCase() !== report.base.challengeFundingTx.toLowerCase()) {
  throw new Error("Finalized GenLayer challenge does not match the funded challenger receipt");
}

let settlementWrite = null;
if (!investigation.settled) {
  const deadline = Number(investigation.challenge_deadline);
  const now = Math.floor(Date.now() / 1000);
  if (now < deadline) throw new Error(`Seven-day challenge window is open until ${new Date(deadline * 1000).toISOString()}`);
  settlementWrite = await glWrite("settle_investigation", [investigationId]);
} else {
  const recorded = report.genlayer.settlement?.txHash || process.env.RECALLRAID_E2E_SETTLEMENT_TX;
  if (!recorded) throw new Error("Case is already settled; supply its successful settle_investigation transaction hash");
  settlementWrite = {
    txHash: recorded,
    status: "FINALIZED",
    consensus: "verified from finalized state",
    execution: "verified from finalized state",
  };
}
report.progress = { stage: "genlayer-settled-awaiting-base-relay", complete: false };
report.genlayer.settlement = settlementWrite;
writeFileSync(resolve(reportPath), `${JSON.stringify(report, null, 2)}\n`);

const cookie = await authenticate();
const synced = await apiPost(`/investigations/${investigationId}/sync`, { txHash: settlementWrite.txHash }, cookie);
if (!synced.investigation?.settled) throw new Error("Hosted API did not cache the finalized GenLayer settlement");
report.api.authenticatedSettlementSync = { investigationSettled: synced.investigation.settled, terminalGenVmTxHash: settlementWrite.txHash };
report.progress = { stage: "genlayer-settled-awaiting-base-relay", complete: false };
writeFileSync(resolve(reportPath), `${JSON.stringify(report, null, 2)}\n`);
const relay = await apiPost(`/investigations/${investigationId}/relay`, {}, cookie);
if (!relay.relayed) throw new Error("Hosted decision signer/relayer did not confirm Base settlement");
report.api.baseRelay = relay;
report.progress = { stage: "base-settled-awaiting-wallet-withdrawals", complete: false };
writeFileSync(resolve(reportPath), `${JSON.stringify(report, null, 2)}\n`);

const caseState = await escrow.getCase(caseId);
if (!caseState.finalized || Number(caseState.verdict) !== 2
  || !caseState.registered
  || caseState.submitter.toLowerCase() !== submitter.address.toLowerCase()
  || caseState.bounty !== BigInt(report.case.bountyUsdcBaseUnits)
  || caseState.genlayerContract.toLowerCase() !== genlayerAddress.toLowerCase()
  || Number(caseState.genlayerInvestigationId) !== investigationId) {
  throw new Error("Base escrow final state does not match the settled GenLayer investigation");
}
if (caseState.challenger.toLowerCase() !== challenger.address.toLowerCase()
  || caseState.challengeStake !== BigInt(challenge.stake_deposited_wei)) {
  throw new Error("Base settlement did not preserve the funded challenger and exact stake");
}
const hunter = caseState.hunter;
if (hunter === ethers.ZeroAddress || hunter.toLowerCase() !== submitter.address.toLowerCase()) {
  throw new Error("Base hunter payout recipient is not the first-evidence submitter recorded in the live case");
}
if (challenger.address.toLowerCase() === hunter.toLowerCase()) throw new Error("The challenger and hunter must be distinct wallets for withdrawal accounting");
const relayReceipt = await findSettlementReceipt(relay.relayTxHash, Number(report.base.bountyFunding.blockNumber));
const relayLog = relayReceipt.logs.map((log) => {
  if (log.address.toLowerCase() !== escrowAddress.toLowerCase()) return null;
  try { return escrow.interface.parseLog(log); } catch { return null; }
}).find((log) => log?.name === "AdjudicationRelayed" && log.args.caseId.toLowerCase() === caseId.toLowerCase());
if (!relayLog || relayLog.args.hunter.toLowerCase() !== hunter.toLowerCase()
  || relayLog.args.decisionHash.toLowerCase() !== caseState.genlayerDecisionHash.toLowerCase()) {
  throw new Error("Base settlement event does not match the finalized hunter and decision hash");
}

const expected = new Map([
  [challenger.address.toLowerCase(), BigInt(challenge.stake_deposited_wei)],
  [hunter.toLowerCase(), BigInt(caseState.bounty)],
]);
const withdrawals = report.settlement?.withdrawals ? [...report.settlement.withdrawals] : [];
for (const wallet of [challenger, submitter]) {
  const expectedAmount = expected.get(wallet.address.toLowerCase());
  if (expectedAmount === undefined) throw new Error(`Unexpected withdrawal wallet ${wallet.address}`);
  const priorWithdrawal = withdrawals.find((item) => item.wallet.toLowerCase() === wallet.address.toLowerCase());
  const beforeBalance = await token.balanceOf(wallet.address);
  const claimable = await escrow.claimable(wallet.address);
  if (priorWithdrawal) {
    if (claimable !== 0n || priorWithdrawal.amount !== expectedAmount.toString()) {
      throw new Error(`Previously recorded withdrawal does not match current claim state for ${wallet.address}`);
    }
    const priorReceipt = await provider.getTransactionReceipt(priorWithdrawal.txHash);
    const priorClaimed = priorReceipt?.status === 1 && priorReceipt.logs.some((log) => {
      if (log.address.toLowerCase() !== escrowAddress.toLowerCase()) return false;
      try {
        const parsed = escrow.interface.parseLog(log);
        return parsed.name === "Claimed" && parsed.args.account.toLowerCase() === wallet.address.toLowerCase()
          && parsed.args.amount === expectedAmount;
      } catch { return false; }
    });
    if (!priorClaimed || beforeBalance < BigInt(priorWithdrawal.afterBalance)) {
      throw new Error(`Previously recorded Base withdrawal cannot be verified for ${wallet.address}`);
    }
    continue;
  }
  if (claimable === 0n) {
    const priorReceipt = await findClaimReceipt(wallet.address, expectedAmount, relayReceipt.blockNumber);
    if (!priorReceipt) throw new Error(`No claimable USDC or matching prior Claimed event exists for ${wallet.address}`);
    const beforeBalance = await token.balanceOf(wallet.address, { blockTag: priorReceipt.blockNumber - 1 });
    const afterBalance = await token.balanceOf(wallet.address, { blockTag: priorReceipt.blockNumber });
    if (afterBalance - beforeBalance !== expectedAmount) {
      throw new Error(`Recovered withdrawal block does not show the exact USDC balance increase for ${wallet.address}`);
    }
    withdrawals.push({ wallet: wallet.address, amount: expectedAmount.toString(), beforeBalance: beforeBalance.toString(), afterBalance: afterBalance.toString(), txHash: priorReceipt.hash });
    report.settlement = { ...(report.settlement ?? {}), withdrawals };
    report.progress = { stage: "base-settled-wallet-withdrawal-in-progress", complete: false };
    writeFileSync(resolve(reportPath), `${JSON.stringify(report, null, 2)}\n`);
    continue;
  }
  if (claimable !== expectedAmount) throw new Error(`Unexpected claimable amount for ${wallet.address}: ${claimable}`);
  const tx = await escrow.connect(wallet).claim();
  const receipt = await tx.wait(1);
  if (!receipt || receipt.status !== 1) throw new Error(`USDC withdrawal failed: ${tx.hash}`);
  const afterBalance = await token.balanceOf(wallet.address);
  const remainingClaimable = await escrow.claimable(wallet.address);
  if (afterBalance - beforeBalance !== expectedAmount || remainingClaimable !== 0n) {
    throw new Error(`USDC wallet balance did not increase by the exact settlement amount for ${wallet.address}`);
  }
  const claimed = receipt.logs.some((log) => {
    if (log.address.toLowerCase() !== escrowAddress.toLowerCase()) return false;
    try {
      const parsed = escrow.interface.parseLog(log);
      return parsed.name === "Claimed" && parsed.args.account.toLowerCase() === wallet.address.toLowerCase()
        && parsed.args.amount === expectedAmount;
    } catch { return false; }
  });
  if (!claimed) throw new Error(`Base claim receipt lacks the expected Claimed event for ${wallet.address}`);
  withdrawals.push({ wallet: wallet.address, amount: expectedAmount.toString(), beforeBalance: beforeBalance.toString(), afterBalance: afterBalance.toString(), txHash: tx.hash });
  report.settlement = { ...(report.settlement ?? {}), withdrawals };
  report.progress = { stage: "base-settled-wallet-withdrawal-in-progress", complete: false };
  writeFileSync(resolve(reportPath), `${JSON.stringify(report, null, 2)}\n`);
}

const finalReport = JSON.parse(readFileSync(resolve(reportPath), "utf8"));
finalReport.completedAt = new Date().toISOString();
finalReport.progress = { stage: "settled-and-withdrawn", complete: true };
finalReport.genlayer.settlement = settlementWrite;
finalReport.api.authenticatedSettlementSync = report.api.authenticatedSettlementSync;
finalReport.api.baseRelay = { ...relay, baseTransactionHash: relayReceipt.hash, baseBlockNumber: relayReceipt.blockNumber };
finalReport.base.settlement = {
  finalized: true,
  verdict: Number(caseState.verdict),
  hunter: caseState.hunter,
  genlayerDecisionHash: caseState.genlayerDecisionHash,
  challengerStakePaid: challenge.stake_deposited_wei,
  bountyPaid: caseState.bounty.toString(),
};
finalReport.settlement = {
  relaySent: true,
  relayTxHash: relayReceipt.hash,
  withdrawalsVerified: true,
  withdrawals,
  readyAfterUnix: report.settlement.readyAfterUnix,
  readyAfterUtc: report.settlement.readyAfterUtc,
};
writeFileSync(resolve(reportPath), `${JSON.stringify(finalReport, null, 2)}\n`);
console.log(JSON.stringify({ stage: finalReport.progress.stage, settlementTxHash: settlementWrite.txHash, relayTxHash: relayReceipt.hash, withdrawals }, null, 2));
