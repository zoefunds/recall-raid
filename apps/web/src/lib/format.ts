/** Formatting helpers shared across pages — wei/GEN, addresses, time. */

const WEI_PER_GEN = 1_000_000_000_000_000_000n;

export function weiToGen(wei: string | bigint | number, decimals = 4): string {
  try {
    const v = typeof wei === 'bigint' ? wei : BigInt(String(wei || '0'));
    const whole = v / WEI_PER_GEN;
    const frac = v % WEI_PER_GEN;
    const fracStr = frac.toString().padStart(18, '0').slice(0, decimals);
    const trimmed = fracStr.replace(/0+$/, '');
    return trimmed ? `${whole}.${trimmed}` : whole.toString();
  } catch {
    return '0';
  }
}

export function genToWei(gen: string | number): bigint {
  const str = String(gen).trim();
  if (!str) return 0n;
  const [whole, frac = ''] = str.split('.');
  const fracPadded = (frac + '0'.repeat(18)).slice(0, 18);
  const wholeBig = BigInt(whole || '0');
  const fracBig = BigInt(fracPadded || '0');
  return wholeBig * WEI_PER_GEN + fracBig;
}

export function truncateAddress(addr: string | undefined | null, chars = 4): string {
  if (!addr) return '—';
  if (addr.length <= chars * 2 + 2) return addr;
  return `${addr.slice(0, chars + 2)}…${addr.slice(-chars)}`;
}

export function formatBps(bps: number): string {
  return `${(bps / 100).toFixed(1)}%`;
}

export function formatCountdown(deadlineUnixSeconds: number): string {
  const now = Date.now() / 1000;
  const diff = deadlineUnixSeconds - now;
  if (diff <= 0) return 'Expired';
  const days = Math.floor(diff / 86400);
  const hours = Math.floor((diff % 86400) / 3600);
  const minutes = Math.floor((diff % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

export function formatDate(unixSeconds: number): string {
  if (!unixSeconds) return '—';
  return new Date(unixSeconds * 1000).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}
