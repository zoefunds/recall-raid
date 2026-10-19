import { env } from './env';
import type { Challenge, Evidence, Investigation, LeaderboardRow, PlatformStats, SellerBond } from '@/types/contract';

export class ApiError extends Error {
  status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${env.apiBaseUrl}${path}`, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) },
      cache: 'no-store',
      // The API and web app are different origins (Fly.io / Vercel), and
      // the session cookie is issued with `SameSite=None; Secure` for
      // exactly this reason — but a cross-origin fetch() ignores that
      // cookie entirely, in both directions, unless the request explicitly
      // opts in with credentials: 'include'. Without this, /auth/verify's
      // Set-Cookie response is silently dropped by the browser and every
      // authenticated endpoint (uploads, sync, notifications) 401s forever.
      credentials: 'include',
    });
  } catch {
    throw new ApiError('We could not reach RecallRaid servers. Check your connection and try again.');
  }
  if (!res.ok) {
    const payload = await res.json().catch(() => null) as { error?: { code?: string; message?: string } } | null;
    if (payload?.error?.code === 'genlayer_rate_limited') {
      throw new ApiError(payload.error.message ?? 'GenLayer is temporarily rate-limited. Please try again later.', res.status);
    }
    throw new ApiError(
      res.status === 404 ? 'Not found.' : 'The server had a problem handling that request.',
      res.status,
    );
  }
  return res.json() as Promise<T>;
}

export interface InvestigationListParams {
  offset?: number;
  limit?: number;
  category?: string;
  hazard_class?: number[];
  min_bounty_wei?: string;
}

export interface InvestigationListResponse {
  total: number;
  items: Investigation[];
}

export function fetchInvestigations(params: InvestigationListParams = {}): Promise<InvestigationListResponse> {
  const qs = new URLSearchParams();
  qs.set('offset', String(params.offset ?? 0));
  qs.set('limit', String(params.limit ?? 20));
  if (params.category) qs.set('category', params.category);
  if (params.hazard_class?.length) qs.set('hazard_class', params.hazard_class.join(','));
  if (params.min_bounty_wei) qs.set('min_bounty_wei', params.min_bounty_wei);
  return apiFetch(`/investigations?${qs.toString()}`);
}

export function fetchInvestigation(id: number | string): Promise<Investigation> {
  return apiFetch(`/investigations/${id}`);
}

export function fetchEvidenceForInvestigation(investigationId: number | string): Promise<Evidence[]> {
  return apiFetch(`/evidence?investigation_id=${investigationId}`);
}

export interface UploadUrlResponse {
  upload_url: string;
  public_id: string;
  fields: {
    api_key: string;
    timestamp: string;
    signature: string;
    public_id: string;
    folder: string;
  };
}

export function requestEvidenceUploadUrl(payload: {
  investigationId: number;
  contentType: string;
  declaredSizeBytes: number;
  fileName?: string;
}): Promise<UploadUrlResponse> {
  return apiFetch('/evidence/upload-url', { method: 'POST', body: JSON.stringify(payload) });
}

export function fetchChallengeSourceDigest(payload: {
  investigationId: number;
  url: string;
}): Promise<{ url: string; sha256: string; byteLength: number }> {
  return apiFetch('/evidence/challenge-source-digest', { method: 'POST', body: JSON.stringify(payload) });
}

export function fetchChallengesForInvestigation(investigationId: number | string): Promise<{ challenges: Challenge[] }> {
  return apiFetch(`/investigations/${investigationId}/challenges`);
}

export interface OpenChallengeRequest {
  reason: string;
  stakeUsdcBaseUnits: string;
  baseTxHash: string;
}

export function openFundedChallenge(investigationId: number | string, payload: OpenChallengeRequest): Promise<{
  status: 'pending' | 'confirmed';
  txHash: string | null;
  challengeId: number | null;
}> {
  return apiFetch(`/investigations/${investigationId}/challenges/open`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function checkFundedChallenge(investigationId: number | string, payload: OpenChallengeRequest & { txHash: string }): Promise<{
  status: 'pending' | 'confirmed';
  challengeId: number | null;
}> {
  return apiFetch(`/investigations/${investigationId}/challenges/open-status`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function fetchLeaderboard(limit = 50): Promise<LeaderboardRow[]> {
  return apiFetch(`/leaderboard?limit=${limit}`);
}

export function fetchPlatformStats(): Promise<PlatformStats> {
  return apiFetch('/stats');
}

export function fetchSellerBonds(sellerAddress: string): Promise<SellerBond[]> {
  return apiFetch(`/sellers/${sellerAddress}/bonds`);
}

// ---------------------------------------------------------------------
// Wallet session (challenge-nonce-signature auth) — required before any
// requireAuth-gated endpoint below (uploads, sync, notifications) will
// accept a request. See src/hooks/useWalletSession.ts for the flow that
// calls these: request a nonce, have the wallet sign it, verify.
// ---------------------------------------------------------------------

export function requestAuthNonce(address: string): Promise<{ nonce: string; message: string }> {
  return apiFetch('/auth/nonce', { method: 'POST', body: JSON.stringify({ address }) });
}

export function verifyAuthSignature(address: string, signature: string): Promise<{ walletAddress: string }> {
  return apiFetch('/auth/verify', { method: 'POST', body: JSON.stringify({ address, signature }) });
}

export function fetchAuthSession(): Promise<{ session: { walletAddress: string } | null }> {
  return apiFetch('/auth/session');
}

// ---------------------------------------------------------------------
// Chain -> cache sync triggers. The Postgres cache is only ever updated
// by (a) one of these calls, right after the frontend's own client-signed
// transaction confirms, or (b) the backend's periodic deadline-watcher
// sweep for investigations that are still in a non-terminal state — see
// docs/ARCHITECTURE.md. Calling these immediately after a write is what
// keeps the UI from showing stale state for the person who just acted.
// ---------------------------------------------------------------------

export function syncInvestigation(id: number | string, txHash?: string): Promise<{ investigation: Investigation }> {
  return apiFetch(`/investigations/${id}/sync`, { method: 'POST', body: JSON.stringify({ txHash }) });
}

/**
 * A GenVM receipt can be finalized a few seconds before the read endpoint
 * serving the API sees the resulting contract state.  A single sync call at
 * that boundary made newly-created hunts appear to be missing even though
 * their on-chain transaction had succeeded.  Keep polling the explicit sync
 * endpoint for a short, bounded period so the creator is routed only after
 * the API cache has the canonical chain row.
 */
export async function syncInvestigationUntilVisible(
  id: number | string,
  txHash?: string,
  attempts = 8,
): Promise<{ investigation: Investigation }> {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      return await syncInvestigation(id, txHash);
    } catch (error) {
      lastError = error;
      // Retrying an expired/invalid session cannot make it valid; all other
      // failures may be the expected short RPC/indexing delay after finality.
      if (error instanceof ApiError && (error.status === 401 || error.status === 403)) throw error;
      if (attempt < attempts - 1) {
        await new Promise((resolve) => setTimeout(resolve, Math.min(1_000 * (attempt + 1), 4_000)));
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error('The finalized investigation has not become readable yet.');
}

export function relayInvestigation(id: number | string): Promise<{ relayed: boolean; relayTxHash?: string; decisionHash?: string }> {
  return apiFetch(`/investigations/${id}/relay`, { method: 'POST', body: '{}' });
}

export function syncEvidenceForInvestigation(investigationId: number | string, txHash?: string): Promise<{ evidence: unknown[] }> {
  return apiFetch(`/evidence/${investigationId}/sync`, { method: 'POST', body: JSON.stringify({ txHash }) });
}

export function syncChallenge(id: number | string, txHash?: string): Promise<{ challenge: unknown }> {
  return apiFetch(`/challenges/${id}/sync`, { method: 'POST', body: JSON.stringify({ txHash }) });
}

export function requestOrphanRecoveryAuthorization(caseId: string): Promise<{ authorization: `0x${string}`; caseId: string; amount: string }> {
  return apiFetch(`/escrow/cases/${encodeURIComponent(caseId)}/recovery-authorization`, { method: 'POST', body: JSON.stringify({}) });
}

export function syncSellerBond(id: number | string, txHash?: string): Promise<{ sellerBond: unknown }> {
  return apiFetch(`/seller-bonds/${id}/sync`, { method: 'POST', body: JSON.stringify({ txHash }) });
}
