'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useAccount } from 'wagmi';
import { Card, CardBody } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { EmptyState, Skeleton } from '@/components/ui/States';
import { formatBps, truncateAddress, usdcBaseUnitsToDisplay } from '@/lib/format';
import { useConnectedAddress } from '@/components/ConnectWalletButton';
import { callContractView } from '@/lib/genlayer-client';
import { claimUsdc, readUsdcPosition, recoverOrphanDeposit } from '@/lib/base-sepolia';
import { requestOrphanRecoveryAuthorization } from '@/lib/api';
import { useWalletSession } from '@/hooks/useWalletSession';
import type { Reputation } from '@/types/contract';

export default function WalletPage() {
  const { address, isConnected } = useConnectedAddress();
  const { connector } = useAccount();
  const qc = useQueryClient();
  const [claiming, setClaiming] = useState(false);
  const [claimError, setClaimError] = useState('');
  const [orphanCaseId, setOrphanCaseId] = useState('');
  const [recovering, setRecovering] = useState(false);
  const [recoveryMessage, setRecoveryMessage] = useState('');
  const { ensureSession } = useWalletSession();

  const balanceQuery = useQuery({
    queryKey: ['balance', address],
    queryFn: () => readUsdcPosition(address as `0x${string}`),
    enabled: !!address,
    refetchInterval: 20_000,
  });

  const reputationQuery = useQuery({
    queryKey: ['reputation', address],
    queryFn: () => callContractView<Reputation>({ method: 'get_reputation', args: [address] }),
    enabled: !!address,
  });

  async function handleClaim() {
    if (!address || !connector) return;
    setClaiming(true);
    setClaimError('');
    try {
      const provider = await connector.getProvider();
      await claimUsdc(provider, address);
      await qc.invalidateQueries({ queryKey: ['balance', address] });
    } catch (error) {
      setClaimError(error instanceof Error ? error.message : 'USDC claim failed.');
    } finally {
      setClaiming(false);
    }
  }

  async function handleOrphanRecovery() {
    if (!address || !connector) return;
    setRecovering(true);
    setRecoveryMessage('');
    try {
      await ensureSession();
      const { authorization, caseId } = await requestOrphanRecoveryAuthorization(orphanCaseId.trim());
      const provider = await connector.getProvider();
      await recoverOrphanDeposit(provider, address, caseId as `0x${string}`, authorization);
      setRecoveryMessage('Orphan escrow recovered. Claim the USDC above.');
      await qc.invalidateQueries({ queryKey: ['balance', address] });
    } catch (error) {
      setRecoveryMessage(error instanceof Error ? error.message : 'Orphan escrow recovery failed.');
    } finally {
      setRecovering(false);
    }
  }

  if (!isConnected) {
    return (
      <div className="mx-auto max-w-container px-margin-mobile py-16 md:px-margin-desktop">
        <EmptyState title="Connect your wallet" hint="Connect a wallet to view and claim your Base Sepolia USDC." />
      </div>
    );
  }

  const rep = reputationQuery.data;

  return (
    <div className="mx-auto max-w-container px-margin-mobile py-8 md:px-margin-desktop">
      <h1 className="mb-6 font-sans text-headline-lg">Wallet</h1>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardBody>
            <div className="mb-1 font-mono text-label-caps uppercase text-muted">Connected address</div>
            <div className="mb-4 font-mono text-data-mono text-on-surface">{truncateAddress(address, 6)}</div>

            <div className="mb-1 font-mono text-label-caps uppercase text-muted">Claimable from RecallRaid escrow</div>
            {balanceQuery.isLoading ? (
              <Skeleton className="h-8 w-32" />
            ) : (
              <div className="mb-4 font-mono text-[28px] font-bold text-primary">{usdcBaseUnitsToDisplay(balanceQuery.data?.claimable ?? 0n)} USDC</div>
            )}
            <div className="mb-4 text-body-sm text-muted">Wallet balance: {usdcBaseUnitsToDisplay(balanceQuery.data?.walletBalance ?? 0n)} USDC</div>
            <Button onClick={handleClaim} disabled={!balanceQuery.data?.claimable} loading={claiming}>Claim all USDC</Button>
            {claimError && <p className="mt-2 text-body-sm text-danger">{claimError}</p>}
          </CardBody>
        </Card>

        <Card>
          <CardBody>
            <div className="mb-3 font-mono text-label-caps uppercase text-muted">Recover an unregistered deposit</div>
            <p className="mb-3 text-body-sm text-muted">After seven days, request a signed recovery authorization for a Base case that has no matching GenLayer investigation.</p>
            <input
              aria-label="Base escrow case ID"
              value={orphanCaseId}
              onChange={(event) => setOrphanCaseId(event.target.value)}
              placeholder="0x… 32-byte case ID"
              className="mb-3 w-full rounded border border-border bg-background px-3 py-2 font-mono text-body-sm text-on-surface"
            />
            <Button onClick={handleOrphanRecovery} disabled={!/^0x[a-fA-F0-9]{64}$/.test(orphanCaseId.trim())} loading={recovering}>Check and recover</Button>
            {recoveryMessage && <p className="mt-2 text-body-sm text-muted">{recoveryMessage}</p>}
          </CardBody>
        </Card>

        <Card>
          <CardBody>
            <div className="mb-3 font-mono text-label-caps uppercase text-muted">Reputation</div>
            {reputationQuery.isLoading ? (
              <Skeleton className="h-32 w-full" />
            ) : (
              <div className="grid grid-cols-2 gap-4">
                <Stat label="Valid discoveries" value={rep?.valid_discoveries ?? 0} />
                <Stat label="Invalid reports" value={rep?.invalid_reports ?? 0} />
                <Stat label="Successful challenges" value={rep?.successful_challenges ?? 0} />
                <Stat label="Failed challenges" value={rep?.failed_challenges ?? 0} />
                <Stat label="Accuracy" value={formatBps(rep?.accuracy_bps ?? 0)} />
                <Stat label="Recorded earnings" value={`${usdcBaseUnitsToDisplay(rep?.total_earned_wei ?? '0')} USDC`} />
              </div>
            )}
          </CardBody>
        </Card>
      </div>

    </div>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div>
      <div className="font-mono text-body-sm text-muted">{label}</div>
      <div className="font-mono text-data-mono text-on-surface">{value}</div>
    </div>
  );
}
