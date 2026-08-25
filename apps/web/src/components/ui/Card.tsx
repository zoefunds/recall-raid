export function Card({
  children,
  className = '',
  topBarClassName,
}: {
  children: React.ReactNode;
  className?: string;
  topBarClassName?: string;
}) {
  return (
    <div className={`overflow-hidden rounded-md border border-border-subtle bg-surface-container ${className}`}>
      {topBarClassName && <div className={`h-1 w-full ${topBarClassName}`} />}
      {children}
    </div>
  );
}

export function CardBody({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <div className={`p-4 ${className}`}>{children}</div>;
}
