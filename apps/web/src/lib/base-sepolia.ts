import { createPublicClient, createWalletClient, custom, http, keccak256, stringToHex, type Address, type EIP1193Provider, type Hex } from 'viem';
import { baseSepolia } from 'viem/chains';
import { env } from './env';

export const USDC_ABI = [
  { type: 'function', name: 'approve', stateMutability: 'nonpayable', inputs: [{ name: 'spender', type: 'address' }, { name: 'amount', type: 'uint256' }], outputs: [{ type: 'bool' }] },
  { type: 'function', name: 'balanceOf', stateMutability: 'view', inputs: [{ name: 'account', type: 'address' }], outputs: [{ type: 'uint256' }] },
] as const;

export const ESCROW_ABI = [
  { type: 'function', name: 'usdc', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
  { type: 'function', name: 'fundInvestigation', stateMutability: 'nonpayable', inputs: [{ name: 'caseId', type: 'bytes32' }, { name: 'amount', type: 'uint256' }], outputs: [] },
  { type: 'function', name: 'fundChallenge', stateMutability: 'nonpayable', inputs: [{ name: 'caseId', type: 'bytes32' }, { name: 'amount', type: 'uint256' }], outputs: [] },
  { type: 'function', name: 'recoverOrphanDeposit', stateMutability: 'nonpayable', inputs: [{ name: 'caseId', type: 'bytes32' }, { name: 'authorization', type: 'bytes' }], outputs: [] },
  { type: 'function', name: 'fundSellerBond', stateMutability: 'nonpayable', inputs: [{ name: 'bondId', type: 'bytes32' }, { name: 'amount', type: 'uint256' }], outputs: [] },
  { type: 'function', name: 'linkSellerBond', stateMutability: 'nonpayable', inputs: [{ name: 'caseId', type: 'bytes32' }, { name: 'bondId', type: 'bytes32' }], outputs: [] },
  { type: 'function', name: 'claim', stateMutability: 'nonpayable', inputs: [], outputs: [] },
  { type: 'function', name: 'claimable', stateMutability: 'view', inputs: [{ name: 'account', type: 'address' }], outputs: [{ type: 'uint256' }] },
] as const;

const publicClient = createPublicClient({ chain: baseSepolia, transport: http(env.baseSepoliaRpcUrl) });
const BASE_SEPOLIA_CHAIN_ID = '0x14a34';

export type BaseTransactionProgress = {
  status: 'idle' | 'preparing' | 'awaiting-wallet' | 'submitted' | 'pending' | 'confirmed' | 'failed';
  message?: string;
  txHash?: string;
};

export type BaseTransactionProgressHandler = (event: BaseTransactionProgress) => void;

export function makeEscrowId(kind: 'case' | 'bond', address: string) {
  return keccak256(stringToHex(`recallraid:${kind}:${address.toLowerCase()}:${crypto.randomUUID()}`));
}

function asProvider(provider: unknown): EIP1193Provider {
  if (!provider || typeof (provider as EIP1193Provider).request !== 'function') {
    throw new Error('The connected wallet did not provide a transaction signer. Disconnect and reconnect your wallet, then try again.');
  }
  return provider as EIP1193Provider;
}

/**
 * Keep the switch/add/re-check sequence explicit. Some wallets report a
 * successful add-network request without selecting the new network, which
 * used to leave the following approval/funding call without a usable Base
 * Sepolia signer.
 */
async function ensureBaseSepolia(provider: EIP1193Provider) {
  const currentChain = async () => String(await provider.request({ method: 'eth_chainId' })).toLowerCase();
  if ((await currentChain()) === BASE_SEPOLIA_CHAIN_ID) return;

  const eip1193 = provider as EIP1193Provider;
  try {
    await eip1193.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: BASE_SEPOLIA_CHAIN_ID }] });
  } catch {
    // Error codes are inconsistent across injected wallets. Always attempt
    // an explicit add before reporting failure.
  }

  if ((await currentChain()) !== BASE_SEPOLIA_CHAIN_ID) {
    await eip1193.request({ method: 'wallet_addEthereumChain', params: [{ chainId: BASE_SEPOLIA_CHAIN_ID, chainName: 'Base Sepolia', nativeCurrency: { name: 'Sepolia Ether', symbol: 'ETH', decimals: 18 }, rpcUrls: [env.baseSepoliaRpcUrl], blockExplorerUrls: ['https://sepolia.basescan.org'] }] });
    await eip1193.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: BASE_SEPOLIA_CHAIN_ID }] });
  }

  if ((await currentChain()) !== BASE_SEPOLIA_CHAIN_ID) {
    throw new Error('Please switch your wallet to Base Sepolia before approving USDC.');
  }
}

async function getWallet(provider: unknown) {
  const eip1193 = asProvider(provider);
  await ensureBaseSepolia(eip1193);
  return createWalletClient({ chain: baseSepolia, transport: custom(eip1193) });
}

async function assertEscrowConfiguration() {
  if (!env.baseSepoliaEscrowAddress) throw new Error('Base Sepolia escrow address is not configured.');
  const configuredUsdc = env.baseSepoliaUsdcAddress.toLowerCase();
  const escrowUsdc = await publicClient.readContract({
    address: env.baseSepoliaEscrowAddress as Address,
    abi: ESCROW_ABI,
    functionName: 'usdc',
  });
  if (escrowUsdc.toLowerCase() !== configuredUsdc) {
    throw new Error('The configured escrow is not connected to Base Sepolia USDC. Please contact RecallRaid support.');
  }
}

