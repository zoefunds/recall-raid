'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const ITEMS = [
  { href: '/hunts', label: 'Hunts', icon: '🎯' },
  { href: '/submit', label: 'Submit', icon: '📤' },
  { href: '/leaderboard', label: 'Rank', icon: '🏆' },
  { href: '/wallet', label: 'Wallet', icon: '💳' },
];

// Mobile "Command Drawer" bottom nav, per DESIGN.md — collapses the
// desktop sidebar/topnav links into four bottom tabs.
export function BottomNav() {
  const pathname = usePathname();
  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 flex border-t border-border-subtle bg-bg-deep/95 backdrop-blur md:hidden">
      {ITEMS.map((item) => {
        const active = pathname?.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            className={`flex flex-1 flex-col items-center gap-0.5 py-2.5 font-mono text-[10px] uppercase tracking-wide ${
              active ? 'text-primary' : 'text-muted'
            }`}
          >
            <span aria-hidden>{item.icon}</span>
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
