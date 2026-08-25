'use client';

// Reown AppKit + wagmi configuration. This is the wallet-connection layer
// only (MetaMask, WalletConnect, Coinbase Wallet) — actual contract calls
// go through src/lib/genlayer-client.ts, not through wagmi's writeContract,
// because GenLayer's write path is genlayer-js, not a plain EVM call.
import { createAppKit } from '@reown/appkit/react';
import { WagmiAdapter } from '@reown/appkit-adapter-wagmi';
import { defineChain } from 'viem';
import { env } from './env';

// GenLayer StudioNet does not ship as a built-in viem/wagmi chain preset,
// so it is declared here as a custom EVM-compatible chain purely for
// wallet-connection purposes (chain switching prompts, RPC display). The
// numeric chain id is a placeholder pending the deployed network's real
// id — JUDGMENT CALL: confirm the actual StudioNet chain id against
// https://docs.genlayer.com/ before mainnet; using the wrong id only
// affects the wallet's "switch network" UX, not genlayer-js's own RPC
// calls, which target env.genlayerRpcUrl directly.
export const genlayerStudioNet = defineChain({
  id: 61_999,
  name: 'GenLayer StudioNet',
  nativeCurrency: { name: 'GEN', symbol: 'GEN', decimals: 18 },
  rpcUrls: {
    default: { http: [env.genlayerRpcUrl] },
  },
  testnet: true,
});

export const wagmiAdapter = new WagmiAdapter({
  networks: [genlayerStudioNet],
  projectId: env.reownProjectId,
  ssr: true,
});

let initialized = false;

export function initAppKit() {
  if (initialized || typeof window === 'undefined') return;
  initialized = true;
  createAppKit({
    adapters: [wagmiAdapter],
    networks: [genlayerStudioNet],
    projectId: env.reownProjectId,
    metadata: {
      name: 'RecallRaid',
      description: 'Find the danger. Claim the bounty.',
      url: typeof window !== 'undefined' ? window.location.origin : 'https://recallraid.vercel.app',
      icons: ['/icon.svg'],
    },
    features: {
      email: false,
      socials: false,
      analytics: false,
    },
    // MetaMask, WalletConnect, and Coinbase Wallet per the locked decision
    // in memory.md — AppKit surfaces these automatically via the wagmi
    // adapter's default connector set; no extra config needed beyond the
    // project id.
  });
}

export const wagmiConfig = wagmiAdapter.wagmiConfig;
