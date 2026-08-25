export function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`animate-pulse rounded bg-surface-high ${className}`} />;
}

export function CardSkeleton() {
  return (
    <div className="rounded-md border border-border-subtle bg-surface-container p-4">
      <Skeleton className="mb-3 h-3 w-1/3" />
      <Skeleton className="mb-2 h-5 w-3/4" />
      <Skeleton className="mb-4 h-3 w-1/2" />
      <div className="flex gap-2">
        <Skeleton className="h-6 w-16" />
        <Skeleton className="h-6 w-16" />
      </div>
    </div>
  );
}

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-md border border-dashed border-border-subtle bg-surface-container/50 px-6 py-16 text-center">
      <div className="mb-2 font-mono text-label-caps uppercase text-muted">No signal</div>
      <div className="mb-1 font-sans text-headline-md text-on-surface">{title}</div>
      {hint && <p className="max-w-sm text-body-sm text-muted">{hint}</p>}
    </div>
  );
}

export function ErrorState({ title = 'Connection lost', hint, onRetry }: { title?: string; hint?: string; onRetry?: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-md border border-danger/30 bg-danger/5 px-6 py-16 text-center">
      <div className="mb-2 font-mono text-label-caps uppercase text-danger">Error</div>
      <div className="mb-1 font-sans text-headline-md text-on-surface">{title}</div>
      {hint && <p className="mb-4 max-w-sm text-body-sm text-muted">{hint}</p>}
      {onRetry && (
        <button onClick={onRetry} className="rounded border border-primary px-4 py-1.5 text-body-sm text-primary hover:bg-primary/10">
          Retry
        </button>
      )}
    </div>
  );
}
