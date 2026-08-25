'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { fetchInvestigations, fetchPlatformStats } from '@/lib/api';
import { Button } from '@/components/ui/Button';
import { Card, CardBody } from '@/components/ui/Card';
import { HAZARD_BAR_CLASS, HazardChip, InvestigationStatusChip } from '@/components/ui/StatusChip';
import { CardSkeleton, ErrorState, Skeleton } from '@/components/ui/States';
import { weiToGen } from '@/lib/format';
import { LogoMark } from '@/components/Logo';

export default function LandingPage() {
  const statsQuery = useQuery({ queryKey: ['stats'], queryFn: fetchPlatformStats, refetchInterval: 30_000 });
  const targetsQuery = useQuery({
    queryKey: ['investigations', 'preview'],
    queryFn: () => fetchInvestigations({ offset: 0, limit: 4 }),
    refetchInterval: 20_000,
  });

  return (
    <div>
      <Hero />
      <StatsBento statsQuery={statsQuery} />
      <PriorityTargets targetsQuery={targetsQuery} />
      <HowItWorks />
      <SellerCta />
      <Footer />
    </div>
  );
}

function Hero() {
  return (
    <section className="relative overflow-hidden border-b border-border-subtle bg-[radial-gradient(circle_at_20%_-10%,rgba(0,219,231,0.12),transparent_45%)]">
      <div className="mx-auto max-w-container px-margin-mobile py-20 md:px-margin-desktop md:py-28">
        <div className="mb-6 flex justify-center opacity-90">
          <LogoMark size={56} />
        </div>
        <h1 className="mx-auto max-w-3xl text-center font-sans text-headline-lg-mobile text-on-surface md:text-[48px] md:leading-[52px] md:font-bold">
          Find the Danger.<br />
          <span className="text-primary">Claim the Bounty.</span>
        </h1>
        <p className="mx-auto mt-5 max-w-xl text-center text-body-md text-muted">
          RecallRaid pays hunters in GEN for surfacing recalled, defective, or mislabeled marketplace
          listings — every verdict is independently re-verified on-chain from public evidence, never
          decided from one person&apos;s word.
        </p>
        <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <Link href="/hunts">
            <Button size="lg">Browse Active Hunts</Button>
          </Link>
          <Link href="/submit">
            <Button size="lg" variant="ghost">
              Submit Evidence
            </Button>
          </Link>
        </div>
      </div>
    </section>
  );
}

function StatsBento({ statsQuery }: { statsQuery: ReturnType<typeof useQuery<Awaited<ReturnType<typeof fetchPlatformStats>>>> }) {
  const { data, isLoading, isError, refetch } = statsQuery;
  return (
    <section className="mx-auto max-w-container px-margin-mobile py-12 md:px-margin-desktop">
      {isError ? (
        <ErrorState title="Live stats unavailable" hint="We couldn't load network aggregates right now." onRetry={() => refetch()} />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <StatTile label="Verified Discoveries" value={isLoading ? undefined : String(data?.verified_discoveries ?? 0)} tone="cyan" />
          <StatTile
            label="GEN Distributed"
            value={isLoading ? undefined : `${weiToGen(data?.gen_distributed_wei ?? '0', 2)} GEN`}
            tone="orange"
          />
          <StatTile label="Active Threats" value={isLoading ? undefined : String(data?.active_threats ?? 0)} tone="red" />
        </div>
      )}
    </section>
  );
}

function StatTile({ label, value, tone }: { label: string; value?: string; tone: 'cyan' | 'orange' | 'red' }) {
  const toneClass = { cyan: 'text-primary', orange: 'text-secondary', red: 'text-danger' }[tone];
  return (
    <Card>
      <CardBody>
        <div className="mb-2 font-mono text-label-caps uppercase text-muted">{label}</div>
        {value === undefined ? (
          <Skeleton className="h-8 w-24" />
        ) : (
          <div className={`font-mono text-[32px] font-bold ${toneClass}`}>{value}</div>
        )}
      </CardBody>
    </Card>
  );
}

