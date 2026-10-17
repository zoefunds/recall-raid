# RecallRaid

RecallRaid is a product-safety investigation and bounty application. Product
records, evidence submissions, verdicts, and challenges live on GenLayer
StudioNet. USDC bounties, challenge stakes, seller bonds, settlement accounting,
and claims live in a Base Sepolia escrow. The API mirrors chain state in
PostgreSQL, authenticates wallet sessions, issues signed evidence-upload
parameters, and coordinates explicitly attested cross-chain operations.

This repository contains a working testnet implementation. The live Base
security-branch evidence is contract-level validation using synthetic
GenLayer outcomes; it is not proof of a browser-originated end-to-end flow or a
production deployment. See [the validation record](docs/e2e-evidence/live-base-security-branches.json)
and [deployment notes](docs/DEPLOYMENT.md) for the precise scope and addresses.

## Repository map

- `apps/web/` — Next.js 14 application: investigation submission and detail,
  Active Hunts, seller bond management, wallet balances/claims, leaderboard.
- `apps/api/` — Fastify API: wallet nonce/session auth, PostgreSQL cache and
  migrations, signed Cloudinary uploads, chain sync, transaction status,
  notifications, statistics, and settlement/recovery coordination.
- `contracts/recallraid_contract.py` — GenLayer investigation, evidence,
  verdict, challenge, timeout, and reputation logic.
- `contracts/base/RecallRaidEscrow.sol` — Base Sepolia USDC escrow, seller
  bonds, EIP-712 authorization checks, settlement, and pull claims.
- `packages/shared/` — shared TypeScript types and protocol constants.
- `docs/` — architecture, deployment, security, and on-chain evidence.

## Trust and money flow

1. A submitter approves USDC and funds a random `bytes32` case id in Base escrow.
2. The same wallet submits the matching case and bounty metadata on GenLayer.
   Evidence files are uploaded directly to Cloudinary using API-signed upload
   parameters; evidence references and SHA-256 hashes are recorded on GenLayer.
3. A GenLayer leader and validators fetch evidence URLs and adjudicate. The
   API syncs chain state into PostgreSQL, then checks that the Base depositor,
   amount, case id, GenLayer contract, and investigation id match before
   recording the cross-chain registration.
4. The GenLayer challenge window runs for seven days. A challenge requires an
   exact 20% of-bounty USDC stake, funded by the challenger on Base. GenLayer
   resolves or expires the challenge; the Base escrow keeps deposits keyed by
   each challenger's wallet.
5. The API reads terminal GenLayer state, validates the Base funding and
   registration records, and obtains a distinct decision-signer EIP-712
   authorization. The relayer submits the signed instruction to Base. Base
   checks its exact case, GenLayer reference, outcome, challenge and decision
   hash before crediting claimable balances.
6. Recipients call `claim()` to withdraw USDC from Base escrow.

The EIP-712 signer is a privileged attestation authority. This is not a
cryptographic proof of GenLayer consensus on Base. Keep signer and relayer keys
separate, restrict both to testnet while testing, and see [Security](docs/SECURITY.md).

## Local development

Requirements: Node.js with npm, Python 3, PostgreSQL for API use, and Foundry
for Solidity tests. GenLayer CLI / GenVM tools are needed to lint, deploy, and
interact with the contract. Copy `.env.example` into the appropriate ignored
local environment files; use fresh test credentials. Public `NEXT_PUBLIC_*`
values go in `apps/web/.env.local`; server secrets go only in `apps/api/.env`.
Do not commit either file.

```bash
npm install
npm run migrate
npm run dev:api
npm run dev:web
```

The API listens on port `8080` by default and the web app on port `3000`.
Configure a local PostgreSQL URL and deployed testnet contract addresses before
using chain-dependent features.

## Checks

```bash
npm run test:api
npm run build:api
npm run build:web
npm run compile:base
npm run test:base
npm run compile:contract
npm run lint:contract
```

`npm run test:base` requires Foundry. GenLayer lint requires `genvm-lint`.
Network transactions and a browser wallet flow are separate manual checks;
passing local tests does not establish live chain consensus or user flow.

## Documentation

- [Architecture and data flow](docs/ARCHITECTURE.md)
- [Security model and controls](docs/SECURITY.md)
- [Deployment and environment configuration](docs/DEPLOYMENT.md)
- [Live Base security evidence and limitations](docs/e2e-evidence/live-base-security-branches.json)
- [Historical Base Sepolia milestone summary](milestone.md)
