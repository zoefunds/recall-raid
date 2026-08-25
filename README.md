# RecallRaid

**Find the dangerous product hiding in someone's marketplace inventory.**

RecallRaid is a crowdsourced marketplace-safety bounty platform. Users
("hunters") stake GEN to investigate suspected recalled/defective/unsafe
products in marketplace listings; a GenLayer Intelligent Contract
independently re-verifies the claim against real public evidence
(manufacturer pages, recall databases, the listing itself) using multiple
validators, and pays the hunter from the bounty if confirmed. Sellers can
voluntarily post a Clean Inventory Bond to signal confidence in their
inventory, which is slashed proportionally on a confirmed recall against
their listing. Verdicts can be challenged within a window by staking GEN,
triggering a fresh independent re-verification.

## Why GenLayer

The core trust problem: can a hunter, a seller, and a challenger all trust
the outcome of a safety investigation without relying on a centralized
authority to adjudicate it? RecallRaid's contract answers this by never
resolving a claim from user-submitted text alone — every verdict and every
challenge resolution re-fetches public evidence live and reaches consensus
via GenVM's leader/validator Equivalence Principle. See
`docs/CONSENSUS_AND_EVIDENCE.md` (to be written alongside contract testing)
and `docs/SECURITY.md` for the full reasoning.

## Repository layout

```
recallraid/
  contracts/              recallraid_contract.py — the GenLayer Intelligent Contract
    tests/                 static structural tests (no GenVM runtime required)
    tests/live/            live StudioNet end-to-end test suite
  apps/web/                Next.js frontend (Vercel)
  apps/api/                Fastify backend (Fly.io, always-on)
  packages/shared/         shared types (grows as web/api integration solidifies)
  docs/                    ARCHITECTURE.md, SECURITY.md, DEPLOYMENT.md
  memory.md                persistent build log / decision record — read this first
```

## Requirements

- Node.js >= 18, npm >= 9
- Python 3.11+ (for the contract; no runtime Python dependency beyond the stdlib)
- Docker (for local Postgres only — NOT for GenLayer)
- Fly CLI, Vercel CLI (already installed per project setup)
- A GenLayer Studio account to deploy the contract yourself

## Local development

```bash
npm install
docker compose up -d          # local Postgres for apps/api
npm run migrate --workspace apps/api
npm run dev:api                # http://localhost:8080
npm run dev:web                # http://localhost:3000
```

## Environment variables

See `.env.example` at the repo root for the full list, split into PUBLIC
(safe in the browser), SERVER-ONLY, and SECRET categories. Copy it to
`.env` for local Postgres/API config and to `apps/web/.env.local` for the
Next.js public vars.

## Contract: build, test, deploy

```bash
python3 -m py_compile contracts/recallraid_contract.py
python3 -m unittest discover -s contracts/tests
genvm-lint check contracts/recallraid_contract.py --json
```

Deployment is a manual step you perform yourself — see
`docs/DEPLOYMENT.md`. Give Claude the deployed address afterward; it flows
into environment configuration only, never hardcoded in source.

## Documentation

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — system design, on-chain/off-chain split
- [`docs/SECURITY.md`](docs/SECURITY.md) — escrow safety, anti-abuse, custody model
- [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) — exact deploy steps for contract, API, frontend
- [`memory.md`](memory.md) — locked decisions and build status, read first in any new session
