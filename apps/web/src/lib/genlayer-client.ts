/**
 * GenLayer contract integration layer.
 *
 * GenLayer is NOT a standard EVM chain from the frontend's point of view:
 * value-moving calls go through the `genlayer-js` client/SDK rather than
 * a plain `viem` `writeContract`. Reown AppKit + wagmi is used only to get
 * the user connected to a browser wallet (MetaMask / WalletConnect /
 * Coinbase Wallet) and to obtain an EIP-1193 provider; genlayer-js is then
 * handed that provider so every write is still signed by the user's own
 * wallet (per memory.md: "the backend never signs a transaction").
 *
 * VERIFIED against the installed genlayer-js@1.2.0 source
 * (node_modules/genlayer-js/dist/index.js): `createClient({ chain, account,
 * provider })` accepts `account` as a plain address STRING (not an Account
 * object from `createAccount` — that helper is for raw-private-key/backend
 * use only and is intentionally NOT used here) plus an optional `provider`,
 * an EIP-1193 provider. Internally, genlayer-js routes wallet-signing RPC
 * methods (eth_sendTransaction, eth_signTransaction, etc.) through
 * `provider.request(...)` when `account` is a string address, and routes
 * everything else directly to the configured GenLayer RPC endpoint. This
 * is exactly the "wallet stays in the browser, signs via its own
 * provider" behavior this app needs, so the browser wallet's EIP-1193
 * provider (obtained from wagmi's active connector) is passed straight
 * through as `provider` below.
 *
 * REMAINING JUDGMENT CALL (flag for confirmation against
 * https://docs.genlayer.com/ / https://skills.genlayer.com/ once live docs
 * are available): the exact shape of `waitForTransactionReceipt`'s status
 * field and what a reverted GenVM call reports there was inferred from
 * this version's TypeScript types, not from a live network response —
 * verify the failure-status string(s) against a real StudioNet revert
 * before relying on `describeChainError` for anything user-critical.
 */

import { createClient } from 'genlayer-js';
import { studionet } from 'genlayer-js/chains';
import { env } from './env';

// genlayer-js@1.2.0 does not export a `GenLayerClient` type directly;
// derive the client's shape from the factory function instead so this
// file stays correct across the package's internal type churn.
type GenLayerClient<TChain = typeof studionet> = ReturnType<typeof createClient> & { chain?: TChain };

export type TxLifecycleStatus =
  | 'idle'
  | 'preparing'
  | 'awaiting-wallet'
  | 'submitted'
  | 'pending'
  | 'confirmed'
  | 'failed'
  | 'rejected'
  | 'timeout';

export interface TxLifecycleEvent {
  status: TxLifecycleStatus;
  txHash?: string;
  message?: string;
}

export type TxProgressHandler = (event: TxLifecycleEvent) => void;

let cachedClient: GenLayerClient<typeof studionet> | null = null;
let cachedAccountKey: string | null = null;

/**
 * Builds (and caches) a genlayer-js client bound to the connected wallet's
 * EIP-1193 provider. Re-creates the client if the connected account
 * changes (wallet switch / account switch).
 */
function getClient(walletAddress: `0x${string}`, provider: unknown): GenLayerClient<typeof studionet> {
  if (cachedClient && cachedAccountKey === walletAddress) {
    return cachedClient;
  }

  cachedClient = createClient({
    chain: {
      ...studionet,
      id: studionet.id,
      rpcUrls: {
        ...studionet.rpcUrls,
        default: { http: [env.genlayerRpcUrl] },
      },
    },
    // A plain address string — NOT createAccount() — so genlayer-js routes
    // signing requests through `provider` (the user's own connected
    // wallet) instead of expecting a raw private key. See file header.
    account: walletAddress,
    provider,
  } as never);
  cachedAccountKey = walletAddress;
  return cachedClient;
}

export function resetGenlayerClientCache(): void {
  cachedClient = null;
  cachedAccountKey = null;
}

interface WriteCallArgs {
  walletAddress: `0x${string}`;
  provider: unknown;
  method: string;
  args?: unknown[];
  value?: bigint;
  onProgress?: TxProgressHandler;
}

/**
 * Generic wrapper around a payable/non-payable contract write, driving the
 * shared transaction lifecycle states used by <TransactionStatusModal />.
 * Every write action in the app (submit_investigation, add_evidence,
 * request_verdict, open_challenge, settle_investigation, withdraw,
 * create_seller_bond, etc.) goes through this single function so error
 * handling and lifecycle reporting stay consistent.
 */
