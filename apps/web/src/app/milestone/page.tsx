import { Card, CardBody } from '@/components/ui/Card';
import { milestoneE2E } from '@/data/milestone-e2e';

const explorer = 'https://sepolia.basescan.org';
const short = (value: string) => `${value.slice(0, 10)}…${value.slice(-8)}`;

export default function MilestonePage() {
  return (
    <div className="mx-auto max-w-container px-margin-mobile py-10 md:px-margin-desktop">
      <div className="mb-8 max-w-3xl">
        <div className="mb-2 font-mono text-label-caps uppercase text-primary">Live milestone proof</div>
        <h1 className="font-sans text-headline-lg">Base Sepolia USDC settlements</h1>
        <p className="mt-3 text-body-md text-muted">
          These are three real end-to-end executions against RecallRaidEscrow, not placeholders. Each case was funded in
          USDC, finalized through the relayer path, verified from contract state, and claimed back to the wallet.
        </p>
      </div>
      <div className="mb-6 grid gap-3 sm:grid-cols-3">
        <Meta label="Network" value={milestoneE2E.network} />
        <Meta label="Escrow" value={short(milestoneE2E.escrowAddress)} href={`${explorer}/address/${milestoneE2E.escrowAddress}`} />
        <Meta label="Executed" value={new Date(milestoneE2E.runAt).toLocaleString()} />
      </div>
      <div className="space-y-5">
        {milestoneE2E.cases.map((item) => (
          <Card key={item.caseId}>
            <CardBody>
              <div className="flex flex-col gap-4 lg:flex-row lg:justify-between">
                <div className="max-w-2xl">
                  <div className="font-mono text-label-caps uppercase text-primary">E2E #{item.number} · {item.bounty} USDC</div>
                  <h2 className="mt-1 font-sans text-headline-md">{item.title}</h2>
                  <div className="mt-2 inline-block rounded bg-primary/10 px-2 py-1 font-mono text-label-caps uppercase text-primary">{item.outcome}</div>
                  <p className="mt-3 text-body-sm text-secondary">{item.details}</p>
                  <p className="mt-3 break-all font-mono text-body-sm text-muted">Decision: {item.decisionHash}</p>
                </div>
                <div className="grid shrink-0 content-start gap-2 font-mono text-body-sm">
                  <TxLink label="Funding transaction" hash={item.fundingTx} />
                  <TxLink label="Relay transaction" hash={item.relayTx} />
                  <TxLink label="Claim transaction" hash={item.claimTx} />
                </div>
              </div>
            </CardBody>
          </Card>
        ))}
      </div>
    </div>
  );
}

function TxLink({ label, hash }: { label: string; hash: string }) {
  return <a className="text-primary underline" href={`${explorer}/tx/${hash}`} target="_blank" rel="noreferrer">{label}: {short(hash)} ↗</a>;
}

function Meta({ label, value, href }: { label: string; value: string; href?: string }) {
  const content = <div className="font-mono text-data-mono text-on-surface">{value}</div>;
  return <div className="rounded border border-border-subtle bg-surface-container p-3"><div className="font-mono text-label-caps uppercase text-muted">{label}</div>{href ? <a href={href} target="_blank" rel="noreferrer" className="text-primary underline">{content}</a> : content}</div>;
}
