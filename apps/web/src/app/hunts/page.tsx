'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchInvestigations, syncInvestigationUntilVisible } from '@/lib/api';
import { Card, CardBody } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { HAZARD_BAR_CLASS, HazardChip, InvestigationStatusChip, VerdictChip } from '@/components/ui/StatusChip';
import { VERDICT_DESCRIPTION } from '@/types/contract';
import { CardSkeleton, EmptyState, ErrorState } from '@/components/ui/States';
import { usdcBaseUnitsToDisplay, usdcToBaseUnits } from '@/lib/format';
import { Sidebar, SidebarSection } from '@/components/nav/Sidebar';
import { useWalletSession } from '@/hooks/useWalletSession';

const HAZARD_OPTIONS = [
  { value: 1, label: 'Critical' },
  { value: 2, label: 'High' },
  { value: 3, label: 'Moderate' },
];

const PAGE_SIZE = 12;

export default function HuntsPage() {
  const [hazardFilters, setHazardFilters] = useState<number[]>([]);
  const [category, setCategory] = useState('');
  const [minBounty, setMinBounty] = useState(0); // USDC
  const [page, setPage] = useState(0);
  const [showRecovery, setShowRecovery] = useState(false);
  const [recoveryId, setRecoveryId] = useState('');
  const [recoveryTxHash, setRecoveryTxHash] = useState('');
  const [recoveryError, setRecoveryError] = useState<string | null>(null);
  const [recoveredId, setRecoveredId] = useState<number | null>(null);
  const [recovering, setRecovering] = useState(false);
  const queryClient = useQueryClient();
  const { ensureSession } = useWalletSession();

  const params = useMemo(
    () => ({
      offset: page * PAGE_SIZE,
      limit: PAGE_SIZE,
      category: category || undefined,
      hazard_class: hazardFilters.length ? hazardFilters : undefined,
      min_bounty_wei: minBounty > 0 ? usdcToBaseUnits(minBounty).toString() : undefined,
    }),
    [page, category, hazardFilters, minBounty],
  );

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['investigations', params],
    queryFn: () => fetchInvestigations(params),
    // Keeps the Active Hunts feed live for someone who leaves the tab open
    // rather than only refreshing on refocus/remount, matching the backend
    // deadline-watcher's own resync cadence.
    refetchInterval: 20_000,
  });

  function toggleHazard(v: number) {
    setPage(0);
    setHazardFilters((prev) => (prev.includes(v) ? prev.filter((x) => x !== v) : [...prev, v]));
  }

  async function recoverFinalizedInvestigation() {
    const id = Number(recoveryId);
    if (!Number.isInteger(id) || id <= 0) {
      setRecoveryError('Enter a valid investigation ID.');
      return;
    }
    if (!/^0x[a-fA-F0-9]{64}$/.test(recoveryTxHash)) {
      setRecoveryError('Enter the finalized GenLayer transaction hash for this investigation.');
      return;
    }

    setRecovering(true);
    setRecoveryError(null);
    setRecoveredId(null);
    try {
      // The API authenticates this wallet and independently verifies the
      // finalized transaction, contract, submitter, case ID, and bounty
      // before it writes the cache or registers the Base escrow case.
      await ensureSession();
      const { investigation } = await syncInvestigationUntilVisible(id, recoveryTxHash);
      setPage(0);
      await queryClient.invalidateQueries({ queryKey: ['investigations'] });
      setRecoveredId(investigation.id);
    } catch (error) {
      setRecoveryError(error instanceof Error ? error.message : 'Could not sync this investigation.');
    } finally {
      setRecovering(false);
    }
  }

  const totalPages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;

  return (
    <div className="mx-auto flex max-w-container gap-6 px-margin-mobile py-8 md:px-margin-desktop">
      <Sidebar>
        <SidebarSection title="Category">
          <input
            value={category}
            onChange={(e) => {
              setPage(0);
              setCategory(e.target.value);
            }}
            placeholder="e.g. electronics"
            className="w-full rounded border border-border-subtle bg-bg-deep px-2 py-1.5 font-mono text-data-mono text-on-surface placeholder:text-muted focus:border-primary focus:outline-none"
          />
        </SidebarSection>
        <SidebarSection title="Hazard level">
          <div className="space-y-2">
            {HAZARD_OPTIONS.map((opt) => (
              <label key={opt.value} className="flex items-center gap-2 text-body-sm text-on-surface">
                <input
                  type="checkbox"
                  checked={hazardFilters.includes(opt.value)}
                  onChange={() => toggleHazard(opt.value)}
                  className="accent-primary"
                />
                {opt.label}
              </label>
            ))}
          </div>
        </SidebarSection>
        <SidebarSection title="Min bounty (USDC)">
          <input
            type="range"
            min={0}
            max={1000}
            step={10}
            value={minBounty}
            onChange={(e) => {
              setPage(0);
              setMinBounty(Number(e.target.value));
            }}
            className="w-full accent-primary"
          />
          <div className="mt-1 font-mono text-data-mono text-primary">{minBounty} USDC+</div>
        </SidebarSection>
      </Sidebar>

      <div className="flex-1">
        <div className="mb-4 flex items-center justify-between">
          <h1 className="font-sans text-headline-lg">Active Hunts</h1>
          {data && <span className="font-mono text-body-sm text-muted">{data.total} total</span>}
        </div>

        <Card className="mb-5">
          <CardBody>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="font-mono text-label-caps uppercase text-primary">Missing a finalized hunt?</div>
                <p className="mt-1 text-body-sm text-muted">Sync it from its GenLayer transaction without trusting browser-supplied case data.</p>
              </div>
              <Button type="button" variant="ghost" size="sm" onClick={() => setShowRecovery((visible) => !visible)}>
                {showRecovery ? 'Close sync' : 'Sync finalized hunt'}
              </Button>
            </div>
            {showRecovery && (
              <div className="mt-4 grid gap-3 border-t border-border-subtle pt-4 md:grid-cols-[140px_1fr_auto] md:items-end">
                <label className="block">
                  <span className="mb-1 block font-mono text-label-caps uppercase text-muted">Hunt ID</span>
                  <input
                    inputMode="numeric"
                    value={recoveryId}
                    onChange={(event) => setRecoveryId(event.target.value.replace(/\D/g, ''))}
                    placeholder="e.g. 4"
                    className="w-full rounded border border-border-subtle bg-bg-deep px-3 py-2 font-mono text-data-mono text-on-surface placeholder:text-muted focus:border-primary focus:outline-none"
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block font-mono text-label-caps uppercase text-muted">Finalized GenLayer transaction</span>
                  <input
                    value={recoveryTxHash}
                    onChange={(event) => setRecoveryTxHash(event.target.value.trim())}
                    placeholder="0x…"
                    className="w-full rounded border border-border-subtle bg-bg-deep px-3 py-2 font-mono text-data-mono text-on-surface placeholder:text-muted focus:border-primary focus:outline-none"
                  />
                </label>
                <Button type="button" loading={recovering} onClick={recoverFinalizedInvestigation}>Sync hunt</Button>
                <div className="md:col-span-3">
                  {recoveryError && <p className="text-body-sm text-danger">{recoveryError}</p>}
                  {recoveredId != null && (
                    <p className="text-body-sm text-status-safe">
                      Hunt #{recoveredId} is synced. <Link className="underline" href={`/hunts/${recoveredId}`}>Open it</Link>
                    </p>
                  )}
                </div>
              </div>
            )}
          </CardBody>
        </Card>

        {isError ? (
          <ErrorState title="Could not load hunts" hint="The API may be unreachable." onRetry={() => refetch()} />
        ) : isLoading ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <CardSkeleton key={i} />
            ))}
          </div>
        ) : !data?.items.length ? (
          <EmptyState title="No active hunts match your filters" hint="Try widening your hazard level or bounty range." />
        ) : (
          <>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {data.items.map((inv) => (
                <Link key={inv.id} href={`/hunts/${inv.id}`}>
                  <Card topBarClassName={HAZARD_BAR_CLASS[inv.hazard_class]} className="h-full transition-colors hover:border-primary">
                    <CardBody>
                      <div className="mb-2 flex flex-wrap items-center gap-1.5">
                        <HazardChip hazardClass={inv.hazard_class} />
                        <InvestigationStatusChip status={inv.status} />
                        <VerdictChip verdict={inv.verdict} />
                      </div>
                      <h3 className="mb-1 truncate font-sans text-body-md font-semibold">{inv.product_name}</h3>
                      <p className="mb-1 truncate text-body-sm text-muted">
                        {inv.brand} · {inv.marketplace}
                      </p>
                      {inv.verdict !== 0 ? (
                        <p className="mb-3 line-clamp-2 text-body-sm text-secondary">{VERDICT_DESCRIPTION[inv.verdict]}</p>
                      ) : (
                        <p className="mb-3 line-clamp-2 text-body-sm text-muted">{inv.description}</p>
                      )}
                      <div className="flex items-center justify-between">
                        <span className="font-mono text-data-mono text-primary">{usdcBaseUnitsToDisplay(inv.bounty_wei)} USDC</span>
                        <span className="font-mono text-body-sm text-muted">{inv.evidence_count} evidence</span>
                      </div>
                    </CardBody>
                  </Card>
                </Link>
              ))}
            </div>

            {totalPages > 1 && (
              <div className="mt-6 flex items-center justify-center gap-3">
                <button
                  disabled={page === 0}
                  onClick={() => setPage((p) => Math.max(0, p - 1))}
                  className="rounded border border-border-subtle px-3 py-1.5 text-body-sm text-on-surface disabled:opacity-30"
                >
                  Prev
                </button>
                <span className="font-mono text-body-sm text-muted">
                  {page + 1} / {totalPages}
                </span>
                <button
                  disabled={page >= totalPages - 1}
                  onClick={() => setPage((p) => p + 1)}
                  className="rounded border border-border-subtle px-3 py-1.5 text-body-sm text-on-surface disabled:opacity-30"
                >
                  Next
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
