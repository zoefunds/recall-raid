import { createClient, decodeInputData } from "genlayer-js";
import { studionet } from "genlayer-js/chains";
import { config, assertGenlayerConfigured } from "./config.js";

/**
 * Read-oriented GenLayer StudioNet helpers. This module does not hold a signer
 * or submit writes. User adjudication transactions are browser-signed; the
 * narrowly scoped genlayer-challenge-relay module submits only funded challenge
 * openings after wallet authentication and Base receipt verification.
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
  const transaction = await gl.getTransaction({ hash: txHash as any });
  return normalizeGenLayerTransaction(transaction);
}

/**
 * Normalize the StudioNet RPC transaction into the receipt shape consumed by
 * the settlement authorization checks. The RPC response uses snake_case and
 * embeds success in the leader receipt (`execution_result: SUCCESS` and
 * `result.status: return`); calldata is CBOR encoded and the SDK decodes it to
 * a Map. Preserve the raw fields and add only values derived from that receipt.
 */
export function normalizeGenLayerTransaction<T extends Record<string, unknown>>(transaction: T) {
  const consensus = transaction.consensus_data as {
    leader_receipt?: Array<{
      mode?: unknown;
      execution_result?: unknown;
      error?: unknown;
      result?: { status?: unknown } | null;
    }>;
  } | undefined;
  const leader = consensus?.leader_receipt?.find((receipt) => receipt.mode === "leader");
  const successfulReturn = leader?.execution_result === "SUCCESS"
    && !leader.error
    && leader.result?.status === "return";

  const rawTxData = transaction.tx_data ?? transaction.txData;
  const recipient = String(transaction.recipient ?? transaction.to_address ?? "");
  const decoded = typeof rawTxData === "string"
    ? decodeInputData((rawTxData.startsWith("0x") ? rawTxData : `0x${rawTxData}`) as `0x${string}`, recipient as `0x${string}`)
    : null;
  const decodedCallData = decoded && "callData" in decoded ? decoded.callData : undefined;
  const callData = decodedCallData instanceof Map
    ? Object.fromEntries(decodedCallData.entries())
    : decodedCallData;

  return {
    ...transaction,
    statusName: transaction.statusName ?? transaction.status_name,
    resultName: transaction.resultName ?? transaction.result_name,
    txExecutionResultName: successfulReturn ? "FINISHED_WITH_RETURN" : String(leader?.execution_result ?? ""),
    txDataDecoded: decoded && "callData" in decoded ? { ...decoded, callData } : decoded,
  };
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
  base_case_id: string;
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
  last_challenge_id: number;
  challenge_used: boolean;
  settled: boolean;
  relay_tx_hash: string;
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
  url_checked: boolean;
  url_reachable: boolean;
  content_hash_verified: boolean;
  fetch_excerpt: string;
  verified_at: number;
}

export interface ChainChallenge {
  id: number;
  investigation_id: number;
  challenger: string;
  reason: string;
  stake_wei: string;
  stake_deposited_wei: string;
  base_tx_hash: string;
  status: number;
  created_at: number;
  resolution_deadline: number;
  prior_verdict: number;
  new_verdict: number;
}

export interface ChainSellerBond {
  id: number;
  seller: string;
  base_bond_id: string;
  bond_wei: string;
  bond_deposited_wei: string;
  status: number;
  created_at: number;
  linked_investigation_count: number;
  slashed_total_wei: string;
  verification_code: string;
  listing_url: string;
  listing_verified: boolean;
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
  hasRegisteredBaseCase: (caseId: string, submitter: string) =>
    readContractView<boolean>("has_registered_base_case", [caseId, submitter]),
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
