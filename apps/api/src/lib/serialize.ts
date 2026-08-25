// Maps Postgres cache rows (snake_case, chain_-suffixed, text-label enums —
// convenient for indexing/querying) onto the exact JSON shapes the frontend
// expects (apps/web/src/types/contract.ts), which mirror the contract's own
// get_* view method return shapes field-for-field. This is the single
// translation boundary between "how we store it" and "what the API returns".
import {
  investigationStatusCode,
  verdictCode,
  bondStatusCode,
} from "./chain-enums.js";

export interface InvestigationRow {
  investigation_id: number;
  submitter_wallet: string | null;
  product_name: string;
  brand: string;
  model_number: string | null;
  serial_number: string | null;
  marketplace: string | null;
  marketplace_url: string | null;
  manufacturer_url: string | null;
  recall_source_url: string | null;
  description: string | null;
  category: string | null;
  hazard_class: number | null;
  status: string;
  verdict: string | null;
  bounty_wei: string | null;
  bounty_deposited_wei: string | null;
  seller_bond_id: number | null;
  ai_confidence_bps: number | null;
  hunter_payout_bps: number | null;
  evidence_count: number;
  created_at_chain: string | number | null;
  evidence_deadline: string | number | null;
  verdict_deadline: string | number | null;
  challenge_deadline: string | number | null;
  open_challenge_id: number | null;
  settled: boolean;
}

export function serializeInvestigation(row: InvestigationRow) {
  return {
    id: row.investigation_id,
    submitter: row.submitter_wallet ?? "",
    product_name: row.product_name,
    brand: row.brand,
    model_number: row.model_number ?? "",
    serial_number: row.serial_number ?? "",
    marketplace: row.marketplace ?? "",
    marketplace_url: row.marketplace_url ?? "",
    manufacturer_url: row.manufacturer_url ?? "",
    recall_source_url: row.recall_source_url ?? "",
    description: row.description ?? "",
    category: row.category ?? "",
    hazard_class: row.hazard_class ?? 0,
    status: investigationStatusCode(row.status),
    verdict: verdictCode(row.verdict),
    bounty_wei: String(row.bounty_wei ?? "0"),
    bounty_deposited_wei: String(row.bounty_deposited_wei ?? "0"),
    seller_bond_id: row.seller_bond_id ?? 0,
    ai_confidence_bps: row.ai_confidence_bps ?? 0,
    hunter_payout_bps: row.hunter_payout_bps ?? 0,
    evidence_count: row.evidence_count,
    created_at: Number(row.created_at_chain ?? 0),
    evidence_deadline: Number(row.evidence_deadline ?? 0),
    verdict_deadline: Number(row.verdict_deadline ?? 0),
    challenge_deadline: Number(row.challenge_deadline ?? 0),
    open_challenge_id: row.open_challenge_id ?? 0,
    settled: row.settled,
  };
}

export interface EvidenceRow {
  evidence_id: number;
  investigation_id: number;
  submitter_wallet: string | null;
  evidence_type: string | null;
  content_hash: string | null;
  url: string | null;
  description: string | null;
  submitted_at_chain: string | number | null;
}

export function serializeEvidence(row: EvidenceRow) {
  return {
    id: row.evidence_id,
    investigation_id: row.investigation_id,
    submitter: row.submitter_wallet ?? "",
    evidence_type: row.evidence_type ?? "other",
    content_hash: row.content_hash ?? "",
    url: row.url ?? "",
    description: row.description ?? "",
    submitted_at: Number(row.submitted_at_chain ?? 0),
  };
}

export interface SellerBondRow {
  bond_id: number;
  seller_wallet: string | null;
  bond_wei: string | null;
  bond_deposited_wei: string | null;
  status: string;
  created_at_chain: string | number | null;
  linked_investigation_count: number;
  slashed_total_wei: string | null;
}

export function serializeSellerBond(row: SellerBondRow) {
  return {
    id: row.bond_id,
    seller: row.seller_wallet ?? "",
    bond_wei: String(row.bond_wei ?? "0"),
    bond_deposited_wei: String(row.bond_deposited_wei ?? "0"),
    status: bondStatusCode(row.status),
    created_at: Number(row.created_at_chain ?? 0),
    linked_investigation_count: row.linked_investigation_count,
    slashed_total_wei: String(row.slashed_total_wei ?? "0"),
  };
}

export interface LeaderboardRow {
  wallet_address: string;
  valid_discoveries: number;
  accuracy_bps: number;
  total_earned_wei: string | null;
  rank: number | null;
}

export function serializeLeaderboardRow(row: LeaderboardRow, fallbackRank: number) {
  return {
    rank: row.rank ?? fallbackRank,
    address: row.wallet_address,
    valid_discoveries: row.valid_discoveries,
    accuracy_bps: row.accuracy_bps,
    total_earned_wei: String(row.total_earned_wei ?? "0"),
  };
}