export async function callContractWrite({
  walletAddress,
  provider,
  method,
  args = [],
  value,
  onProgress,
}: WriteCallArgs): Promise<{ txHash: string; result: unknown }> {
  const emit = (event: TxLifecycleEvent) => onProgress?.(event);

  if (!env.contractAddress) {
    emit({ status: 'failed', message: 'The contract address is not configured yet. Please try again later.' });
    throw new Error('Missing NEXT_PUBLIC_GENLAYER_CONTRACT_ADDRESS');
  }

  try {
    emit({ status: 'preparing' });
    const client = getClient(walletAddress, provider);

    emit({ status: 'awaiting-wallet', message: 'Confirm this transaction in your wallet.' });

    // genlayer-js's write call: sends the transaction for the wallet to
    // sign, then returns a transaction hash once the wallet has signed and
    // broadcast it.
    const txHash = await client.writeContract({
      address: env.contractAddress as `0x${string}`,
      functionName: method,
      args,
      value,
    } as never);

    emit({ status: 'submitted', txHash, message: 'Transaction submitted to the network.' });
    emit({ status: 'pending', txHash, message: 'Waiting for consensus confirmation.' });

    const receipt = await client.waitForTransactionReceipt({
      hash: txHash,
      status: 'FINALIZED' as never,
      retries: 40,
      interval: 3000,
    });

    // "FINALIZED" is a decided-and-settled outcome; "UNDETERMINED" and
    // "CANCELED" are the other terminal states genlayer-js's own
    // DECIDED_STATES list recognizes, and both mean the call did not
    // succeed as submitted.
    const receiptStatus = String((receipt as { status?: unknown })?.status ?? '').toUpperCase();
    if (receiptStatus === 'UNDETERMINED' || receiptStatus === 'CANCELED') {
      emit({ status: 'failed', txHash, message: describeChainError(receipt) });
      throw new Error(`Transaction ended in status ${receiptStatus}`);
    }

    emit({ status: 'confirmed', txHash, message: 'Confirmed.' });
    return { txHash, result: receipt };
  } catch (err) {
    const { status, message } = classifyError(err);
    emit({ status, message });
    throw new UserFacingTxError(message, err);
  }
}

interface ReadCallArgs {
  method: string;
  args?: unknown[];
}

/**
 * Read/view calls do not need a connected wallet or a signature — they can
 * be served by a lightweight anonymous client. Prefer the API's cached
 * views (apps/api) for anything that benefits from server-side caching
 * (lists, leaderboard, stats); use this directly only for a single
 * investigation's live on-chain state where freshness matters (e.g. right
 * after submitting a transaction on the detail page).
 */
export async function callContractView<T = unknown>({ method, args = [] }: ReadCallArgs): Promise<T> {
  if (!env.contractAddress) {
    throw new Error('Missing NEXT_PUBLIC_GENLAYER_CONTRACT_ADDRESS');
  }
  const client = createClient({
    chain: { ...studionet, rpcUrls: { ...studionet.rpcUrls, default: { http: [env.genlayerRpcUrl] } } },
  });
  const raw = await client.readContract({
    address: env.contractAddress as `0x${string}`,
    functionName: method,
    args,
  } as never);
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw) as T;
    } catch {
      return raw as unknown as T;
    }
  }
  return raw as T;
}

export class UserFacingTxError extends Error {
  cause?: unknown;
  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = 'UserFacingTxError';
    this.cause = cause;
  }
}

/**
 * Translates raw wallet/RPC errors into plain, non-technical copy. Never
 * surface a raw error object or stack trace to the user.
 */
function classifyError(err: unknown): { status: TxLifecycleStatus; message: string } {
  const raw = err instanceof Error ? err.message : String(err);
  const lower = raw.toLowerCase();

  if (lower.includes('user rejected') || lower.includes('user denied') || lower.includes('rejected the request')) {
    return { status: 'rejected', message: 'You declined the transaction in your wallet.' };
  }
  if (lower.includes('insufficient funds') || lower.includes('insufficient balance')) {
    return { status: 'failed', message: "You don't have enough GEN in your wallet to cover this transaction plus network fees." };
  }
  if (lower.includes('timeout') || lower.includes('timed out')) {
    return { status: 'timeout', message: 'The network took too long to confirm this transaction. It may still complete — check back shortly.' };
  }
  if (lower.includes('network') || lower.includes('fetch failed') || lower.includes('failed to fetch')) {
    return { status: 'failed', message: 'We could not reach the GenLayer network. Check your connection and try again.' };
  }
  if (lower.includes('[expected]')) {
    // Contract-level UserError — strip the internal error-taxonomy prefix
    // documented in the contract (memory.md's four-prefix scheme) before
    // showing it, since the message body itself is usually already
    // user-readable.
    return { status: 'failed', message: raw.replace(/^\[EXPECTED\]\s*/i, '') };
  }
  return { status: 'failed', message: 'Something went wrong submitting this transaction. Please try again.' };
}

function describeChainError(receipt: unknown): string {
  return 'The network rejected this transaction. Please review the details and try again.';
}

/** 20% (CHALLENGE_STAKE_BPS) of the bounty, matching the contract exactly. */
export function computeRequiredChallengeStakeWei(bountyWei: bigint): bigint {
  const CHALLENGE_STAKE_BPS = 2000n;
  const stake = (bountyWei * CHALLENGE_STAKE_BPS) / 10000n;
  return stake <= 0n ? 1n : stake;
}
