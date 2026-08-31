'use client';

import { useParams } from 'next/navigation';
import Image from 'next/image';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchChallengesForInvestigation, fetchEvidenceForInvestigation, fetchInvestigation, syncChallenge, syncInvestigation } from '@/lib/api';
import { useWalletSession } from '@/hooks/useWalletSession';
import { Card, CardBody } from '@/components/ui/Card';
import { HAZARD_BAR_CLASS, HazardChip, InvestigationStatusChip, VerdictChip } from '@/components/ui/StatusChip';
import { EmptyState, ErrorState, Skeleton } from '@/components/ui/States';
import { Button } from '@/components/ui/Button';
import { formatCountdown, formatDate, truncateAddress, weiToGen } from '@/lib/format';
import { ChallengeStatus, InvestigationStatus, VERDICT_DESCRIPTION, VERDICT_LABEL } from '@/types/contract';
import { useContractWrite } from '@/hooks/useContractWrite';
import { TransactionStatusModal } from '@/components/TransactionStatusModal';
import { computeRequiredChallengeStakeWei } from '@/lib/genlayer-client';
import { useConnectedAddress } from '@/components/ConnectWalletButton';
import { useState } from 'react';

export default function InvestigationDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const qc = useQueryClient();

  const invQuery = useQuery({
    queryKey: ['investigation', id],
    queryFn: () => fetchInvestigation(id),
    refetchInterval: 15_000,
  });
  const evidenceQuery = useQuery({
    queryKey: ['evidence', id],
    queryFn: () => fetchEvidenceForInvestigation(id),
    enabled: !!invQuery.data,
  });
  const challengesQuery = useQuery({
    queryKey: ['challenges', id],
    queryFn: () => fetchChallengesForInvestigation(id),
    enabled: !!invQuery.data && !!invQuery.data.open_challenge_id,
    refetchInterval: 15_000,
  });

  const write = useContractWrite();
  const { isConnected } = useConnectedAddress();
  const { ensureSession } = useWalletSession();
  const [challengeReason, setChallengeReason] = useState('');

  if (invQuery.isLoading) {
    return (
      <div className="mx-auto max-w-container px-margin-mobile py-8 md:px-margin-desktop">
        <Skeleton className="mb-4 h-8 w-1/2" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }
  if (invQuery.isError || !invQuery.data) {
    return (
      <div className="mx-auto max-w-container px-margin-mobile py-8 md:px-margin-desktop">
        <ErrorState title="Investigation not found" onRetry={() => invQuery.refetch()} />
      </div>
    );
  }

  const inv = invQuery.data;

  async function refreshAfterTx(txHash?: string) {
    // Tell the API to re-pull this investigation from chain BEFORE asking
    // react-query to refetch — otherwise the refetch just re-reads whatever
    // was already sitting in the Postgres cache, which is exactly the
    // staleness this is meant to prevent.
    await syncInvestigation(inv.id, txHash);
    await qc.invalidateQueries({ queryKey: ['investigation', id] });
    await qc.invalidateQueries({ queryKey: ['evidence', id] });
  }

  async function refreshChallengeAfterTx(challengeId: number, txHash?: string) {
    await syncChallenge(challengeId, txHash);
    await syncInvestigation(inv.id, txHash);
    await qc.invalidateQueries({ queryKey: ['investigation', id] });
    await qc.invalidateQueries({ queryKey: ['challenges', id] });
  }

  async function handleRequestVerdict() {
    await ensureSession();
    const res = await write.send('request_verdict', [inv.id]);
    if (res) await refreshAfterTx(res.txHash);
  }

  async function handleOpenChallenge() {
    await ensureSession();
    const stake = computeRequiredChallengeStakeWei(BigInt(inv.bounty_wei));
    const res = await write.send('open_challenge', [inv.id, challengeReason || 'Disputing verdict'], stake);
    if (res) await refreshAfterTx(res.txHash);
  }

  async function handleSettle() {
    await ensureSession();
    const res = await write.send('settle_investigation', [inv.id]);
    if (res) await refreshAfterTx(res.txHash);
  }

  const openChallenge = challengesQuery.data?.challenges.find((c) => c.status === ChallengeStatus.OPEN);

  async function handleResolveChallenge() {
    if (!openChallenge) return;
    await ensureSession();
    const res = await write.send('resolve_challenge', [openChallenge.id]);
    if (res) await refreshChallengeAfterTx(openChallenge.id, res.txHash);
  }

  async function handleClaimChallengeTimeout() {
    if (!openChallenge) return;
    await ensureSession();
    const res = await write.send('claim_challenge_timeout', [openChallenge.id]);
    if (res) await refreshChallengeAfterTx(openChallenge.id, res.txHash);
  }

  const now = Date.now() / 1000;
  const canRequestVerdict = inv.status === InvestigationStatus.EVIDENCE_SUBMITTED;
  const canOpenChallenge = inv.status === InvestigationStatus.VERDICT_REACHED && now < inv.challenge_deadline;
  const canSettle = inv.status === InvestigationStatus.VERDICT_REACHED && now >= inv.challenge_deadline && !inv.settled;
  // resolve_challenge and claim_challenge_timeout are both permissionless
  // (no sender-address check in the contract) — anyone can trigger
  // resolution or, once the resolution window has genuinely elapsed,
  // sweep an abandoned challenge. The UI still only offers the timeout
  // action once the real on-chain deadline has passed, matching the
  // project's "never force a deadline-gated call early" rule.
  const canResolveChallenge = !!openChallenge;
  const canClaimChallengeTimeout = !!openChallenge && now >= openChallenge.resolution_deadline;

  return (
    <div className="mx-auto max-w-container px-margin-mobile py-8 md:px-margin-desktop">
      <Header inv={inv} />

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-[1fr_1fr_320px]">
        <EvidenceGallery evidenceQuery={evidenceQuery} />
        <Timeline inv={inv} />
        <BountyPanel
          inv={inv}
          isConnected={isConnected}
          canRequestVerdict={canRequestVerdict}
          canOpenChallenge={canOpenChallenge}
          canSettle={canSettle}
          canResolveChallenge={canResolveChallenge}
          canClaimChallengeTimeout={canClaimChallengeTimeout}
          openChallenge={openChallenge}
          challengeReason={challengeReason}
          setChallengeReason={setChallengeReason}
          onRequestVerdict={handleRequestVerdict}
          onOpenChallenge={handleOpenChallenge}
          onSettle={handleSettle}
          onResolveChallenge={handleResolveChallenge}
          onClaimChallengeTimeout={handleClaimChallengeTimeout}
          txStatus={write.status}
        />
      </div>

      {write.status !== 'idle' && (
        <TransactionStatusModal status={write.status} message={write.message} txHash={write.txHash} onClose={write.reset} />
      )}
    </div>
  );
}

