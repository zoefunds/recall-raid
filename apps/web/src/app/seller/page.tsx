'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchSellerBonds, syncSellerBond } from '@/lib/api';
import { Card, CardBody } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { EmptyState, ErrorState, Skeleton } from '@/components/ui/States';
import { genToWei, weiToGen } from '@/lib/format';
import { useConnectedAddress } from '@/components/ConnectWalletButton';
import { useContractWrite } from '@/hooks/useContractWrite';
import { useWalletSession } from '@/hooks/useWalletSession';
import { TransactionStatusModal } from '@/components/TransactionStatusModal';

const BOND_STATUS_LABEL: Record<number, string> = { 0: 'ACTIVE', 1: 'DEPLETED', 2: 'WITHDRAWN' };

export default function SellerDashboardPage() {
  const { address, isConnected } = useConnectedAddress();
  const qc = useQueryClient();
  const [bondAmount, setBondAmount] = useState('');
  const write = useContractWrite();
  const { ensureSession } = useWalletSession();

  const bondsQuery = useQuery({
    queryKey: ['seller-bonds', address],
    queryFn: () => fetchSellerBonds(address as string),
    enabled: !!address,
  });

  async function handleCreateBond() {
    await ensureSession();
    const wei = genToWei(bondAmount);
    const res = await write.send('create_seller_bond', [], wei);
    if (res) {
      setBondAmount('');
      try {
        const parsed = typeof res.result === 'string' ? JSON.parse(res.result) : res.result;
        const bondId = (parsed as { bond_id?: number })?.bond_id;
        if (bondId != null) await syncSellerBond(bondId, res.txHash);
      } catch {
        // If the id couldn't be parsed, the periodic deadline-watcher sweep
        // (or a future page load's own on-demand sync) will still pick up
        // the new bond — just not instantly.
      }
      await qc.invalidateQueries({ queryKey: ['seller-bonds', address] });
    }
  }

  if (!isConnected) {
    return (
      <div className="mx-auto max-w-container px-margin-mobile py-16 md:px-margin-desktop">
        <EmptyState title="Connect your wallet" hint="Connect a wallet to view or create a Clean Inventory Bond." />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-container px-margin-mobile py-8 md:px-margin-desktop">
      <h1 className="mb-2 font-sans text-headline-lg">Seller Dashboard</h1>
      <p className="mb-6 max-w-xl text-body-sm text-muted">
        Post a Clean Inventory Bond to signal confidence in a listing. It is only slashed on a confirmed
        RECALL_CONFIRMED verdict against a linked investigation — never on an unfounded claim.
      </p>
      <p className="mb-6 max-w-xl text-body-sm text-secondary">
        This is a voluntary third-party safety bond, not verified proof of storefront ownership — the
        contract cannot confirm a bond owner actually controls the marketplace listing they link it to.
      </p>

      <Card className="mb-8">
        <CardBody>
          <h2 className="mb-3 font-mono text-label-caps uppercase text-muted">Create Clean Inventory Bond</h2>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <label className="flex-1">
              <div className="mb-1 font-mono text-label-caps uppercase text-muted">Amount (GEN)</div>
              <input
                value={bondAmount}
                onChange={(e) => setBondAmount(e.target.value.replace(/[^0-9.]/g, ''))}
                placeholder="e.g. 200"
                className="w-full rounded border border-border-subtle bg-bg-deep px-3 py-2 font-mono text-data-mono text-on-surface focus:border-primary focus:outline-none"
              />
            </label>
            <Button onClick={handleCreateBond} disabled={!Number(bondAmount)} loading={write.status !== 'idle' && write.status !== 'confirmed' && write.status !== 'failed'}>
              Create Bond
            </Button>
          </div>
        </CardBody>
      </Card>

      <h2 className="mb-3 font-sans text-headline-md">Your Bonds</h2>
      {bondsQuery.isError ? (
        <ErrorState title="Could not load your bonds" onRetry={() => bondsQuery.refetch()} />
      ) : bondsQuery.isLoading ? (
        <Skeleton className="h-32 w-full" />
      ) : !bondsQuery.data?.length ? (
        <EmptyState title="No bonds yet" hint="Create one above to start protecting your listings." />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {bondsQuery.data.map((bond) => (
            <Card key={bond.id}>
              <CardBody>
                <div className="mb-2 flex items-center justify-between">
                  <span className="font-mono text-label-caps uppercase text-primary">Bond #{bond.id}</span>
                  <span className="font-mono text-label-caps uppercase text-muted">{BOND_STATUS_LABEL[bond.status]}</span>
                </div>
                <div className="mb-1 font-mono text-headline-md text-on-surface">{weiToGen(bond.bond_deposited_wei)} GEN</div>
                <div className="text-body-sm text-muted">of {weiToGen(bond.bond_wei)} GEN total deposited</div>
                <div className="mt-2 text-body-sm text-muted">Linked investigations: {bond.linked_investigation_count}</div>
                {Number(bond.slashed_total_wei) > 0 && (
                  <div className="mt-1 text-body-sm text-danger">Slashed to date: {weiToGen(bond.slashed_total_wei)} GEN</div>
                )}
              </CardBody>
            </Card>
          ))}
        </div>
      )}

      {write.status !== 'idle' && (
        <TransactionStatusModal status={write.status} message={write.message} txHash={write.txHash} onClose={write.reset} />
      )}
    </div>
  );
}
