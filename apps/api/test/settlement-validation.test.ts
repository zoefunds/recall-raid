import { describe, expect, it } from "vitest";
import { ethers } from "ethers";
import {
  assertAdjudicationInstructionMatches,
  assertBaseRegistrationMatches,
  assertChallengeOpenAuthorized,
  assertChallengeFundingMatches,
  assertGenLayerCall,
  assertFundedChallengeOpeningTransaction,
  assertGenLayerChallengeOutcome,
  assertChallengeUsageConsistent,
  assertGenLayerTransactionIdentity,
  assertOrphanRecoveryEligible,
  assertSuccessfulFinalizedGenVmExecution,
  deriveBaseSettlementChallenge,
} from "../src/lib/settlement-validation.js";
import { RECALLRAID_ESCROW_ABI } from "../src/lib/escrow-abi.js";

const escrow = "0x00000000000000000000000000000000000000e1";
const payer = "0x00000000000000000000000000000000000000a1";
const challenger = "0x00000000000000000000000000000000000000b2";
const caseId = ethers.id("case");
const amount = "20000000";
const iface = new ethers.Interface(RECALLRAID_ESCROW_ABI);
const data = iface.encodeFunctionData("fundChallenge", [caseId, amount]);

describe("settlement cross-chain validation", () => {
  it("requires the explicit one-challenge state to agree with active and retained challenge ids", () => {
    expect(() => assertChallengeUsageConsistent({ challenge_used: false, last_challenge_id: 0, open_challenge_id: 0 })).not.toThrow();
    expect(() => assertChallengeUsageConsistent({ challenge_used: true, last_challenge_id: 9, open_challenge_id: 0 })).not.toThrow();
    expect(() => assertChallengeUsageConsistent({ challenge_used: true, last_challenge_id: 0, open_challenge_id: 9 })).not.toThrow();
    expect(() => assertChallengeUsageConsistent({ challenge_used: false, last_challenge_id: 9, open_challenge_id: 0 })).toThrow(/missing or inconsistent/);
    expect(() => assertChallengeUsageConsistent({ challenge_used: undefined, last_challenge_id: 0, open_challenge_id: 0 })).toThrow(/missing or inconsistent/);
  });

  it("requires explicit successful and finalized GenVM transaction fields", () => {
    expect(() => assertSuccessfulFinalizedGenVmExecution({
      statusName: "FINALIZED",
      resultName: "MAJORITY_AGREE",
      txExecutionResultName: "FINISHED_WITH_RETURN",
    })).not.toThrow();
    expect(() => assertSuccessfulFinalizedGenVmExecution({
      statusName: "FINALIZED",
      resultName: "MAJORITY_AGREE",
      txExecutionResultName: "FINISHED_WITH_ERROR",
    })).toThrow(/did not finish successfully/);
    expect(() => assertSuccessfulFinalizedGenVmExecution({
      statusName: "ACCEPTED",
      resultName: "AGREE",
      txExecutionResultName: "FINISHED_WITH_RETURN",
    })).toThrow(/not finalized/);
    expect(() => assertSuccessfulFinalizedGenVmExecution({
      statusName: "FINALIZED",
      resultName: "MAJORITY_DISAGREE",
      txExecutionResultName: "FINISHED_WITH_RETURN",
    })).toThrow(/successful consensus/);
  });

  it("binds the GenVM receipt to the contract, caller, method, and arguments", () => {
    const transaction = {
      recipient: escrow,
      sender: payer,
      txDataDecoded: { callData: { method: "submit_investigation", args: [caseId, amount] } },
    };
    expect(() => assertGenLayerTransactionIdentity({ transaction, expectedContract: escrow, expectedSender: payer })).not.toThrow();
    expect(() => assertGenLayerTransactionIdentity({ transaction, expectedContract: payer })).toThrow(/different contract/);
    expect(() => assertGenLayerTransactionIdentity({ transaction, expectedContract: escrow, expectedSender: challenger })).toThrow(/sender/);
    expect(() => assertGenLayerCall({ transaction, method: "submit_investigation", args: [caseId, BigInt(amount)] })).not.toThrow();
    expect(() => assertGenLayerCall({ transaction, method: "settle_investigation", args: [4] })).toThrow(/not a settle_investigation/);
    expect(() => assertGenLayerCall({ transaction, method: "submit_investigation", args: [caseId, "1"] })).toThrow(/argument 1/);
  });

  it("confirms a finalized funded challenge opened by the previous admin after role rotation", () => {
    const previousAdmin = "0x00000000000000000000000000000000000000c3";
    const reason = "Verified funded challenge";
    const baseTxHash = ethers.id("exact base challenge funding");
    const transaction = {
      recipient: escrow,
      sender: previousAdmin,
      statusName: "FINALIZED",
      resultName: "MAJORITY_AGREE",
      txExecutionResultName: "FINISHED_WITH_RETURN",
      txDataDecoded: { callData: { method: "open_challenge", args: [4, challenger, reason, amount, baseTxHash] } },
    };
    const exact = { transaction, expectedContract: escrow, investigationId: 4, challenger, reason, stake: amount, baseTxHash };
    expect(() => assertFundedChallengeOpeningTransaction(exact)).not.toThrow();
    expect(() => assertFundedChallengeOpeningTransaction({ ...exact, expectedSender: previousAdmin })).not.toThrow();
    expect(() => assertFundedChallengeOpeningTransaction({ ...exact, expectedSender: payer })).toThrow(/sender/);
    expect(() => assertFundedChallengeOpeningTransaction({ ...exact, expectedContract: payer })).toThrow(/different contract/);
    expect(() => assertFundedChallengeOpeningTransaction({ ...exact, challenger: payer })).toThrow(/argument 1/);
    expect(() => assertFundedChallengeOpeningTransaction({ ...exact, stake: "1" })).toThrow(/argument 3/);
    expect(() => assertFundedChallengeOpeningTransaction({ ...exact, transaction: { ...transaction, txExecutionResultName: "FINISHED_WITH_ERROR" } })).toThrow(/did not finish successfully/);
  });

  it("authenticates a final overturned challenge against its investigation and verdict", () => {
    const challenge = {
      id: 9,
      investigation_id: 4,
      challenger,
      status: 3,
      prior_verdict: 1,
      new_verdict: 2,
      stake_wei: amount,
      stake_deposited_wei: amount,
      base_tx_hash: ethers.id("base challenge tx"),
    };
    expect(() => assertGenLayerChallengeOutcome({
      investigationId: 4,
      investigationStatus: 5,
      verdict: 2,
      lastChallengeId: 9,
      openChallengeId: 0,
      challenge,
    })).not.toThrow();
    expect(() => assertGenLayerChallengeOutcome({
      investigationId: 4,
      investigationStatus: 5,
      verdict: 1,
      lastChallengeId: 9,
      openChallengeId: 0,
      challenge,
    })).toThrow(/finalized verdict/);
    expect(() => assertGenLayerChallengeOutcome({
      investigationId: 5,
      investigationStatus: 5,
      verdict: 2,
      lastChallengeId: 9,
      openChallengeId: 0,
      challenge,
    })).toThrow(/does not match/);
  });

  it("lets only a Base-funded finalized challenge change the payout or receive the stake", () => {
    const challenge = { id: 9, challenger, prior_verdict: 1, status: 3 };
    expect(deriveBaseSettlementChallenge({ finalizedVerdict: 2, challenge, baseFundingVerified: true })).toEqual({
      verdict: 2, challengeId: 9, challenger, overturned: true,
    });
    expect(deriveBaseSettlementChallenge({ finalizedVerdict: 2, challenge, baseFundingVerified: false })).toEqual({
      verdict: 1, challengeId: 0, challenger: ethers.ZeroAddress, overturned: false,
    });
    expect(() => deriveBaseSettlementChallenge({ finalizedVerdict: 2, challenge: null, baseFundingVerified: true })).toThrow(/without a finalized GenLayer challenge/);
  });

  it("makes the decision signer reject every altered settlement instruction field", () => {
    const expected = {
      verdict: 2,
      hunter: payer,
      challengeId: 9,
      challenger,
      challengeOverturned: true,
      sellerBondId: ethers.id("seller bond"),
      sellerBondSlash: amount,
      decisionHash: ethers.id("final decision"),
    };
    expect(() => assertAdjudicationInstructionMatches(expected, expected)).not.toThrow();
    expect(() => assertAdjudicationInstructionMatches({ ...expected, verdict: 1 }, expected)).toThrow(/verdict/);
    expect(() => assertAdjudicationInstructionMatches({ ...expected, hunter: challenger }, expected)).toThrow(/hunter/);
    expect(() => assertAdjudicationInstructionMatches({ ...expected, challengeId: 10 }, expected)).toThrow(/challenge fields/);
    expect(() => assertAdjudicationInstructionMatches({ ...expected, challenger: payer }, expected)).toThrow(/challenge fields/);
    expect(() => assertAdjudicationInstructionMatches({ ...expected, challengeOverturned: false }, expected)).toThrow(/challenge fields/);
    expect(() => assertAdjudicationInstructionMatches({ ...expected, sellerBondId: ethers.id("other bond") }, expected)).toThrow(/seller-bond fields/);
    expect(() => assertAdjudicationInstructionMatches({ ...expected, sellerBondSlash: "1" }, expected)).toThrow(/seller-bond fields/);
    expect(() => assertAdjudicationInstructionMatches({ ...expected, decisionHash: ethers.id("modified") }, expected)).toThrow(/decision hash/);
  });

  it("requires the GenLayer submitter and bounty to equal the Base deposit", () => {
    expect(() => assertBaseRegistrationMatches({
      baseSubmitter: payer,
      genlayerSubmitter: payer.toUpperCase().replace("0X", "0x"),
      baseBounty: amount,
      genlayerBounty: amount,
      registered: false,
      recordedGenlayerContract: ethers.ZeroAddress,
      recordedInvestigationId: 0,
      expectedGenlayerContract: escrow,
      expectedInvestigationId: 4,
    })).not.toThrow();
    expect(() => assertBaseRegistrationMatches({
      baseSubmitter: payer,
      genlayerSubmitter: challenger,
      baseBounty: amount,
      genlayerBounty: amount,
      registered: false,
      recordedGenlayerContract: ethers.ZeroAddress,
      recordedInvestigationId: 0,
      expectedGenlayerContract: escrow,
      expectedInvestigationId: 4,
    })).toThrow(/depositor/);
    expect(() => assertBaseRegistrationMatches({
      baseSubmitter: payer,
      genlayerSubmitter: payer,
      baseBounty: amount,
      genlayerBounty: "1",
      registered: false,
      recordedGenlayerContract: ethers.ZeroAddress,
      recordedInvestigationId: 0,
      expectedGenlayerContract: escrow,
      expectedInvestigationId: 4,
    })).toThrow(/amount/);
    expect(() => assertBaseRegistrationMatches({
      baseSubmitter: payer,
      genlayerSubmitter: payer,
      baseBounty: amount,
      genlayerBounty: amount,
      registered: true,
      recordedGenlayerContract: escrow,
      recordedInvestigationId: 3,
      expectedGenlayerContract: escrow,
      expectedInvestigationId: 4,
    })).toThrow(/different GenLayer/);
  });

  it("accepts only a successful exact Base escrow challenge funding transaction", () => {
    const valid = {
      escrowAddress: escrow,
      caseId,
      challenger,
      amount,
      transaction: { to: escrow, from: challenger, data },
      receiptStatus: 1,
    };
    expect(() => assertChallengeFundingMatches(valid)).not.toThrow();
    expect(() => assertChallengeFundingMatches({ ...valid, transaction: { ...valid.transaction, from: payer } })).toThrow(/identity/);
    expect(() => assertChallengeFundingMatches({ ...valid, caseId: ethers.id("other") })).toThrow(/identity/);
    expect(() => assertChallengeFundingMatches({ ...valid, amount: "1" })).toThrow(/identity/);
    expect(() => assertChallengeFundingMatches({ ...valid, transaction: { ...valid.transaction, to: payer } })).toThrow(/escrow/);
    expect(() => assertChallengeFundingMatches({ ...valid, receiptStatus: 0 })).toThrow(/successfully/);
    expect(() => assertChallengeFundingMatches({ ...valid, receiptStatus: null })).toThrow(/successfully/);
  });

  it("opens a GenLayer challenge only for the authenticated wallet's exact registered Base deposit", () => {
    const genlayerContract = "0x00000000000000000000000000000000000000c3";
    const valid = {
      caller: challenger,
      challenger,
      investigation: {
        id: 7,
        submitter: payer,
        base_case_id: caseId,
        status: 3,
        verdict: 1,
        bounty_wei: "100000000",
        challenge_deadline: 2_000,
        open_challenge_id: 0,
        last_challenge_id: 0,
        challenge_used: false,
        settled: false,
      },
      baseCase: {
        submitter: payer,
        bountyUsdcBaseUnits: "100000000",
        registered: true,
        genlayerContract,
        genlayerInvestigationId: 7,
      },
      expectedGenlayerContract: genlayerContract,
      declaredStake: "20000000",
      depositedStake: "20000000",
      nowSeconds: 1_000,
    };
    expect(assertChallengeOpenAuthorized(valid)).toBe("20000000");
    expect(() => assertChallengeOpenAuthorized({ ...valid, caller: payer })).toThrow(/wallet does not match/);
    expect(() => assertChallengeOpenAuthorized({ ...valid, declaredStake: "1" })).toThrow(/exact required amount/);
    expect(() => assertChallengeOpenAuthorized({ ...valid, depositedStake: "1" })).toThrow(/exact required amount/);
    expect(() => assertChallengeOpenAuthorized({ ...valid, nowSeconds: 2_000 })).toThrow(/window has closed/);
    expect(() => assertChallengeOpenAuthorized({ ...valid, baseCase: { ...valid.baseCase, registered: false } })).toThrow(/not registered/);
    expect(() => assertChallengeOpenAuthorized({ ...valid, investigation: { ...valid.investigation, open_challenge_id: 9 } })).toThrow(/not eligible/);
  });

  it("allows orphan recovery only for the depositor after seven days with no GenLayer registration", () => {
    const fundedAtSeconds = 1_000_000;
    const eligible = {
      depositor: payer,
      caller: payer,
      registeredOnBase: false,
      finalized: false,
      fundedAtSeconds,
      registeredOnGenlayer: false,
      nowSeconds: fundedAtSeconds + 7 * 24 * 3600,
    };
    expect(() => assertOrphanRecoveryEligible(eligible)).not.toThrow();
    expect(() => assertOrphanRecoveryEligible({ ...eligible, caller: challenger })).toThrow(/depositor/);
    expect(() => assertOrphanRecoveryEligible({ ...eligible, registeredOnBase: true })).toThrow(/unregistered orphan/);
    expect(() => assertOrphanRecoveryEligible({ ...eligible, finalized: true })).toThrow(/unregistered orphan/);
    expect(() => assertOrphanRecoveryEligible({ ...eligible, nowSeconds: eligible.nowSeconds - 1 })).toThrow(/seven-day/);
    expect(() => assertOrphanRecoveryEligible({ ...eligible, registeredOnGenlayer: true })).toThrow(/GenLayer investigation/);
  });
});
