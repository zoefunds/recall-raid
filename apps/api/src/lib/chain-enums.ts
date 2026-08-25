// Mirrors the raw u8 enum constants in contracts/recallraid_contract.py
// exactly. The contract intentionally returns raw ints (not labels) from
// its view methods, so this is the single place that maps them to the
// text labels stored in Postgres and returned by this API's JSON responses.

export const INVESTIGATION_STATUS: Record<number, string> = {
  0: "OPEN",
  1: "EVIDENCE_SUBMITTED",
  2: "INVESTIGATING",
  3: "VERDICT_REACHED",
  4: "CHALLENGE_WINDOW",
  5: "SETTLED",
  6: "INVALID",
  7: "CANCELLED",
};

export const VERDICT: Record<number, string> = {
  0: "NONE",
  1: "NO_ISSUE",
  2: "POTENTIAL_ISSUE",
  3: "RECALL_CONFIRMED",
  4: "NEEDS_MORE_EVIDENCE",
};

export const HAZARD_CLASS: Record<number, string> = {
  1: "CRITICAL",
  2: "HIGH",
  3: "MODERATE",
};

export const CHALLENGE_STATUS: Record<number, string> = {
  1: "OPEN",
  2: "UPHELD",
  3: "OVERTURNED",
  4: "EXPIRED",
};

export const BOND_STATUS: Record<number, string> = {
  0: "ACTIVE",
  1: "DEPLETED",
  2: "WITHDRAWN",
};

function labelOf(map: Record<number, string>, code: number | null | undefined): string | null {
  if (code === null || code === undefined) return null;
  return map[code] ?? `UNKNOWN(${code})`;
}

export const investigationStatusLabel = (code: number | null | undefined) => labelOf(INVESTIGATION_STATUS, code);
export const verdictLabel = (code: number | null | undefined) => labelOf(VERDICT, code);
export const hazardClassLabel = (code: number | null | undefined) => labelOf(HAZARD_CLASS, code);
export const challengeStatusLabel = (code: number | null | undefined) => labelOf(CHALLENGE_STATUS, code);
export const bondStatusLabel = (code: number | null | undefined) => labelOf(BOND_STATUS, code);

// Reverse maps — the DB stores text labels (readable, indexable), but the
// frontend's TypeScript types mirror the contract's raw JSON exactly
// (status/verdict as the same numeric codes get_investigation returns), so
// every response that serializes a cache row back out needs to translate
// the label back to its code.
function codeOf(map: Record<number, string>, label: string | null | undefined): number {
  if (label === null || label === undefined) return 0;
  const entry = Object.entries(map).find(([, value]) => value === label);
  return entry ? Number(entry[0]) : 0;
}

export const investigationStatusCode = (label: string | null | undefined) => codeOf(INVESTIGATION_STATUS, label);
export const verdictCode = (label: string | null | undefined) => codeOf(VERDICT, label);
export const challengeStatusCode = (label: string | null | undefined) => codeOf(CHALLENGE_STATUS, label);
export const bondStatusCode = (label: string | null | undefined) => codeOf(BOND_STATUS, label);
