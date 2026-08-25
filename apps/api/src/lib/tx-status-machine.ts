// Pure state-machine logic for the tx_status_log lifecycle, kept separate
// from the route/DB code so it's directly unit-testable.
//
// Lifecycle: idle -> preparing -> submitted -> pending -> confirmed
//                                            \-> failed
//                                            \-> timeout
// "idle"/"preparing" are client-only pre-broadcast states the client may
// report before it has a tx hash; every state from "submitted" onward is
// expected to carry one.

export const TX_STATUSES = [
  "idle",
  "preparing",
  "submitted",
  "pending",
  "confirmed",
  "failed",
  "timeout",
] as const;

export type TxStatus = (typeof TX_STATUSES)[number];

export const TX_KINDS = [
  "submit_investigation",
  "add_evidence",
  "cancel_investigation",
  "request_verdict",
  "claim_evidence_timeout",
  "claim_verdict_timeout",
  "open_challenge",
  "resolve_challenge",
  "claim_challenge_timeout",
  "settle_investigation",
  "withdraw",
  "create_seller_bond",
  "topup_seller_bond",
  "link_seller_bond",
  "withdraw_seller_bond",
] as const;

export type TxKind = (typeof TX_KINDS)[number];

const TERMINAL_STATUSES: ReadonlySet<TxStatus> = new Set(["confirmed", "failed", "timeout"]);

// Explicit allow-list of forward transitions. A transition not listed here
// is rejected — this is what stops a stale/out-of-order client report (e.g.
// a retried "submitted" arriving after "confirmed" already landed) from
// clobbering a terminal result.
const ALLOWED_TRANSITIONS: Record<TxStatus, ReadonlySet<TxStatus>> = {
  idle: new Set(["preparing", "submitted"]),
  preparing: new Set(["submitted", "failed"]),
  submitted: new Set(["pending", "confirmed", "failed", "timeout"]),
  pending: new Set(["confirmed", "failed", "timeout"]),
  confirmed: new Set([]),
  failed: new Set([]),
  timeout: new Set([]),
};

export function isTerminal(status: TxStatus): boolean {
  return TERMINAL_STATUSES.has(status);
}

/**
 * Returns true if moving from `current` to `next` is a legal transition.
 * A same-state "transition" (e.g. pending -> pending, a duplicate poll
 * report) is always allowed and is a no-op from the caller's perspective.
 */
export function canTransition(current: TxStatus, next: TxStatus): boolean {
  if (current === next) return true;
  if (isTerminal(current)) return false;
  return ALLOWED_TRANSITIONS[current].has(next);
}

export function isValidTxStatus(value: string): value is TxStatus {
  return (TX_STATUSES as readonly string[]).includes(value);
}

export function isValidTxKind(value: string): value is TxKind {
  return (TX_KINDS as readonly string[]).includes(value);
}
