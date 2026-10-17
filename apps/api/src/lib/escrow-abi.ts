export const RECALLRAID_ESCROW_ABI = [
  "function usdc() view returns (address)",
  "function relayer() view returns (address)",
  "function decisionSigner() view returns (address)",
  "function claimable(address) view returns (uint256)",
  "function getCase(bytes32) view returns ((address submitter,address challenger,address hunter,bytes32 sellerBondId,uint256 bounty,uint256 challengeStake,uint8 verdict,bool finalized,bytes32 genlayerDecisionHash,uint64 fundedAt,bool registered,address genlayerContract,uint32 genlayerInvestigationId))",
  "function registerGenLayerCase(bytes32,address,uint256,address,uint32,bytes)",
  "function recoverOrphanDeposit(bytes32,bytes)",
  "function getSellerBond(bytes32) view returns ((address seller,uint256 balance,uint256 totalDeposited,uint256 totalSlashed,uint256 linkedCases,bool withdrawn))",
  "function relayAdjudication(bytes32 caseId,address genlayerContract,uint32 investigationId,uint8 verdictCode,address hunter,uint32 challengeId,address challenger,bool challengeOverturned,bytes32 sellerBondId,uint256 sellerBondSlash,bytes32 decisionHash,bytes authorization)",
  "function getChallengeDeposit(bytes32,address) view returns ((uint256 amount,uint64 fundedAt))",
  "function fundChallenge(bytes32 caseId,uint256 amount)",
  "function relayCancellation(bytes32 caseId,address genlayerContract,uint32 investigationId,bytes32 decisionHash,bytes authorization)",
] as const;

export const ERC20_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address,address) view returns (uint256)",
  "function approve(address,uint256) returns (bool)",
] as const;
