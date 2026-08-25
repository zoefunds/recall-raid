'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { fetchInvestigations } from '@/lib/api';
import { Card, CardBody } from '@/components/ui/Card';
import { HAZARD_BAR_CLASS, HazardChip, InvestigationStatusChip } from '@/components/ui/StatusChip';
import { CardSkeleton, EmptyState, ErrorState } from '@/components/ui/States';
import { weiToGen, genToWei } from '@/lib/format';
import { Sidebar, SidebarSection } from '@/components/nav/Sidebar';

const HAZARD_OPTIONS = [
  { value: 1, label: 'Critical' },
  { value: 2, label: 'High' },
  { value: 3, label: 'Moderate' },
];

const PAGE_SIZE = 12;

export default function HuntsPage() {
  const [hazardFilters, setHazardFilters] = useState<number[]>([]);
  const [category, setCategory] = useState('');
  const [minBounty, setMinBounty] = useState(0); // GEN
  const [page, setPage] = useState(0);

  const params = useMemo(
    () => ({
      offset: page * PAGE_SIZE,
      limit: PAGE_SIZE,
      category: category || undefined,
      hazard_class: hazardFilters.length ? hazardFilters : undefined,
      min_bounty_wei: minBounty > 0 ? genToWei(minBounty).toString() : undefined,
    }),
    [page, category, hazardFilters, minBounty],
  );

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['investigations', params],
    queryFn: () => fetchInvestigations(params),
  });

  function toggleHazard(v: number) {
    setPage(0);
    setHazardFilters((prev) => (prev.includes(v) ? prev.filter((x) => x !== v) : [...prev, v]));
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
        <SidebarSection title="Min bounty (GEN)">
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
          <div className="mt-1 font-mono text-data-mono text-primary">{minBounty} GEN+</div>
        </SidebarSection>
      </Sidebar>

      <div className="flex-1">
        <div className="mb-4 flex items-center justify-between">
          <h1 className="font-sans text-headline-lg">Active Hunts</h1>
          {data && <span className="font-mono text-body-sm text-muted">{data.total} total</span>}
        </div>

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
                      <div className="mb-2 flex items-center justify-between">
                        <HazardChip hazardClass={inv.hazard_class} />
                        <InvestigationStatusChip status={inv.status} />
                      </div>
                      <h3 className="mb-1 truncate font-sans text-body-md font-semibold">{inv.product_name}</h3>
                      <p className="mb-1 truncate text-body-sm text-muted">
                        {inv.brand} · {inv.marketplace}
                      </p>
                      <p className="mb-3 line-clamp-2 text-body-sm text-muted">{inv.description}</p>
                      <div className="flex items-center justify-between">
                        <span className="font-mono text-data-mono text-primary">{weiToGen(inv.bounty_wei)} GEN</span>
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
