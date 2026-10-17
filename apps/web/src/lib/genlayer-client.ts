/**
 * GenLayer contract integration layer.
 *
 * GenLayer is NOT a standard EVM chain from the frontend's point of view:
 * value-moving calls go through the `genlayer-js` client/SDK rather than
 * a plain `viem` `writeContract`. Reown AppKit + wagmi is used only to get
 * the user connected to a browser wallet (MetaMask / WalletConnect /
 * Coinbase Wallet) and to obtain an EIP-1193 provider; genlayer-js is then
 * handed that provider so every write is still signed by the user's own
 * wallet. The backend signs only the final Base Sepolia relay.
 *
 * The installed genlayer-js version accepts `createClient({ chain, account,
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
 * Runtime receipt handling below requires explicit finalized status,
 * successful GenVM execution, and successful consensus before reporting a
 * write as confirmed. The installed SDK's receipt shape should be checked
 * again when upgrading genlayer-js.
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
let cachedProvider: unknown = null;

type Eip1193Provider = {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
};

const STUDIO_CHAIN = {
  ...studionet,
  id: studionet.id,
  rpcUrls: {
    ...studionet.rpcUrls,
    default: { http: [env.genlayerRpcUrl] },
  },
};
const STUDIONET_CHAIN_ID_HEX = `0x${studionet.id.toString(16)}`;

function asEip1193Provider(provider: unknown): Eip1193Provider {
  if (!provider || typeof (provider as Eip1193Provider).request !== 'function') {
    throw new Error('The connected wallet did not provide a GenLayer transaction signer. Disconnect and reconnect your wallet, then try again.');
  }
  return provider as Eip1193Provider;
}

/**
 * AppKit keeps the wallet connected across network changes. That does not
 * guarantee that a subsequent GenLayer write is signed on StudioNet, so
 * assert the chain immediately before every write. This mirrors the Base
 * funding guard and avoids a wallet accepting a signature for whichever
 * network happened to be selected last.
 */
async function ensureStudioNet(provider: unknown): Promise<void> {
  const wallet = asEip1193Provider(provider);
  const currentChainId = async () => String(await wallet.request({ method: 'eth_chainId' })).toLowerCase();
  if ((await currentChainId()) === STUDIONET_CHAIN_ID_HEX) return;

  try {
    await wallet.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: STUDIONET_CHAIN_ID_HEX }] });
  } catch {
    // Wallets use different error shapes for an unknown network. Re-read
    // below and add the network only if the switch did not take effect.
  }

  if ((await currentChainId()) !== STUDIONET_CHAIN_ID_HEX) {
    await wallet.request({
      method: 'wallet_addEthereumChain',
      params: [{
        chainId: STUDIONET_CHAIN_ID_HEX,
        chainName: STUDIO_CHAIN.name,
        nativeCurrency: STUDIO_CHAIN.nativeCurrency,
        rpcUrls: STUDIO_CHAIN.rpcUrls.default.http,
        blockExplorerUrls: STUDIO_CHAIN.blockExplorers?.default ? [STUDIO_CHAIN.blockExplorers.default.url] : undefined,
      }],
    });
    await wallet.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: STUDIONET_CHAIN_ID_HEX }] });
  }

  if ((await currentChainId()) !== STUDIONET_CHAIN_ID_HEX) {
    throw new Error('Please switch your wallet to GenLayer StudioNet to continue.');
  }
}

async function withRateLimitBackoff<T>(fn: () => Promise<T>, retries = 4, baseDelayMs = 1500): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (attempt >= retries || !/rate.?limit/i.test(message)) throw err;
      await new Promise((resolve) => setTimeout(resolve, baseDelayMs * 2 ** attempt));
    }
  }
}

/**
 * Builds (and caches) a genlayer-js client bound to the connected wallet's
 * EIP-1193 provider. Re-creates the client if the connected account
 * changes (wallet switch / account switch).
 */
function getClient(walletAddress: `0x${string}`, provider: unknown): GenLayerClient<typeof studionet> {
  if (cachedClient && cachedAccountKey === walletAddress && cachedProvider === provider) {
    return cachedClient;
  }

  cachedClient = createClient({
    chain: STUDIO_CHAIN,
    // A plain address string — NOT createAccount() — so genlayer-js routes
    // signing requests through `provider` (the user's own connected
    // wallet) instead of expecting a raw private key. See file header.
    account: walletAddress,
    provider,
  } as never);
  cachedAccountKey = walletAddress;
  cachedProvider = provider;
  return cachedClient;
}