async function assertFundable(provider: unknown, account: Address, amount: bigint) {
  const eip1193 = asProvider(provider);
  const accounts = (await eip1193.request({ method: 'eth_accounts' })) as string[];
  if (!accounts.some((candidate) => candidate.toLowerCase() === account.toLowerCase())) {
    throw new Error('Your connected account changed. Reconnect the wallet and try again.');
  }
  const [usdcBalance, nativeBalance] = await Promise.all([
    publicClient.readContract({ address: env.baseSepoliaUsdcAddress as Address, abi: USDC_ABI, functionName: 'balanceOf', args: [account] }),
    publicClient.getBalance({ address: account }),
  ]);
  if (usdcBalance < amount) throw new Error('Insufficient Base Sepolia USDC for this bounty. Get test USDC, then try again.');
  if (nativeBalance === 0n) throw new Error('Your wallet needs Base Sepolia ETH for transaction gas. Get test ETH, then try again.');
}

async function send(provider: unknown, account: Address, address: Address, abi: typeof USDC_ABI | typeof ESCROW_ABI, functionName: string, args: readonly unknown[], onProgress?: BaseTransactionProgressHandler, label = 'transaction') {
  onProgress?.({ status: 'awaiting-wallet', message: `Confirm the ${label} in your wallet.` });
  const client = await getWallet(provider);
  const hash = await client.writeContract({ account, address, abi, functionName, args } as never);
  onProgress?.({ status: 'submitted', txHash: hash, message: `${label[0].toUpperCase()}${label.slice(1)} submitted to Base Sepolia.` });
  onProgress?.({ status: 'pending', txHash: hash, message: `Confirming the ${label} on Base Sepolia.` });
  const receipt = await publicClient.waitForTransactionReceipt({ hash, confirmations: 1 });
  if (receipt.status !== 'success') throw new Error(`Base Sepolia transaction failed: ${hash}`);
  return hash;
}

async function approve(provider: unknown, account: Address, amount: bigint, onProgress?: BaseTransactionProgressHandler) {
  if (!env.baseSepoliaEscrowAddress) throw new Error('Base Sepolia escrow address is not configured.');
  return send(provider, account, env.baseSepoliaUsdcAddress as Address, USDC_ABI, 'approve', [env.baseSepoliaEscrowAddress as Address, amount], onProgress, 'USDC approval');
}

export async function fundInvestigation(provider: unknown, account: Address, caseId: Hex, amount: bigint, onProgress?: BaseTransactionProgressHandler) {
  if (amount <= 0n) throw new Error('Enter a USDC bounty greater than zero.');
  onProgress?.({ status: 'preparing', message: 'Checking Base Sepolia, your USDC balance, and the live RecallRaid escrow.' });
  await Promise.all([assertEscrowConfiguration(), assertFundable(provider, account, amount)]);
  const approvalHash = await approve(provider, account, amount, onProgress);
  const fundingHash = await send(provider, account, env.baseSepoliaEscrowAddress as Address, ESCROW_ABI, 'fundInvestigation', [caseId, amount], onProgress, 'escrow funding');
  onProgress?.({ status: 'confirmed', txHash: fundingHash, message: 'USDC is confirmed in the RecallRaid Base Sepolia escrow.' });
  return { approvalHash, fundingHash };
}

export async function fundChallenge(provider: unknown, account: Address, caseId: Hex, amount: bigint) {
  await approve(provider, account, amount);
  return send(provider, account, env.baseSepoliaEscrowAddress as Address, ESCROW_ABI, 'fundChallenge', [caseId, amount]);
}

export async function fundSellerBond(provider: unknown, account: Address, bondId: Hex, amount: bigint) {
  await approve(provider, account, amount);
  return send(provider, account, env.baseSepoliaEscrowAddress as Address, ESCROW_ABI, 'fundSellerBond', [bondId, amount]);
}

export async function linkSellerBond(provider: unknown, account: Address, caseId: Hex, bondId: Hex) {
  return send(provider, account, env.baseSepoliaEscrowAddress as Address, ESCROW_ABI, 'linkSellerBond', [caseId, bondId]);
}

export async function claimUsdc(provider: unknown, account: Address) {
  return send(provider, account, env.baseSepoliaEscrowAddress as Address, ESCROW_ABI, 'claim', []);
}

export async function recoverOrphanDeposit(provider: unknown, account: Address, caseId: Hex, authorization: Hex) {
  return send(provider, account, env.baseSepoliaEscrowAddress as Address, ESCROW_ABI, 'recoverOrphanDeposit', [caseId, authorization]);
}

export async function readUsdcPosition(account: Address) {
  const [walletBalance, claimable] = await Promise.all([
    publicClient.readContract({ address: env.baseSepoliaUsdcAddress as Address, abi: USDC_ABI, functionName: 'balanceOf', args: [account] }),
    publicClient.readContract({ address: env.baseSepoliaEscrowAddress as Address, abi: ESCROW_ABI, functionName: 'claimable', args: [account] }),
  ]);
  return { walletBalance, claimable };
}
