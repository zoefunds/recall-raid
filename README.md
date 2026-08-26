# RecallRaid

**Find the dangerous product hiding in someone's marketplace inventory.**

RecallRaid is a crowdsourced marketplace-safety bounty platform built on
GenLayer. Users ("hunters") stake GEN to investigate suspected recalled,
defective, or mislabeled products in marketplace listings. A GenLayer
Intelligent Contract independently re-verifies each claim — live, against
real public evidence (manufacturer pages, recall databases, the listing
itself) — using multiple validators reaching consensus, and pays the
hunter from the bounty if the claim is confirmed. Sellers can voluntarily
post a Clean Inventory Bond, and prove real ownership of a specific
listing via a GenVM-verified web-fetch challenge, to signal confidence in
their inventory; that bond is slashed proportionally on a confirmed
recall against their listing. Verdicts can be challenged within a window
by staking GEN, which triggers a fresh, independent re-verification
rather than a vote.

**Status: live and fully verified.** Every contract method — including
both nondet-consensus paths (LLM-based verdict adjudication and
web-fetch-based listing verification) — passes a real, end-to-end test
suite against a deployed StudioNet contract with **0 known open bugs**
(67/67 live checks passing; see `memory.md` for the full history,
including a real GenVM API-usage bug that caused a multi-week debugging
arc before being root-caused and fixed).

## Why GenLayer

The core trust problem: can a hunter, a seller, and a challenger all
trust the outcome of a safety investigation without relying on a
centralized authority to adjudicate it? RecallRaid's contract answers
this by never resolving a claim from user-submitted text alone — every
verdict and every challenge resolution re-fetches public evidence live
and reaches consensus via GenVM's leader/validator Equivalence Principle
(`gl.vm.run_nondet_unsafe`), not a single trusted computation. Two
independent nondet passes exist in the contract:

1. **Verdict adjudication** (`request_verdict`, `resolve_challenge`) —
   fetches the manufacturer page, an allowlisted regulator recall
   database, and the marketplace listing, then asks an LLM
   (`gl.nondet.exec_prompt`) to classify the claim against a strict
   5-step decision procedure. Two deterministic, non-LLM backstops
   downgrade a hallucinated `RECALL_CONFIRMED` (no product identifier
   found in the recall source) or an overconfident `NO_ISSUE` (fewer
   than all 3 sources reachable) regardless of what the model claims —
   see `contracts/recallraid_contract.py`'s `_run_verdict_pass`.
2. **Listing-ownership verification** (`verify_seller_bond_listing`) —
   the seller publishes a per-bond verification code on their listing's
   own page (the same trust model as a DNS TXT record), and every
   validator independently fetches the URL live and checks for it via
   consensus. `link_seller_bond` then requires both a verified bond
   *and* a canonicalized match between the bond's verified listing and
   the investigation's own marketplace URL, closing the gap where a
   verified-but-unrelated bond could otherwise be linked to any claim.

See `docs/SECURITY.md` for the full escrow-safety and anti-abuse
reasoning, and `docs/ARCHITECTURE.md` for the on-chain/off-chain split.

## Repository layout

```
recallraid/
  contracts/
    recallraid_contract.py       the GenLayer Intelligent Contract (30 methods: 12 view, 18 write)
    tests/                       static structural tests (AST-based, no GenVM runtime required)
    diagnostics/
      nondet_consensus_diagnostic.py   minimal 3-check contract for isolating nondet-consensus bugs
                                         from application code — see "Debugging nondet consensus" below
  apps/web/                      Next.js frontend (Vercel) — wallet connect, all UI, wallet-signed writes
  apps/api/                      Fastify backend (Fly.io, always-on) — cache/session/notifications, never signs a tx
  scripts/
    full_contract_test_suite.mjs     comprehensive live end-to-end test against a deployed contract
    diagnostic_test.mjs              runs the 3 diagnostic checks against a deployed diagnostic contract
  docs/
    ARCHITECTURE.md               system design, on-chain/off-chain split, deployment topology
    SECURITY.md                   escrow safety, anti-abuse, known limitations
    DEPLOYMENT.md                 exact deploy steps for contract, API, frontend
  memory.md                       persistent build log / decision record — read this first in any new session
```

## Requirements

- Node.js >= 18, npm >= 9
- Python 3.11+ (for the contract itself; no runtime Python dependency
  beyond the stdlib — `genvm-linter` is only a local dev-time lint tool)
- Docker (for local Postgres only — never for GenLayer)
- Fly CLI, Vercel CLI
- A GenLayer Studio account to deploy the contract yourself (Claude never
  deploys the contract — see "Contract deployment" below)

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
Next.js public vars. In production, server-only and secret values are
set as Fly.io secrets (`apps/api`) and Vercel environment variables
(`apps/web`) — never committed to the repo.

## Contract: build, lint, test

```bash
python3 -m py_compile contracts/recallraid_contract.py
python3 -m unittest discover -s contracts/tests      # 27 structural tests, no GenVM runtime needed
genvm-lint contracts/recallraid_contract.py            # 3 checks: parse, schema, safety rules
```

Deployment is a manual step performed by the project owner, never by
Claude — see `docs/DEPLOYMENT.md` for the exact procedure. Once deployed,
give Claude the address; it flows into environment configuration only
(`GENLAYER_CONTRACT_ADDRESS` / `NEXT_PUBLIC_GENLAYER_CONTRACT_ADDRESS`),
never hardcoded in source.

## Live end-to-end testing

`scripts/full_contract_test_suite.mjs` runs every read and write method
against a real deployed contract using three funded StudioNet test
wallets (hunter/challenger/seller), including real Cloudinary evidence
uploads, a real nondet verdict pass, a real challenge/resolution cycle,
and the full seller-bond listing-verification flow:

```bash
node scripts/full_contract_test_suite.mjs
```

This is the authoritative source of truth for "does the deployed
contract actually work" — static lint/structural tests catch schema and
safety-rule violations, but only this live suite exercises GenVM's real
consensus mechanics. As of the last run: **67/67 checks passing.**

## Debugging nondet consensus

If a `gl.vm.run_nondet_unsafe` call ever starts disagreeing unexpectedly,
`contracts/diagnostics/nondet_consensus_diagnostic.py` is a minimal,
RecallRaid-independent contract with three trivial controls (a hardcoded-
constant round-trip, a stable public-page fetch, a tiny LLM
classification) for isolating whether the problem is platform-level or
application-level *before* spending time patching application code. Full
story of the last time this was needed — a real bug in how this contract
was reading GenVM's `leader_result` API inside `validator_fn`, not a
platform issue — is in `memory.md`.

```bash
CONTRACT_ADDRESS=0xYourDiagnosticDeploy node scripts/diagnostic_test.mjs
```

## Documentation

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — system design, on-chain/off-chain split, deployment topology
- [`docs/SECURITY.md`](docs/SECURITY.md) — escrow safety, anti-abuse, custody model, known limitations
- [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) — exact deploy steps for contract, API, frontend
- [`memory.md`](memory.md) — locked decisions and full build history, read first in any new session