export function resetGenlayerClientCache(): void {
  cachedClient = null;
  cachedAccountKey = null;
  cachedProvider = null;
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
 * Contract write return values are nested in the leader receipt rather than
 * at `receipt.result`. Decode the same payload shape used by the integration
 * scripts so callers can reliably use IDs returned by write methods such as
 * submit_investigation, add_evidence, open_challenge, and create_seller_bond.
 */
function decodeContractWriteResult(receipt: unknown): unknown {
  const consensusData = (receipt as { consensus_data?: { leader_receipt?: unknown[] } } | undefined)?.consensus_data;
  const leaderReceipts = consensusData?.leader_receipt ?? [];
  const leader = leaderReceipts.find((item) => (item as { mode?: unknown })?.mode === 'leader') ?? leaderReceipts[0];
  const payload = (leader as { result?: { payload?: unknown } } | undefined)?.result?.payload;

  if (typeof payload === 'string') return payload;
  const readable = (payload as { readable?: unknown } | undefined)?.readable;
  if (typeof readable !== 'string') return receipt;

  try {
    const once = JSON.parse(readable) as unknown;
    if (typeof once === 'string') {
      try {
        return JSON.parse(once) as unknown;
      } catch {
        return once;
      }
    }
    return once;
  } catch {
    return readable;
  }
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
    emit({ status: 'preparing', message: 'Switching your wallet to GenLayer StudioNet.' });
    await ensureStudioNet(provider);
    const client = getClient(walletAddress, provider);

    emit({ status: 'awaiting-wallet', message: 'Confirm this transaction in your wallet.' });

    // genlayer-js's write call: sends the transaction for the wallet to
    // sign, then returns a transaction hash once the wallet has signed and
    // broadcast it.
    const txHash = await withRateLimitBackoff(() => client.writeContract({
      address: env.contractAddress as `0x${string}`,
      functionName: method,
      args,
      value,
    } as never));

    emit({ status: 'submitted', txHash, message: 'Transaction submitted to the network.' });
    emit({ status: 'pending', txHash, message: 'Waiting for consensus confirmation.' });

    const receipt = await client.waitForTransactionReceipt({
      hash: txHash,
      status: 'FINALIZED' as never,
      retries: 40,
      interval: 3000,
    });

    // IMPORTANT: transaction status, execution result, and consensus result
    // are separate fields in genlayer-js. A finalized transaction can still
    // have an execution error or a consensus disagreement, so require all
    // three signals before reporting a write as successful.
    // `statusName` reports lifecycle finality; `txExecutionResultName`
    // reports whether GenVM returned successfully; `resultName` reports the
    // consensus outcome.
    const statusName = String((receipt as { statusName?: unknown; status_name?: unknown })?.statusName ?? (receipt as { status_name?: unknown })?.status_name ?? '').toUpperCase();
    const executionResult = String((receipt as { txExecutionResultName?: unknown; tx_execution_result_name?: unknown })?.txExecutionResultName ?? (receipt as { tx_execution_result_name?: unknown })?.tx_execution_result_name ?? '').toUpperCase();
    const resultName = String((receipt as { result_name?: unknown; resultName?: unknown })?.result_name ?? (receipt as { resultName?: unknown })?.resultName ?? '').toUpperCase();
    const isSuccessfulFinalizedExecution = statusName === 'FINALIZED'
      && executionResult === 'FINISHED_WITH_RETURN'
      && (resultName === 'AGREE' || resultName === 'MAJORITY_AGREE');
    if (!isSuccessfulFinalizedExecution) {
      const isListingVerification = method === 'verify_seller_bond_listing';
      emit({
        status: 'failed',
        txHash,
        message: statusName !== 'FINALIZED' || executionResult !== 'FINISHED_WITH_RETURN'
          ? `The GenVM transaction did not finalize successfully (status: ${statusName || 'unknown'}, execution: ${executionResult || 'unknown'}). No changes were confirmed.`
          : isListingVerification
            ? "The network's validators couldn't reach consensus on this listing verification (result: " + resultName + "). No changes were made — this is safe to retry."
            : "The network's validators could not reach consensus on this action (result: " + resultName + "). No changes were made — this is safe to retry.",
      });
      throw new Error(`Transaction was not a successful finalized GenVM execution (status: ${statusName}, execution: ${executionResult}, consensus: ${resultName})`);
    }

    emit({ status: 'confirmed', txHash, message: 'Confirmed.' });
    return { txHash, result: decodeContractWriteResult(receipt) };
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
    chain: STUDIO_CHAIN,
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
    return { status: 'failed', message: "Your adjudication transaction could not cover the network fee." };
  }
  if (lower.includes('timeout') || lower.includes('timed out')) {
    return { status: 'timeout', message: 'The network took too long to confirm this transaction. It may still complete — check back shortly.' };
  }
  if (lower.includes('network') || lower.includes('fetch failed') || lower.includes('failed to fetch')) {
    return { status: 'failed', message: 'We could not reach the GenLayer network. Check your connection and try again.' };
  }
  if (lower.includes('[expected]')) {
    // Contract-level UserError — strip the internal error-taxonomy prefix
    // documented in the contract's four-prefix scheme before
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
