import { createClient } from "genlayer-js";
import { studionet } from "genlayer-js/chains";
import { config, assertGenlayerConfigured } from "./config.js";

/**
 * Read-only GenLayer StudioNet client. This is the ONLY place the API talks
 * to the chain, and it is read-only by construction: every exported helper
 * here calls a `@gl.public.view` method or reads a transaction receipt.
 *
 * This module must never import a signer/account, never call
 * `client.writeContract`, and never hold a private key. All value-moving
 * calls (submit_investigation, add_evidence, open_challenge,
 * settle_investigation, withdraw, create_seller_bond, ...) are signed
 * client-side by the connected wallet directly against the GenLayer RPC
 * from apps/web — this backend is never in that path.
 */
let client: ReturnType<typeof createClient> | null = null;

function getClient() {
  assertGenlayerConfigured();
  if (!client) {
    client = createClient({
      chain: studionet,
      endpoint: config.genlayer.rpcUrl || undefined,
    });
  }
  return client;
}

/**
 * Calls a `@gl.public.view` method on the RecallRaid contract and JSON-parses
 * its string return value (GenVM view methods return JSON-encoded strings,
 * per the contract's own `_investigation_to_dict`-style helpers).
 */
export async function readContractView<T = unknown>(functionName: string, args: unknown[] = []): Promise<T> {
  const gl = getClient();
  const raw = await gl.readContract({
    address: config.genlayer.contractAddress as `0x${string}`,
    functionName,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- SDK's CalldataEncodable union is narrower than our generic route params
    args: args as any,
  });
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw) as T;
    } catch {
      // Some view methods (get_investigation_count, get_balance-adjacent
      // helpers) intentionally return a bare scalar, not JSON.
      return raw as unknown as T;
    }
  }
  return raw as T;
}

export async function getTransactionStatus(txHash: string) {
  const gl = getClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- SDK's Hash type is a fixed-length branded string; runtime value is always well-formed
  return gl.getTransaction({ hash: txHash as any });
}

// ---------------------------------------------------------------------------
// Typed convenience wrappers matching the contract's exact view surface
// (contracts/recallraid_contract.py). Kept thin and 1:1 with the contract so
// the API's read model can never silently drift from what's actually on
// chain — no field renaming, no derived shortcuts here.
// ---------------------------------------------------------------------------

export interface ChainInvestigation {
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

export interface ChainEvidence {
  id: number;
  investigation_id: number;
  submitter: string;
  evidence_type: string;
  content_hash: string;
  url: string;
  description: string;
  submitted_at: number;
}

export interface ChainChallenge {
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

export interface ChainSellerBond {
  id: number;
  seller: string;
  bond_wei: string;
  bond_deposited_wei: string;
  status: number;
  created_at: number;
  linked_investigation_count: number;
  slashed_total_wei: string;
}

export interface ChainReputation {
  valid_discoveries: number;
  invalid_reports: number;
  successful_challenges: number;
  failed_challenges: number;
  total_earned_wei: string;
  accuracy_bps: number;
  updated_at: number;
}

export interface ChainProtocolInfo {
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

export const chain = {
  getInvestigation: (id: number) => readContractView<ChainInvestigation>("get_investigation", [id]),
  getInvestigationCount: () => readContractView<number>("get_investigation_count", []),
  listInvestigations: (offset: number, limit: number) =>
    readContractView<{ total: number; items: ChainInvestigation[] }>("list_investigations", [offset, limit]),
  getEvidence: (evidenceId: number) => readContractView<ChainEvidence>("get_evidence", [evidenceId]),
  getEvidenceIdsForInvestigation: (investigationId: number) =>
    readContractView<number[]>("get_evidence_ids_for_investigation", [investigationId]),
  getChallenge: (challengeId: number) => readContractView<ChainChallenge>("get_challenge", [challengeId]),
  getSellerBond: (bondId: number) => readContractView<ChainSellerBond>("get_seller_bond", [bondId]),
  getSellerBondCount: () => readContractView<number>("get_seller_bond_count", []),
  getBalance: (address: string) => readContractView<string>("get_balance", [address]),
  getReputation: (address: string) => readContractView<ChainReputation>("get_reputation", [address]),
  getProtocolInfo: () => readContractView<ChainProtocolInfo>("get_protocol_info", []),
};
