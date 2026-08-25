export function Sidebar({ children }: { children: React.ReactNode }) {
  return (
    <aside className="hidden w-64 shrink-0 border-r border-border-subtle bg-surface-container/40 p-4 md:block">
      {children}
    </aside>
  );
}

export function SidebarSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-6">
      <h3 className="mb-2 font-mono text-label-caps uppercase text-muted">{title}</h3>
      {children}
    </div>
  );
}
