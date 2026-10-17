# RecallRaid API

Fastify and TypeScript service for chain reads, wallet-session authentication,
evidence-upload signing, cache synchronization, and authorized Base Sepolia
settlement coordination. The API does not custody user deposits or submit
user-signed funding, challenge, bond, or claim transactions.

## Responsibilities

- issue and verify one-time EVM wallet nonces; maintain an HTTP-only session;
- issue signed Cloudinary upload parameters and retain pending upload metadata;
- mirror GenLayer investigations, evidence, challenges, and seller bonds into
  PostgreSQL for paginated reads;
- validate a funded Base case against its GenLayer registration and record the
  authorized cross-chain link;
- validate terminal GenLayer state and matching Base payer, amount, challenge
  funding, and case reference before creating EIP-712 attestations;
- relay signed settlement instructions and issue eligible orphan-recovery
  authorizations;
- poll transaction receipts, sync active state, retry terminal relays, and
  create deadline notifications from a PostgreSQL-lock-protected watcher.

The relayer and decision signer are distinct keys. The decision signer is a
trusted authority: its signature is checked by Base, but Base does not verify
GenLayer consensus itself. Never treat the API cache as authoritative for
settlement or recovery decisions.

## Local development

Requirements: Node.js/npm and PostgreSQL. Copy the server-side settings from
the repository's `.env.example` into ignored `apps/api/.env`. Set a database,
GenLayer RPC/contract, Base Sepolia RPC/USDC/escrow, and local test keys as
needed. Cloudinary settings are required for evidence uploads. Keep all
private keys, JWT secrets, database credentials, and Cloudinary secrets in the
API environment only.

From the repository root:

```bash
npm install
npm run migrate
npm run dev:api
```

The development server defaults to `http://localhost:8080`; health is
`GET /health`. Run API tests and compile with:

```bash
npm run test:api
npm run build:api
```

## Main route groups

Routes are registered in `src/server.ts` without an extra prefix:

- `/auth/*` — nonce, signature verification, logout, and session;
- `/investigations` and `/investigations/:id` — cached case list/detail;
- `/investigations/:id/sync` — authenticated chain refresh and Base
  registration reconciliation;
- `/investigations/:id/relay` — authenticated retry/manual relay of a terminal
  investigation;
- `/escrow/cases/:caseId/recovery-authorization` — authenticated,
  eligibility-checked orphan recovery signature;
- `/evidence`, `/evidence/upload-url`, `/evidence/:investigationId/sync` —
  evidence reads, signed upload, and chain refresh;
- `/investigations/:id/challenges`, `/challenges/:id`, `/challenges/:id/sync`;
- `/seller-bonds/:id`, `/sellers/:address/bonds`, and bond sync;
- `/reputation/*`, `/leaderboard`, `/notifications/*`, `/stats`, and
  `/tx-status*` — supporting reads and wallet-scoped updates.

Authenticated routes use the HTTP-only session established by `/auth/verify`.
Reads from the cache can lag until an explicit sync or watcher pass.

## Deployment

The Fly app name in `apps/api/fly.toml` is `recallraid-usdc-api`. That file
configures a continuously running machine and `/health` check. Set runtime
secrets with Fly's secret store, deploy with the repository instructions in
[`docs/DEPLOYMENT.md`](../../docs/DEPLOYMENT.md), then run migrations after a
schema change. Verify the actual deployed health URL and environment before
directing the frontend to it; local `.env.example` values are templates, not
evidence that a particular remote deployment is current.
