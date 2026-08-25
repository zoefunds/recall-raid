'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchLeaderboard } from '@/lib/api';
import { Card } from '@/components/ui/Card';
import { EmptyState, ErrorState, Skeleton } from '@/components/ui/States';
import { formatBps, truncateAddress, weiToGen } from '@/lib/format';

export default function LeaderboardPage() {
  const { data, isLoading, isError, refetch } = useQuery({ queryKey: ['leaderboard'], queryFn: () => fetchLeaderboard(50) });
  const [copied, setCopied] = useState<string | null>(null);

  async function copy(addr: string) {
    try {
      await navigator.clipboard.writeText(addr);
      setCopied(addr);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      // clipboard may be unavailable — non-critical, ignore silently
    }
  }

  return (
    <div className="mx-auto max-w-container px-margin-mobile py-8 md:px-margin-desktop">
      <h1 className="mb-6 font-sans text-headline-lg">Top Investigators</h1>

      {isError ? (
        <ErrorState title="Could not load the leaderboard" onRetry={() => refetch()} />
      ) : isLoading ? (
        <Card>
          <div className="space-y-2 p-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        </Card>
      ) : !data?.length ? (
        <EmptyState title="No investigators yet" hint="Rankings appear once investigations start settling." />
      ) : (
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-border-subtle font-mono text-label-caps uppercase text-muted">
                  <th className="px-4 py-3">Rank</th>
                  <th className="px-4 py-3">Wallet</th>
                  <th className="px-4 py-3">Valid discoveries</th>
                  <th className="px-4 py-3">Accuracy</th>
                  <th className="px-4 py-3">Total earned</th>
                </tr>
              </thead>
              <tbody>
                {data.map((row) => (
                  <tr key={row.address} className="border-b border-border-subtle last:border-0 hover:bg-surface-high/40">
                    <td className="px-4 py-3 font-mono text-data-mono text-primary">#{row.rank}</td>
                    <td className="px-4 py-3">
                      <button onClick={() => copy(row.address)} className="flex items-center gap-2 font-mono text-data-mono text-on-surface">
                        {truncateAddress(row.address)}
                        <span className="text-muted">{copied === row.address ? '✓' : '⧉'}</span>
                      </button>
                    </td>
                    <td className="px-4 py-3 font-mono text-data-mono">{row.valid_discoveries}</td>
                    <td className="px-4 py-3 font-mono text-data-mono text-status-safe">{formatBps(row.accuracy_bps)}</td>
                    <td className="px-4 py-3 font-mono text-data-mono text-secondary">{weiToGen(row.total_earned_wei)} GEN</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
