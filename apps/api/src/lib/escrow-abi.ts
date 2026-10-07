export const RECALLRAID_ESCROW_ABI = [
  "function usdc() view returns (address)",
  "function relayer() view returns (address)",
  "function claimable(address) view returns (uint256)",
  "function getCase(bytes32) view returns ((address submitter,address challenger,address hunter,bytes32 sellerBondId,uint256 bounty,uint256 challengeStake,uint8 verdict,bool finalized,bytes32 genlayerDecisionHash))",
  "function getSellerBond(bytes32) view returns ((address seller,uint256 balance,uint256 totalDeposited,uint256 totalSlashed,uint256 linkedCases,bool withdrawn))",
  "function relayAdjudication(bytes32 caseId,uint8 verdictCode,address hunter,bool challengeOverturned,bytes32 decisionHash)",
  "function relayCancellation(bytes32 caseId,bytes32 decisionHash)",
] as const;

export const ERC20_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address,address) view returns (uint256)",
  "function approve(address,uint256) returns (bool)",
] as const;
