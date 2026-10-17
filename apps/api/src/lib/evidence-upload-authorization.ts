import { forbidden } from "./http-errors.js";
import type { ChainChallenge, ChainInvestigation } from "./genlayer.js";

export type EvidenceUploadPurpose = "evidence" | "challenge_rebuttal";

export function assertEvidenceUploadAuthorized(input: {
  walletAddress: string;
  purpose: EvidenceUploadPurpose;
  investigation: Pick<ChainInvestigation, "submitter" | "status" | "open_challenge_id">;
  challenge?: Pick<ChainChallenge, "challenger" | "status">;
}): void {
  const wallet = input.walletAddress.toLowerCase();
  if (input.purpose === "evidence") {
    // The contract intentionally accepts community evidence while an
    // investigation is collecting evidence. Keep the upload signer aligned
    // with that lifecycle instead of silently excluding independent hunters.
    if (![0, 1].includes(input.investigation.status)) {
      throw forbidden("ordinary evidence uploads are closed for this investigation state");
    }
    return;
  }

  // INV_CHALLENGE_WINDOW=4 and CHALLENGE_OPEN=1 are contract enum values.
  if (input.investigation.status !== 4 || input.investigation.open_challenge_id <= 0) {
    throw forbidden("challenge rebuttal uploads require an open on-chain challenge");
  }
  if (!input.challenge || input.challenge.status !== 1 || input.challenge.challenger.toLowerCase() !== wallet) {
    throw forbidden("only the recorded challenger may upload rebuttal evidence");
  }
}
