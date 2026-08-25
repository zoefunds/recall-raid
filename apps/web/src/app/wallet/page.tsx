'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Card, CardBody } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { EmptyState, Skeleton } from '@/components/ui/States';
import { formatBps, truncateAddress, weiToGen, genToWei } from '@/lib/format';
import { useConnectedAddress } from '@/components/ConnectWalletButton';
import { callContractView } from '@/lib/genlayer-client';
import { useContractWrite } from '@/hooks/useContractWrite';
import { TransactionStatusModal } from '@/components/TransactionStatusModal';
import type { Reputation } from '@/types/contract';

export default function WalletPage() {
  const { address, isConnected } = useConnectedAddress();
  const qc = useQueryClient();
  const [withdrawAmount, setWithdrawAmount] = useState('');
  const write = useContractWrite();

  const balanceQuery = useQuery({
    queryKey: ['balance', address],
    queryFn: () => callContractView<string>({ method: 'get_balance', args: [address] }),
    enabled: !!address,
    refetchInterval: 20_000,
  });

  const reputationQuery = useQuery({
    queryKey: ['reputation', address],
    queryFn: () => callContractView<Reputation>({ method: 'get_reputation', args: [address] }),
    enabled: !!address,
  });

  async function handleWithdraw() {
    const wei = genToWei(withdrawAmount);
    const res = await write.send('withdraw', [wei.toString()]);
    if (res) {
      setWithdrawAmount('');
      await qc.invalidateQueries({ queryKey: ['balance', address] });
    }
  }

  if (!isConnected) {
    return (
      <div className="mx-auto max-w-container px-margin-mobile py-16 md:px-margin-desktop">
        <EmptyState title="Connect your wallet" hint="Connect a wallet to view your GEN balance and earnings." />
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

            <div className="mb-1 font-mono text-label-caps uppercase text-muted">Withdrawable balance</div>
            {balanceQuery.isLoading ? (
              <Skeleton className="h-8 w-32" />
            ) : (
              <div className="mb-4 font-mono text-[28px] font-bold text-primary">{weiToGen(balanceQuery.data ?? '0')} GEN</div>
            )}

            <div className="flex flex-col gap-2 sm:flex-row">
              <input
                value={withdrawAmount}
                onChange={(e) => setWithdrawAmount(e.target.value.replace(/[^0-9.]/g, ''))}
                placeholder="Amount to withdraw"
                className="flex-1 rounded border border-border-subtle bg-bg-deep px-3 py-2 font-mono text-data-mono text-on-surface focus:border-primary focus:outline-none"
              />
              <Button onClick={handleWithdraw} disabled={!Number(withdrawAmount)} loading={write.status !== 'idle' && !['confirmed', 'failed', 'rejected', 'timeout'].includes(write.status)}>
                Withdraw
              </Button>
            </div>
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
                <Stat label="Total earned" value={`${weiToGen(rep?.total_earned_wei ?? '0')} GEN`} />
              </div>
            )}
          </CardBody>
        </Card>
      </div>

      {write.status !== 'idle' && (
        <TransactionStatusModal status={write.status} message={write.message} txHash={write.txHash} onClose={write.reset} />
      )}
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
