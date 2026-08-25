'use client';

import { useCallback, useState } from 'react';
import { useAccount } from 'wagmi';
import { callContractWrite, type TxLifecycleEvent, type TxLifecycleStatus } from '@/lib/genlayer-client';

export function useContractWrite() {
  const { address, isConnected, connector } = useAccount();
  const [status, setStatus] = useState<TxLifecycleStatus>('idle');
  const [message, setMessage] = useState<string | undefined>();
  const [txHash, setTxHash] = useState<string | undefined>();

  const reset = useCallback(() => {
    setStatus('idle');
    setMessage(undefined);
    setTxHash(undefined);
  }, []);

  const send = useCallback(
    async (method: string, args: unknown[] = [], value?: bigint) => {
      if (!isConnected || !address) {
        setStatus('failed');
        setMessage('Connect your wallet first.');
        return null;
      }
      const onProgress = (event: TxLifecycleEvent) => {
        setStatus(event.status);
        if (event.message) setMessage(event.message);
        if (event.txHash) setTxHash(event.txHash);
      };
      try {
        if (!connector) {
          onProgress({ status: 'failed', message: 'No wallet connector is active.' });
          return null;
        }
        // The connector's own EIP-1193 provider (MetaMask / WalletConnect /
        // Coinbase Wallet, whichever is active) — handed to genlayer-js so
        // it can route signing requests through the user's own wallet.
        // See src/lib/genlayer-client.ts for how this is consumed.
        const provider = await connector.getProvider();
        const result = await callContractWrite({
          walletAddress: address,
          provider,
          method,
          args,
          value,
          onProgress,
        });
        return result;
      } catch {
        // state already set by onProgress inside callContractWrite
        return null;
      }
    },
    [address, isConnected, connector],
  );

  return { send, status, message, txHash, reset, isConnected, address };
}
