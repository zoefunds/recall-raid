# RecallRaid

RecallRaid is a product-safety investigation and bounty application. Product
records, evidence submissions, verdicts, and challenges live on GenLayer
StudioNet. USDC bounties, challenge stakes, seller bonds, settlement accounting,
and claims live in a Base Sepolia escrow. The API mirrors chain state in
PostgreSQL, authenticates wallet sessions, issues signed evidence-upload
parameters, and coordinates explicitly attested cross-chain operations.

The bonus-aware Base Sepolia escrow is deployed at
`0xBf74703d38cc83DE796B174efFdC02FaD69dE0dB` in transaction
`0x7a095758a6aa678d235103a54c31e468be043bb6d2f2cb6b944b17ccef433ed8`.
The public frontend and candidate API use it for all new registrations. The
production-named legacy API remains pinned to the prior escrow only so its
immutable historical cases can be settled through their original contracts.
Live reads report `CHALLENGE_OVERTURN_BONUS_BPS = 1500`; existing cases retain
their version-specific settlement paths. See the
[rollout evidence](docs/e2e-evidence/bonus-aware-rollout-2026-10-18.json).

The hardened GenLayer successor is deployed at
`0xfAc47CB7eEbF95f3d043A0cd8112ecdb24486ecA`. The public application at
[`recall-raid.vercel.app`](https://recall-raid.vercel.app) uses that contract,
the candidate API, and the bonus-aware escrow. Its Active Hunts page currently
shows three successor investigations: the earlier 0.100 USDC overturned case
and browser-originated 1.000 and 0.500 USDC open cases. The latter two are
registered to the new escrow as investigations 2 and 3. The complete browser
transaction chain and live frontend verification are recorded in the
[rollout evidence](docs/e2e-evidence/bonus-aware-rollout-2026-10-18.json).

The three pre-rollout financial obligations remain bound to their original
contracts and are intentionally unsettled until their deadlines on October 24,
2026. The A239 case is eligible after 08:08:09 UTC, the EDFF case after
10:31:44 UTC, and the hardened-successor legacy-escrow case after 15:22:12 UTC.
The settlement runners apply the documented 15% correction to both successful
legacy overturns and capture EIP-712 instructions, receipts, claims, correction
transfers, and before/after USDC balances. See [deployment](docs/DEPLOYMENT.md)
and [security](docs/SECURITY.md).

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
   recoverable by their depositor after the case is finalized. A successful
   challenger receives the full stake back plus 15% of the funded bounty; the
   ordinary bounty recipient receives the remaining 85%, so no additional
   treasury or seller-bond funds are created or consumed.
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