function Header({ inv }: { inv: Awaited<ReturnType<typeof fetchInvestigation>> }) {
  return (
    <Card topBarClassName={HAZARD_BAR_CLASS[inv.hazard_class]}>
      <CardBody className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <HazardChip hazardClass={inv.hazard_class} />
            <InvestigationStatusChip status={inv.status} />
            <VerdictChip verdict={inv.verdict} />
          </div>
          <h1 className="font-sans text-headline-lg">{inv.product_name}</h1>
          <p className="mt-1 text-body-sm text-muted">
            {inv.brand} {inv.model_number && `· ${inv.model_number}`} · listed on {inv.marketplace}
          </p>
          {inv.verdict !== 0 && (
            <p className="mt-2 max-w-2xl text-body-sm text-secondary">
              <span className="font-mono uppercase text-on-surface">What this means: </span>
              {VERDICT_DESCRIPTION[inv.verdict]}
              {inv.ai_confidence_bps ? ` (${(inv.ai_confidence_bps / 100).toFixed(0)}% model confidence)` : ''}
            </p>
          )}
        </div>
        <a
          href={inv.marketplace_url}
          target="_blank"
          rel="noreferrer"
          className="shrink-0 rounded border border-primary px-3 py-1.5 text-center font-mono text-label-caps uppercase text-primary hover:bg-primary/10"
        >
          View listing ↗
        </a>
      </CardBody>
    </Card>
  );
}

