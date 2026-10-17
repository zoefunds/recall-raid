# RecallRaid

RecallRaid is a product-safety investigation and bounty application. Product
records, evidence submissions, verdicts, and challenges live on GenLayer
StudioNet. USDC bounties, challenge stakes, seller bonds, settlement accounting,
and claims live in a Base Sepolia escrow. The API mirrors chain state in
PostgreSQL, authenticates wallet sessions, issues signed evidence-upload
parameters, and coordinates explicitly attested cross-chain operations.

This repository contains a testnet implementation with a live StudioNet-to-Base Sepolia overturned challenge. The seven-day Base settlement and wallet withdrawals are documented as pending until `2026-10-24T10:31:44Z`; they are not being attempted early. The hardened successor is deployed at `0xfAc47CB7eEbF95f3d043A0cd8112ecdb24486ecA` and matches the checked-in source, while hosted Fly/Vercel still use the earlier `EDFF...` contract so existing Base registrations remain associated with their original investigation. Local Base branch tests use synthetic GenLayer instructions and do not substitute for the final live payout. See [the validation record](docs/e2e-evidence/studionet-base-valid-challenge-e2e.json), [security model](docs/SECURITY.md), and [deployment notes](docs/DEPLOYMENT.md) for exact scope and limitations.

The isolated successor preview is [available on Vercel](https://recall-raid-nhv1p5dax-adebiyi2002gmailcoms-projects.vercel.app) to project members; it uses a separate candidate API and database. Production remains on `EDFF...` until its existing registrations are safely resolved.

A CLI live run on the successor has funded and authenticated registration for investigation 1. StudioNet’s 500-requests/hour limit interrupted the run before evidence submission and challenge opening; the exact guarded resume command and checkpoint are documented in [deployment notes](docs/DEPLOYMENT.md#hardened-successor-live-challenge). The existing EDFF overturned challenge remains intact and unsettled.

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
   resolves or expires one challenge per investigation; the Base escrow keeps
   deposits keyed by each challenger's wallet. Unmatched direct deposits are
   recoverable by their depositor after the case is finalized.
5. The API reads terminal GenLayer state and Base funding, registration,
   challenge, and seller-bond records. For challenge creation, the API
   authenticates the funded challenger and verifies the exact Base receipt
   before the configured GenLayer admin relays `open_challenge`; direct wallet
   calls cannot occupy the challenge slot in the current source. A distinct
   decision signer validates
   those records and signs the exact settlement instruction with EIP-712. The
   relayer submits it; Base checks the signer authorization and stored case
   constraints before crediting claimable balances. Base does not independently
   prove GenLayer consensus.
6. Recipients call `claim()` to withdraw USDC from Base escrow.

The EIP-712 signer is a privileged attestation authority. This is not a
cryptographic proof of GenLayer consensus on Base. Keep signer and relayer keys
separate, restrict both to testnet while testing, and see [Security](docs/SECURITY.md).

## Local development

Requirements: Node.js with npm, Python 3, PostgreSQL for API use, and Foundry
for Solidity tests. GenLayer CLI / GenVM tools are needed to lint, deploy, and
interact with the contract. Install the GenLayer Testing Suite (`pip install
genlayer-test`) to run the contract's direct-mode security tests. Copy
`.env.example` into the appropriate ignored
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
npm run test:genlayer
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
