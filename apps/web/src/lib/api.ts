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
