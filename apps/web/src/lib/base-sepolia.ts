import { createPublicClient, createWalletClient, custom, http, keccak256, stringToHex, type Address, type EIP1193Provider, type Hex } from 'viem';
import { baseSepolia } from 'viem/chains';
import { env } from './env';

export const USDC_ABI = [
  { type: 'function', name: 'approve', stateMutability: 'nonpayable', inputs: [{ name: 'spender', type: 'address' }, { name: 'amount', type: 'uint256' }], outputs: [{ type: 'bool' }] },
  { type: 'function', name: 'balanceOf', stateMutability: 'view', inputs: [{ name: 'account', type: 'address' }], outputs: [{ type: 'uint256' }] },
] as const;

export const ESCROW_ABI = [
  { type: 'function', name: 'fundInvestigation', stateMutability: 'nonpayable', inputs: [{ name: 'caseId', type: 'bytes32' }, { name: 'amount', type: 'uint256' }], outputs: [] },
  { type: 'function', name: 'fundChallenge', stateMutability: 'nonpayable', inputs: [{ name: 'caseId', type: 'bytes32' }, { name: 'amount', type: 'uint256' }], outputs: [] },
  { type: 'function', name: 'fundSellerBond', stateMutability: 'nonpayable', inputs: [{ name: 'bondId', type: 'bytes32' }, { name: 'amount', type: 'uint256' }], outputs: [] },
  { type: 'function', name: 'linkSellerBond', stateMutability: 'nonpayable', inputs: [{ name: 'caseId', type: 'bytes32' }, { name: 'bondId', type: 'bytes32' }], outputs: [] },
  { type: 'function', name: 'claim', stateMutability: 'nonpayable', inputs: [], outputs: [] },
  { type: 'function', name: 'claimable', stateMutability: 'view', inputs: [{ name: 'account', type: 'address' }], outputs: [{ type: 'uint256' }] },
] as const;

const publicClient = createPublicClient({ chain: baseSepolia, transport: http(env.baseSepoliaRpcUrl) });

export function makeEscrowId(kind: 'case' | 'bond', address: string) {
  return keccak256(stringToHex(`recallraid:${kind}:${address.toLowerCase()}:${crypto.randomUUID()}`));
}

async function getWallet(provider: unknown) {
  const eip1193 = provider as EIP1193Provider;
  try {
    await eip1193.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: '0x14a34' }] });
  } catch (error) {
    if ((error as { code?: number }).code !== 4902) throw error;
    await eip1193.request({ method: 'wallet_addEthereumChain', params: [{ chainId: '0x14a34', chainName: 'Base Sepolia', nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 }, rpcUrls: [env.baseSepoliaRpcUrl], blockExplorerUrls: ['https://sepolia.basescan.org'] }] });
  }
  return createWalletClient({ chain: baseSepolia, transport: custom(eip1193) });
}

async function send(provider: unknown, account: Address, address: Address, abi: typeof USDC_ABI | typeof ESCROW_ABI, functionName: string, args: readonly unknown[]) {
  const client = await getWallet(provider);
  const hash = await client.writeContract({ account, address, abi, functionName, args } as never);
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== 'success') throw new Error(`Base Sepolia transaction failed: ${hash}`);
  return hash;
}

async function approve(provider: unknown, account: Address, amount: bigint) {
  if (!env.baseSepoliaEscrowAddress) throw new Error('Base Sepolia escrow address is not configured.');
  return send(provider, account, env.baseSepoliaUsdcAddress as Address, USDC_ABI, 'approve', [env.baseSepoliaEscrowAddress as Address, amount]);
}

export async function fundInvestigation(provider: unknown, account: Address, caseId: Hex, amount: bigint) {
  await approve(provider, account, amount);
  return send(provider, account, env.baseSepoliaEscrowAddress as Address, ESCROW_ABI, 'fundInvestigation', [caseId, amount]);
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

export async function readUsdcPosition(account: Address) {
  const [walletBalance, claimable] = await Promise.all([
    publicClient.readContract({ address: env.baseSepoliaUsdcAddress as Address, abi: USDC_ABI, functionName: 'balanceOf', args: [account] }),
    publicClient.readContract({ address: env.baseSepoliaEscrowAddress as Address, abi: ESCROW_ABI, functionName: 'claimable', args: [account] }),
  ]);
  return { walletBalance, claimable };
}
