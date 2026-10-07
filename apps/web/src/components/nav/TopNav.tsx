import Link from 'next/link';
import { LogoWithWordmark } from '@/components/Logo';
import { ConnectWalletButton } from '@/components/ConnectWalletButton';

const LINKS = [
  { href: '/hunts', label: 'Active Hunts' },
  { href: '/submit', label: 'Submit Evidence' },
  { href: '/leaderboard', label: 'Leaderboard' },
  { href: '/seller', label: 'Sellers' },
  { href: '/wallet', label: 'Wallet' },
];

export function TopNav() {
  return (
    <header className="sticky top-0 z-40 border-b border-border-subtle bg-bg-deep/95 backdrop-blur">
      <div className="mx-auto flex max-w-container items-center justify-between px-margin-mobile py-3 md:px-margin-desktop">
        <Link href="/">
          <LogoWithWordmark />
        </Link>
        <nav className="hidden items-center gap-6 md:flex">
          {LINKS.map((l) => (
            <Link key={l.href} href={l.href} className="font-mono text-label-caps uppercase text-muted hover:text-primary">
              {l.label}
            </Link>
          ))}
        </nav>
        <ConnectWalletButton />
      </div>
    </header>
  );
}
