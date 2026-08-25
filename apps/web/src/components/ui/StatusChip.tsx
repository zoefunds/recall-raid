import { HAZARD_LABEL, INVESTIGATION_STATUS_LABEL, VERDICT_LABEL } from '@/types/contract';

type Tone = 'cyan' | 'orange' | 'red' | 'slate' | 'green';

function chipClasses(tone: Tone) {
  switch (tone) {
    case 'cyan':
      return 'bg-primary/10 text-primary border-primary/40';
    case 'orange':
      return 'bg-secondary/10 text-secondary border-secondary/40';
    case 'red':
      return 'bg-danger/10 text-danger border-danger/40';
    case 'green':
      return 'bg-status-safe/10 text-status-safe border-status-safe/40';
    default:
      return 'bg-surface-high text-status-disputed border-outline-variant';
  }
}

export function Chip({ label, tone = 'slate' }: { label: string; tone?: Tone }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 font-mono text-label-caps uppercase ${chipClasses(tone)}`}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {label}
    </span>
  );
}

const STATUS_TONE: Record<number, Tone> = {
  0: 'slate', // OPEN
  1: 'cyan', // EVIDENCE_SUBMITTED
  2: 'cyan', // INVESTIGATING
  3: 'orange', // VERDICT_REACHED
  4: 'red', // CHALLENGE_WINDOW
  5: 'green', // SETTLED
  6: 'slate', // INVALID
  7: 'slate', // CANCELLED
};

export function InvestigationStatusChip({ status }: { status: number }) {
  return <Chip label={INVESTIGATION_STATUS_LABEL[status] ?? 'UNKNOWN'} tone={STATUS_TONE[status] ?? 'slate'} />;
}

const VERDICT_TONE: Record<number, Tone> = {
  0: 'slate',
  1: 'green',
  2: 'orange',
  3: 'red',
  4: 'slate',
};

export function VerdictChip({ verdict }: { verdict: number }) {
  if (!verdict) return null;
  return <Chip label={VERDICT_LABEL[verdict] ?? 'UNKNOWN'} tone={VERDICT_TONE[verdict] ?? 'slate'} />;
}

const HAZARD_TONE: Record<number, Tone> = { 1: 'red', 2: 'orange', 3: 'slate' };
export const HAZARD_BAR_CLASS: Record<number, string> = {
  1: 'bg-danger',
  2: 'bg-secondary',
  3: 'bg-outline',
};

export function HazardChip({ hazardClass }: { hazardClass: number }) {
  return <Chip label={HAZARD_LABEL[hazardClass] ?? 'UNKNOWN'} tone={HAZARD_TONE[hazardClass] ?? 'slate'} />;
}
