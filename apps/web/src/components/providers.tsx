'use client';

import { useEffect, useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { WagmiProvider } from 'wagmi';
import { wagmiConfig, initAppKit } from '@/lib/wagmi-config';

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: 1, staleTime: 15_000 } } }));

  useEffect(() => {
    initAppKit();
  }, []);

  return (
    // Reown AppKit's WagmiAdapter and the app's own `wagmi` package
    // resolve slightly different nested copies of `@wagmi/core` in this
    // workspace's dependency tree, which trips a purely structural type
    // mismatch here even though the runtime shapes are identical (both are
    // wagmi Config objects). Cast at this single boundary rather than
    // loosening types anywhere else.
    <WagmiProvider config={wagmiConfig as never}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </WagmiProvider>
  );
}
