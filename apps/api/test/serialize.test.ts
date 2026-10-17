import { describe, expect, it } from "vitest";
import { serializeInvestigation, type InvestigationRow } from "../src/lib/serialize.js";

const row: InvestigationRow = {
  investigation_id: 1,
  submitter_wallet: "0x0000000000000000000000000000000000000001",
  base_case_id: "0x" + "1".repeat(64),
  product_name: "Test product",
  brand: "Test brand",
  model_number: null,
  serial_number: null,
  marketplace: null,
  marketplace_url: null,
  manufacturer_url: null,
  recall_source_url: null,
  description: null,
  category: null,
  hazard_class: 1,
  status: "VERDICT_REACHED",
  verdict: "POTENTIAL_ISSUE",
  bounty_wei: "1000000",
  bounty_deposited_wei: "1000000",
  seller_bond_id: null,
  ai_confidence_bps: 8000,
  hunter_payout_bps: 8500,
  evidence_count: 1,
  created_at_chain: 1_000,
  evidence_deadline: 2_000,
  verdict_deadline: 3_000,
  challenge_deadline: 4_000,
  open_challenge_id: null,
  last_challenge_id: 7,
  challenge_used: true,
  settled: false,
  relay_tx_hash: "",
};

describe("investigation API serialization", () => {
  it("passes the retained challenge id and one-use flag through to the browser", () => {
    expect(serializeInvestigation(row)).toMatchObject({
      open_challenge_id: 0,
      last_challenge_id: 7,
      challenge_used: true,
    });
  });

  it("preserves unknown legacy cache values so the browser fails closed", () => {
    expect(serializeInvestigation({ ...row, last_challenge_id: null, challenge_used: null })).toMatchObject({
      open_challenge_id: 0,
      last_challenge_id: null,
      challenge_used: null,
    });
  });
});
