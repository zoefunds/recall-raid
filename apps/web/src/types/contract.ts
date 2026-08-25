// Local type definitions mirroring the on-chain shapes returned by
// contracts/recallraid_contract.py's view methods (JSON-decoded). Kept
// local to apps/web per the build instructions (packages/shared is owned
// by another workstream) — do not duplicate business logic here, only
// wire-format shapes and the enum labels the contract itself documents.

export const InvestigationStatus = {
  OPEN: 0,
  EVIDENCE_SUBMITTED: 1,
  INVESTIGATING: 2,
  VERDICT_REACHED: 3,
  CHALLENGE_WINDOW: 4,
  SETTLED: 5,
  INVALID: 6,
  CANCELLED: 7,
} as const;

export type InvestigationStatusCode = (typeof InvestigationStatus)[keyof typeof InvestigationStatus];

export const INVESTIGATION_STATUS_LABEL: Record<number, string> = {
  0: 'OPEN',
  1: 'EVIDENCE_SUBMITTED',
  2: 'INVESTIGATING',
  3: 'VERDICT_REACHED',
  4: 'CHALLENGE_WINDOW',
  5: 'SETTLED',
  6: 'INVALID',
  7: 'CANCELLED',
};

export const Verdict = {
  NONE: 0,
  NO_ISSUE: 1,
  POTENTIAL_ISSUE: 2,
  RECALL_CONFIRMED: 3,
  NEEDS_MORE_EVIDENCE: 4,
} as const;

export const VERDICT_LABEL: Record<number, string> = {
  0: 'NONE',
  1: 'NO_ISSUE',
  2: 'POTENTIAL_ISSUE',
  3: 'RECALL_CONFIRMED',
  4: 'NEEDS_MORE_EVIDENCE',
};

export const HazardClass = {
  CRITICAL: 1,
  HIGH: 2,
  MODERATE: 3,
} as const;

export const HAZARD_LABEL: Record<number, string> = {
  1: 'CRITICAL',
  2: 'HIGH',
  3: 'MODERATE',
};

export interface Investigation {
  id: number;
  submitter: string;
  product_name: string;
  brand: string;
  model_number: string;
  serial_number: string;
  marketplace: string;
  marketplace_url: string;
  manufacturer_url: string;
  recall_source_url: string;
  description: string;
  category: string;
  hazard_class: number;
  status: number;
  verdict: number;
  bounty_wei: string;
  bounty_deposited_wei: string;
  seller_bond_id: number;
  ai_confidence_bps: number;
  hunter_payout_bps: number;
  evidence_count: number;
  created_at: number;
  evidence_deadline: number;
  verdict_deadline: number;
  challenge_deadline: number;
  open_challenge_id: number;
  settled: boolean;
}

export interface Evidence {
  id: number;
  investigation_id: number;
  submitter: string;
  evidence_type: 'product_photo' | 'listing_screenshot' | 'manufacturer_doc' | 'recall_notice' | 'other' | string;
  content_hash: string;
  url: string;
  description: string;
  submitted_at: number;
}

export interface Challenge {
  id: number;
  investigation_id: number;
  challenger: string;
  reason: string;
  stake_wei: string;
  stake_deposited_wei: string;
  status: number;
  created_at: number;
  resolution_deadline: number;
  prior_verdict: number;
  new_verdict: number;
}

export interface SellerBond {
  id: number;
  seller: string;
  bond_wei: string;
  bond_deposited_wei: string;
  status: number;
  created_at: number;
  linked_investigation_count: number;
  slashed_total_wei: string;
}

export interface Reputation {
  valid_discoveries: number;
  invalid_reports: number;
  successful_challenges: number;
  failed_challenges: number;
  total_earned_wei: string;
  accuracy_bps: number;
  updated_at: number;
}

export interface ProtocolInfo {
  admin: string;
  paused: boolean;
  investigation_count: number;
  seller_bond_count: number;
  challenge_stake_bps: number;
  challenge_overturn_bonus_bps: number;
  evidence_window_seconds: number;
  verdict_window_seconds: number;
  challenge_window_seconds: number;
  challenge_resolution_seconds: number;
}

export interface LeaderboardRow {
  rank: number;
  address: string;
  valid_discoveries: number;
  accuracy_bps: number;
  total_earned_wei: string;
}

export interface PlatformStats {
  verified_discoveries: number;
  gen_distributed_wei: string;
  active_threats: number;
}
