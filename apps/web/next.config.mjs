/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  images: {
    remotePatterns: [
      // Evidence photos are uploaded directly to Cloudinary (see
      // memory.md's R2 -> Cloudinary swap) — this was still pointing at
      // the old R2 domains, which silently blocks next/image from
      // rendering any evidence photo (shows as a blank box, no error).
      { protocol: 'https', hostname: 'res.cloudinary.com' },
    ],
  },
  webpack: (config) => {
    // @reown/appkit-adapter-wagmi pulls in a Coinbase "Base Account"
    // connector purely as an optional code path (its x402 payments
    // feature), which in turn references @x402/* subpackages that are
    // *not* actual dependencies of this app and aren't published as
    // resolvable packages on their own. RecallRaid never uses Coinbase's
    // x402 payment flow (memory.md: this app only ever moves money via
    // GEN through the RecallRaid contract), so these are safe to stub out
    // at bundle time rather than pulling in a real dependency for a
    // feature this app doesn't expose.
    config.resolve.alias = {
      ...config.resolve.alias,
      '@x402/evm/upto/client': false,
      '@x402/evm/exact/client': false,
      '@x402/core/client': false,
      '@x402/svm/exact/client': false,
      '@x402/evm': false,
      // Same story: `@wagmi/connectors`'s MetaMask connector does a
      // try/catch-guarded dynamic import of `@metamask/connect-evm` (an
      // optional peer dependency for an alternate connection API this app
      // doesn't need — MetaMask's standard injected-provider flow works
      // without it), and `@wagmi/core`'s experimental "Tempo Wallet"
      // connector (which this app never registers) does a
      // `.catch()`-guarded dynamic import of a bare `accounts` module.
      // Neither package is actually published/resolvable standalone;
      // aliasing to `false` makes webpack treat them as empty modules so
      // the already-present error handling in each library takes over.
      '@metamask/connect-evm': false,
      accounts: false,
    };
    return config;
  },
};

export default nextConfig;