function EvidenceGallery({ evidenceQuery }: { evidenceQuery: ReturnType<typeof useQuery<Awaited<ReturnType<typeof fetchEvidenceForInvestigation>>>> }) {
  const { data, isLoading, isError, refetch } = evidenceQuery;
  return (
    <Card>
      <CardBody>
        <h2 className="mb-3 font-mono text-label-caps uppercase text-muted">Evidence Gallery</h2>
        {isError ? (
          <ErrorState title="Could not load evidence" onRetry={() => refetch()} />
        ) : isLoading ? (
          <div className="space-y-3">
            <Skeleton className="h-32 w-full" />
            <Skeleton className="h-32 w-full" />
          </div>
        ) : !data?.length ? (
          <EmptyState title="No evidence submitted yet" />
        ) : (
          <div className="space-y-3">
            {data.map((ev) => (
              <div key={ev.id} className="locked-evidence overflow-hidden rounded border border-border-subtle bg-bg-deep">
                {['product_photo', 'listing_screenshot'].includes(ev.evidence_type) ? (
                  <div className="relative h-40 w-full bg-surface-high">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={ev.url} alt={ev.description || ev.evidence_type} className="h-full w-full object-cover" />
                  </div>
                ) : (
                  <a href={ev.url} target="_blank" rel="noreferrer" className="block p-4 text-primary underline">
                    View document ↗
                  </a>
                )}
                <div className="p-3">
                  <div className="mb-1 flex items-center justify-between">
                    <span className="font-mono text-label-caps uppercase text-muted">{ev.evidence_type.replace('_', ' ')}</span>
                    <span className="font-mono text-body-sm text-muted">{formatDate(ev.submitted_at)}</span>
                  </div>
                  {ev.description && <p className="mb-1 text-body-sm text-on-surface">{ev.description}</p>}
                  <p className="truncate font-mono text-body-sm text-muted" title={ev.content_hash}>
                    sha256: {ev.content_hash.slice(0, 16)}…
                  </p>
                  {ev.url_checked ? (
                    ev.content_hash_verified ? (
                      <span className="mt-1 inline-block rounded bg-primary/10 px-2 py-0.5 font-mono text-label-caps uppercase text-primary">
                        Hash verified
                      </span>
                    ) : (
                      <span className="mt-1 inline-block rounded bg-danger/10 px-2 py-0.5 font-mono text-label-caps uppercase text-danger">
                        {ev.url_reachable ? 'Hash mismatch' : 'URL unreachable'}
                      </span>
                    )
                  ) : (
                    <span className="mt-1 inline-block rounded bg-surface-high px-2 py-0.5 font-mono text-label-caps uppercase text-muted">
                      Not yet verified
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardBody>
    </Card>
  );
}

function Timeline({ inv }: { inv: Awaited<ReturnType<typeof fetchInvestigation>> }) {
  // Real state-transition timeline derived from the investigation's actual
  // on-chain fields, not a hardcoded sequence — only steps the investigation
  // has actually reached (by status/timestamps present) are shown as done.
  type Step = { label: string; done: boolean; timestamp?: number; note?: string };
  const steps: Step[] = [
    { label: 'OPEN', done: true, timestamp: inv.created_at, note: 'Bounty escrowed' },
    {
      label: 'EVIDENCE_SUBMITTED',
      done: inv.evidence_count > 0,
      note: `${inv.evidence_count} evidence item(s)`,
    },
    {
      label: 'INVESTIGATING → VERDICT_REACHED',
      done: inv.verdict !== 0 && inv.status !== InvestigationStatus.EVIDENCE_SUBMITTED,
      note: inv.verdict
        ? `Verdict: ${VERDICT_LABEL[inv.verdict] ?? 'UNKNOWN'}${inv.ai_confidence_bps ? ` (${(inv.ai_confidence_bps / 100).toFixed(0)}% confidence)` : ''}`
        : undefined,
      timestamp: inv.verdict_deadline || undefined,
    },
    {
      label: 'CHALLENGE_WINDOW',
      done: inv.status >= InvestigationStatus.VERDICT_REACHED && inv.status !== InvestigationStatus.INVALID,
      note:
        inv.status === InvestigationStatus.CHALLENGE_WINDOW
          ? 'Challenge in progress'
          : inv.challenge_deadline
            ? `Closes ${formatDate(inv.challenge_deadline)}`
            : undefined,
    },
    {
      label: 'SETTLED',
      done: inv.status === InvestigationStatus.SETTLED,
      note: inv.settled ? 'Funds released' : undefined,
    },
  ];

  const terminalOverride =
    inv.status === InvestigationStatus.INVALID
      ? 'INVALID — evidence/verdict window expired, submitter refunded'
      : inv.status === InvestigationStatus.CANCELLED
        ? 'CANCELLED by submitter'
        : null;

  return (
    <Card>
      <CardBody>
        <h2 className="mb-4 font-mono text-label-caps uppercase text-muted">Investigation Timeline</h2>
        {terminalOverride && (
          <div className="mb-4 rounded border border-danger/40 bg-danger/10 p-3 text-body-sm text-danger">{terminalOverride}</div>
        )}
        <ol className="relative space-y-5 border-l border-border-subtle pl-5">
          {steps.map((s) => (
            <li key={s.label} className="relative">
              <span
                className={`absolute -left-[26px] top-0.5 flex h-4 w-4 items-center justify-center rounded-full border ${
                  s.done ? 'border-primary bg-primary/20 text-primary' : 'border-outline-variant text-muted'
                }`}
              >
                {s.done ? '◆' : '○'}
              </span>
              <div className={`font-mono text-data-mono uppercase ${s.done ? 'text-on-surface' : 'text-muted'}`}>{s.label}</div>
              {s.note && <div className="text-body-sm text-muted">{s.note}</div>}
              {s.timestamp ? <div className="text-body-sm text-muted">{formatDate(s.timestamp)}</div> : null}
            </li>
          ))}
        </ol>
      </CardBody>
    </Card>
  );
}

function BountyPanel({
  inv,
  isConnected,
  canRequestVerdict,
  canOpenChallenge,
  canSettle,
  canResolveChallenge,
  canClaimChallengeTimeout,
  openChallenge,
  challengeReason,
  setChallengeReason,
  onRequestVerdict,
  onOpenChallenge,
  onSettle,
  onResolveChallenge,
  onClaimChallengeTimeout,
  txStatus,
}: {
  inv: Awaited<ReturnType<typeof fetchInvestigation>>;
  isConnected: boolean;
  canRequestVerdict: boolean;
  canOpenChallenge: boolean;
  canSettle: boolean;
  canResolveChallenge: boolean;
  canClaimChallengeTimeout: boolean;
  openChallenge: Awaited<ReturnType<typeof fetchChallengesForInvestigation>>['challenges'][number] | undefined;
  challengeReason: string;
  setChallengeReason: (v: string) => void;
  onRequestVerdict: () => void;
  onOpenChallenge: () => void;
  onSettle: () => void;
  onResolveChallenge: () => void;
  onClaimChallengeTimeout: () => void;
  txStatus: string;
}) {
  const busy = !['idle', 'confirmed', 'failed', 'rejected', 'timeout'].includes(txStatus);
  const requiredStake = computeRequiredChallengeStakeWei(BigInt(inv.bounty_wei));

  return (
    <Card className="h-fit">
      <CardBody className="space-y-4">
        <div>
          <div className="mb-1 font-mono text-label-caps uppercase text-muted">Bounty</div>
          <div className="font-mono text-[28px] font-bold text-primary">{weiToGen(inv.bounty_wei)} GEN</div>
          <div className="font-mono text-body-sm text-muted">{weiToGen(inv.bounty_deposited_wei)} GEN currently escrowed</div>
        </div>

        {inv.challenge_deadline > 0 && (
          <div className="rounded border border-border-subtle bg-bg-deep p-3">
            <div className="mb-1 font-mono text-label-caps uppercase text-muted">Challenge deadline</div>
            <div className="font-mono text-data-mono text-secondary">{formatCountdown(inv.challenge_deadline)}</div>
          </div>
        )}

        <div>
          <div className="mb-1 font-mono text-label-caps uppercase text-muted">Submitter</div>
          <div className="font-mono text-data-mono text-muted">{truncateAddress(inv.submitter)}</div>
        </div>

        {!isConnected && <p className="text-body-sm text-muted">Connect your wallet to take action on this investigation.</p>}

        {isConnected && canRequestVerdict && (
          <Button className="w-full" onClick={onRequestVerdict} loading={busy}>
            Request Verdict
          </Button>
        )}

        {isConnected && canOpenChallenge && (
          <div className="space-y-2 rounded border border-secondary/30 bg-secondary/5 p-3">
            <div className="font-mono text-label-caps uppercase text-secondary">Open a Challenge</div>
            <p className="text-body-sm text-muted">Requires a stake of {weiToGen(requiredStake.toString())} GEN (20% of bounty).</p>
            <textarea
              value={challengeReason}
              onChange={(e) => setChallengeReason(e.target.value)}
              placeholder="Why is this verdict wrong?"
              className="w-full rounded border border-border-subtle bg-bg-deep p-2 text-body-sm text-on-surface placeholder:text-muted focus:border-primary focus:outline-none"
              rows={2}
            />
            <Button variant="tactical" className="w-full" onClick={onOpenChallenge} loading={busy} disabled={!challengeReason.trim()}>
              Open Challenge
            </Button>
          </div>
        )}

        {isConnected && canSettle && (
          <Button className="w-full" variant="ghost" onClick={onSettle} loading={busy}>
            Settle Investigation
          </Button>
        )}

        {isConnected && openChallenge && (canResolveChallenge || canClaimChallengeTimeout) && (
          <div className="space-y-2 rounded border border-secondary/30 bg-secondary/5 p-3">
            <div className="font-mono text-label-caps uppercase text-secondary">Open Challenge</div>
            <p className="text-body-sm text-muted">
              Challenged by {truncateAddress(openChallenge.challenger)}. Resolution re-runs the same
              independent adjudication against current evidence — anyone can trigger it.
            </p>
            {canClaimChallengeTimeout ? (
              <Button variant="tactical" className="w-full" onClick={onClaimChallengeTimeout} loading={busy}>
                Claim Timeout (resolution window expired)
              </Button>
            ) : (
              <>
                <Button variant="tactical" className="w-full" onClick={onResolveChallenge} loading={busy}>
                  Resolve Challenge
                </Button>
                <p className="font-mono text-body-sm text-muted">
                  Resolution window closes {formatCountdown(openChallenge.resolution_deadline)}
                </p>
              </>
            )}
          </div>
        )}

        {inv.settled && <p className="text-body-sm text-status-safe">This investigation has been settled. Funds have been released to balances.</p>}
      </CardBody>
    </Card>
  );
}
