// Central, typed access to the public env vars documented in
// /Users/macbook/recallraid/.env.example. Only NEXT_PUBLIC_* vars belong
// here — server-only / secret vars must never be referenced from apps/web.

function required(name: string, value: string | undefined, fallback = ''): string {
  if (!value) {
    if (process.env.NODE_ENV !== 'production') {
      // eslint-disable-next-line no-console
      console.warn(`[env] ${name} is not set — using fallback "${fallback}"`);
    }
    return fallback;
  }
  return value;
}

export const env = {
  reownProjectId: required(
    'NEXT_PUBLIC_REOWN_PROJECT_ID',
    process.env.NEXT_PUBLIC_REOWN_PROJECT_ID,
    '12f8ec749466943d20d79fc58594f9cd',
  ),
  apiBaseUrl: required(
    'NEXT_PUBLIC_API_BASE_URL',
    process.env.NEXT_PUBLIC_API_BASE_URL,
    'https://recallraid-api.fly.dev',
  ),
  genlayerChain: required(
    'NEXT_PUBLIC_GENLAYER_CHAIN',
    process.env.NEXT_PUBLIC_GENLAYER_CHAIN,
    'studionet',
  ),
  genlayerRpcUrl: required(
    'NEXT_PUBLIC_GENLAYER_RPC_URL',
    process.env.NEXT_PUBLIC_GENLAYER_RPC_URL,
    'https://studio.genlayer.com/api',
  ),
  contractAddress: process.env.NEXT_PUBLIC_GENLAYER_CONTRACT_ADDRESS || '',
};

export const CONTRACT_ADDRESS_MISSING = !env.contractAddress;