function PriorityTargets({ targetsQuery }: { targetsQuery: ReturnType<typeof useQuery<Awaited<ReturnType<typeof fetchInvestigations>>>> }) {
  const { data, isLoading, isError, refetch } = targetsQuery;
  return (
    <section className="mx-auto max-w-container px-margin-mobile py-8 md:px-margin-desktop">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="font-sans text-headline-md">Priority Targets</h2>
        <Link href="/hunts" className="font-mono text-label-caps uppercase text-primary">
          View all →
        </Link>
      </div>
      {isError ? (
        <ErrorState title="Could not load investigations" onRetry={() => refetch()} />
      ) : isLoading ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <CardSkeleton key={i} />
          ))}
        </div>
      ) : !data?.items.length ? (
        <div className="rounded-md border border-dashed border-border-subtle p-8 text-center text-body-sm text-muted">
          No active hunts yet — be the first to submit evidence.
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {data.items.slice(0, 4).map((inv) => (
            <Link key={inv.id} href={`/hunts/${inv.id}`}>
              <Card topBarClassName={HAZARD_BAR_CLASS[inv.hazard_class]} className="h-full transition-colors hover:border-primary">
                <CardBody>
                  <div className="mb-2 flex items-center justify-between">
                    <HazardChip hazardClass={inv.hazard_class} />
                    <InvestigationStatusChip status={inv.status} />
                  </div>
                  <h3 className="mb-1 truncate font-sans text-body-md font-semibold text-on-surface">{inv.product_name}</h3>
                  <p className="mb-3 truncate text-body-sm text-muted">{inv.brand || inv.marketplace}</p>
                  <div className="font-mono text-data-mono text-primary">{weiToGen(inv.bounty_wei)} GEN bounty</div>
                </CardBody>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}

function HowItWorks() {
  const steps = [
    { n: '01', title: 'Spot the danger', body: 'Find a recalled, defective, or mislabeled listing on any marketplace.' },
    { n: '02', title: 'Stake & submit', body: 'Post a GEN bounty and attach evidence — photos, screenshots, source URLs.' },
    { n: '03', title: 'Independent verdict', body: 'Multiple validators re-fetch public evidence and reach a verdict — not your word alone.' },
    { n: '04', title: 'Claim the bounty', body: 'Confirmed findings pay out instantly to your on-chain balance.' },
  ];
  return (
    <section className="border-y border-border-subtle bg-surface-container/30">
      <div className="mx-auto max-w-container px-margin-mobile py-14 md:px-margin-desktop">
        <h2 className="mb-8 text-center font-sans text-headline-md">How It Works</h2>
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {steps.map((s) => (
            <div key={s.n}>
              <div className="mb-2 font-mono text-[28px] font-bold text-primary/40">{s.n}</div>
              <h3 className="mb-1 font-sans font-semibold text-on-surface">{s.title}</h3>
              <p className="text-body-sm text-muted">{s.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function SellerCta() {
  return (
    <section className="mx-auto max-w-container px-margin-mobile py-14 md:px-margin-desktop">
      <Card className="border-secondary/30 bg-secondary/5">
        <CardBody className="flex flex-col items-center gap-4 py-10 text-center md:flex-row md:justify-between md:text-left">
          <div>
            <h2 className="mb-1 font-sans text-headline-md">Sell with confidence</h2>
            <p className="max-w-md text-body-sm text-muted">
              Post a Clean Inventory Bond to signal your listings are safe. It only gets slashed on a
              confirmed recall verdict — never on an unfounded claim.
            </p>
          </div>
          <Link href="/seller">
            <Button variant="tactical" size="lg">
              Protect My Listings
            </Button>
          </Link>
        </CardBody>
      </Card>
    </section>
  );
}

function Footer() {
  return (
    <footer className="border-t border-border-subtle">
      <div className="mx-auto max-w-container px-margin-mobile py-8 text-center text-body-sm text-muted md:px-margin-desktop">
        RecallRaid — Consumer Marketplace Safety Investigation & Bounty Protocol. Running on GenLayer StudioNet.
      </div>
    </footer>
  );
}
