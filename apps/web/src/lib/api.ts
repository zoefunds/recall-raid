import { env } from './env';
import type { Evidence, Investigation, LeaderboardRow, PlatformStats, SellerBond } from '@/types/contract';

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

export function syncEvidenceForInvestigation(investigationId: number | string, txHash?: string): Promise<{ evidence: unknown[] }> {
  return apiFetch(`/evidence/${investigationId}/sync`, { method: 'POST', body: JSON.stringify({ txHash }) });
}

export function syncChallenge(id: number | string, txHash?: string): Promise<{ challenge: unknown }> {
  return apiFetch(`/challenges/${id}/sync`, { method: 'POST', body: JSON.stringify({ txHash }) });
}

export function syncSellerBond(id: number | string, txHash?: string): Promise<{ sellerBond: unknown }> {
  return apiFetch(`/seller-bonds/${id}/sync`, { method: 'POST', body: JSON.stringify({ txHash }) });
}
