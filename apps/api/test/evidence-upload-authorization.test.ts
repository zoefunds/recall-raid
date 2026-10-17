import { describe, expect, it } from "vitest";
import { assertEvidenceUploadAuthorized } from "../src/lib/evidence-upload-authorization.js";

const submitter = "0x00000000000000000000000000000000000000a1";
const challenger = "0x00000000000000000000000000000000000000b2";
const unrelated = "0x00000000000000000000000000000000000000c3";

const investigation = {
  submitter,
  status: 4,
  open_challenge_id: 7,
} as const;

describe("evidence upload authorization", () => {
  it("allows community evidence during the evidence-collection states", () => {
    const collecting = { ...investigation, status: 1 } as const;
    expect(() => assertEvidenceUploadAuthorized({ walletAddress: submitter, purpose: "evidence", investigation: collecting })).not.toThrow();
    expect(() => assertEvidenceUploadAuthorized({ walletAddress: unrelated, purpose: "evidence", investigation: collecting })).not.toThrow();
    expect(() => assertEvidenceUploadAuthorized({ walletAddress: unrelated, purpose: "evidence", investigation })).toThrow(/closed/);
  });

  it("allows challenge rebuttal only for the recorded challenger of an open challenge", () => {
    const challenge = { challenger, status: 1 } as const;
    expect(() => assertEvidenceUploadAuthorized({ walletAddress: challenger, purpose: "challenge_rebuttal", investigation, challenge })).not.toThrow();
    expect(() => assertEvidenceUploadAuthorized({ walletAddress: unrelated, purpose: "challenge_rebuttal", investigation, challenge })).toThrow(/recorded challenger/);
    expect(() => assertEvidenceUploadAuthorized({ walletAddress: challenger, purpose: "challenge_rebuttal", investigation, challenge: { ...challenge, status: 2 } })).toThrow(/recorded challenger/);
  });

  it("rejects rebuttal uploads unless the investigation has an open challenge", () => {
    expect(() => assertEvidenceUploadAuthorized({
      walletAddress: challenger,
      purpose: "challenge_rebuttal",
      investigation: { ...investigation, status: 3, open_challenge_id: 0 },
      challenge: { challenger, status: 1 },
    })).toThrow(/open on-chain challenge/);
  });
});
