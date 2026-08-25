'use client';

import type { TxLifecycleStatus } from '@/lib/genlayer-client';

const STEPS: { key: TxLifecycleStatus; label: string }[] = [
  { key: 'preparing', label: 'Preparing' },
  { key: 'awaiting-wallet', label: 'Confirm in wallet' },
  { key: 'submitted', label: 'Submitted' },
  { key: 'pending', label: 'Confirming' },
  { key: 'confirmed', label: 'Confirmed' },
];

const TERMINAL_ERROR: TxLifecycleStatus[] = ['failed', 'rejected', 'timeout'];

function stepIndex(status: TxLifecycleStatus): number {
  return STEPS.findIndex((s) => s.key === status);
}

export function TransactionStatusModal({
  status,
  message,
  txHash,
  onClose,
}: {
  status: TxLifecycleStatus;
  message?: string;
  txHash?: string;
  onClose: () => void;
}) {
  if (status === 'idle') return null;
  const isError = TERMINAL_ERROR.includes(status);
  const isDone = status === 'confirmed';
  const currentIdx = stepIndex(status);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" role="dialog" aria-modal="true">
      <div className="w-full max-w-sm rounded-md border border-border-subtle bg-surface-container p-5">
        <div className="mb-4 flex items-center justify-between">
          <span className="font-mono text-label-caps uppercase text-muted">Transaction</span>
          {(isDone || isError) && (
            <button onClick={onClose} className="text-muted hover:text-on-surface" aria-label="Close">
              ✕
            </button>
          )}
        </div>

        {!isError && (
          <ol className="mb-4 space-y-2">
            {STEPS.map((step, i) => {
              const active = i === currentIdx;
              const done = i < currentIdx || isDone;
              return (
                <li key={step.key} className="flex items-center gap-3">
                  <span
                    className={`flex h-5 w-5 items-center justify-center rounded-full border text-[10px] ${
                      done
                        ? 'border-status-safe bg-status-safe/10 text-status-safe'
                        : active
                          ? 'border-primary bg-primary/10 text-primary'
                          : 'border-outline-variant text-muted'
                    }`}
                  >
                    {done ? '✓' : i + 1}
                  </span>
                  <span className={`text-body-sm ${active ? 'text-on-surface' : 'text-muted'}`}>{step.label}</span>
                  {active && !isDone && (
                    <span className="h-2 w-2 animate-ping rounded-full bg-primary" />
                  )}
                </li>
              );
            })}
          </ol>
        )}

        {isError && (
          <div className="mb-4 rounded border border-danger/40 bg-danger/10 p-3">
            <div className="mb-1 font-mono text-label-caps uppercase text-danger">
              {status === 'rejected' ? 'Rejected' : status === 'timeout' ? 'Timed out' : 'Failed'}
            </div>
            <p className="text-body-sm text-on-surface">{message}</p>
          </div>
        )}

        {!isError && message && <p className="mb-4 text-body-sm text-muted">{message}</p>}

        {txHash && (
          <div className="mb-4 truncate rounded border border-border-subtle bg-bg-deep px-2 py-1.5 font-mono text-data-mono text-muted">
            {txHash}
          </div>
        )}

        {(isDone || isError) && (
          <button
            onClick={onClose}
            className="w-full rounded bg-primary py-2 text-body-md font-semibold text-primary-on hover:brightness-110"
          >
            {isDone ? 'Done' : 'Close'}
          </button>
        )}
      </div>
    </div>
  );
}
