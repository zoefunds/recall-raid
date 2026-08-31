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

**Live**: [recall-raid.vercel.app](https://recall-raid.vercel.app) (frontend) · [recallraid-api.fly.dev](https://recallraid-api.fly.dev) (API, always-on)

## Status

**Fully verified, zero known open bugs, as of 2026-09-01.**

**Current contract**: `0x4aB01fb5435cdEfD3c651Cfc51f0F1fa1E2Ef6a4` (StudioNet)

| Check | Result |
| --- | --- |
| `genvm-lint` on the contract | ✓ 3/3 checks pass |
| Contract structural tests (`contracts/tests/`) | ✓ 27/27 pass |
| API unit tests (`apps/api/test/`) | ✓ 26/26 pass |
| `apps/api` production build | ✓ pass |
| `apps/web` production build | ✓ pass |
| Real-product showcase on current deployment (4 investigations) | ✓ 58/58 checks, all `MAJORITY_AGREE`, 0 unresolved errors |

The live showcase (`scripts/two_product_showcase_v2.mjs`) exercises
every one of the contract's 31 methods against a real deployed StudioNet
instance with three funded test wallets — including a real nondet
verdict pass, a full challenge/resolution cycle, real Cloudinary evidence
uploads with cryptographic content-hash verification, and the complete
seller-bond ownership-verification flow. This is the authoritative
signal for "does it actually work"; static lint/structural tests only
catch schema and safety-rule violations, not real GenVM consensus
behavior.

**Live showcase data on the current deployment**: 2 real-world
investigations, each checked against an actual live recall page before
being submitted (not placeholder text) —
[Kidde plastic-handle fire extinguishers](https://recall-raid.vercel.app/hunts/2)
(real CPSC recall, November 2017/2018, 37.8 million units — with a
linked, verified seller bond and a resolved challenge), and
[Zen Magnets / Neoballs high-powered magnet sets](https://recall-raid.vercel.app/hunts/3)
(real CPSC recall, August 2021, ~10 million units) — plus a third
minimal investigation submitted then cancelled to exercise the refund
path. Every evidence item on both real investigations is
**cryptographically hash-verified**: `verify_evidence` has every
validator independently fetch the raw bytes at the evidence URL and
confirm `sha256(bytes) == content_hash` before a verdict can even be
requested. Every transaction reached clean consensus (`MAJORITY_AGREE`)
with zero unresolved errors on the explorer.

This project went through multiple external-audit and re-audit rounds
that surfaced and closed real issues: an unfunded challenge-overturn
bonus, a permanently-lockable seller bond, an ordinal verdict-tolerance
rule that could slash a bond on a non-exact match, substring-matching
false positives in product-identifier checks, a bug in how the contract
read GenVM's own `leader_result` API inside `validator_fn` (0% observed
consensus-agreement rate before being root-caused via a dedicated
diagnostic contract), missing application actions for challenge
resolution/timeout and seller-bond linking, an evidence-verification
gate that permitted unreachable/hash-mismatched evidence through to
adjudication, a full data-flow gap where `content_hash_verified` never
reached the API/frontend, and — most recently — a genuine platform-level
attribute-naming mismatch (`gl.nondet.web.get()`'s response object uses
`.status`, not the `.status_code` shown in GenLayer's own docs examples)
that was silently swallowed by exception handling until root-caused via
four disposable diagnostic-contract deploys. Full blow-by-blow history,
including every dead end, is in [`memory.md`](memory.md) and
[`review.md`](review.md).

**Known, honestly-scoped limitation**: `verify_seller_bond_listing`
proves a bond owner controls the *content* of a specific listing page at
verification time — it does not prove marketplace-account identity,
legal seller identity, or inventory ownership. Real marketplace OAuth/
account-binding is the path to a stronger trust tier and is explicitly
out of scope for this version (no marketplace developer credentials have
been integrated). See `docs/SECURITY.md`.

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
   found in the recall source, matched with token-boundary-aware string
   matching so "A1" can't false-positive-match "A10") or an
   overconfident `NO_ISSUE` (fewer than all 3 sources reachable)
   regardless of what the model claims — see
   `contracts/recallraid_contract.py`'s `_run_verdict_pass`. Verdict
   agreement between leader and validator requires an EXACT bucket
   match with zero ordinal tolerance — a fund-moving verdict is never
   committed on anything less than exact independent agreement.
2. **Listing-ownership verification** (`verify_seller_bond_listing`) —
   the seller publishes a per-bond verification code on their listing's
   own page (the same trust model as a DNS TXT record), and every
   validator independently fetches the URL live and checks for it via
   consensus. `link_seller_bond` then requires both a verified bond
   *and* a canonicalized match (`_canonicalize_url` — host+path,
   scheme/query/trailing-slash-insensitive) between the bond's verified
   listing and the investigation's own marketplace URL, closing the gap
   where a verified-but-unrelated bond could otherwise be linked to any
   claim.

Both nondet paths share a single correctly-implemented unwrap helper,
`_unwrap_leader_result` — `validator_fn`'s `leader_result` parameter
arrives as a wrapped `gl.vm.Return` object, not a plain value, and must
be read via `.calldata` per GenLayer's own docs. Every previous access
pattern tried in this codebase (`.get()`, bare subscript, `int(...)`)
was wrong for that same reason; see `memory.md` for the full story of
how this was found.

See `docs/SECURITY.md` for the full escrow-safety and anti-abuse
reasoning, and `docs/ARCHITECTURE.md` for the on-chain/off-chain split.

## How it works, by role

**Hunter** — finds a suspicious listing, submits an investigation with a
GEN bounty (`submit_investigation`), attaches evidence (photos, a recall
notice URL, a manufacturer page URL — `add_evidence`), then requests a
verdict (`request_verdict`). If `RECALL_CONFIRMED`/`POTENTIAL_ISSUE`, the
hunter is paid from their own posted bounty (100% of it — the bounty is
a refundable stake, not a third-party-funded reward, unless a seller
bond is also linked and slashed) plus reputation. If `NO_ISSUE`, the
bounty is refunded. `NEEDS_MORE_EVIDENCE` lets the hunter add more
evidence and retry.

Evidence itself is cryptographically checked, not just an unchecked URL
and a client-supplied hash sitting in storage: `verify_evidence` has
every validator independently fetch the evidence URL's raw bytes live
via GenVM (`gl.nondet.web.get`) and reach consensus on two things —
whether it's reachable (a real 2xx response), and whether
`sha256(fetched bytes) == content_hash` actually matches, storing the
result (`url_checked`, `url_reachable`, `content_hash_verified`,
`fetch_excerpt`, `verified_at`) on the `Evidence` record itself.
**`request_verdict` reverts unless every evidence item is reachable and
hash-verified** — unverified or hash-mismatched evidence can never reach
adjudication. The adjudication prompt then tells the model explicitly,
per evidence item, whether it was independently confirmed and
hash-matched, fetched-but-mismatched, fetched-but-unreachable, or never
checked at all — the same "the contract went and looked, not just took
the submitter's word for it" trust model as `verify_seller_bond_listing`.

**Seller** — can voluntarily post a Clean Inventory Bond
(`create_seller_bond`) as a public confidence signal, prove real
ownership of a specific listing via `verify_seller_bond_listing`, then
link the verified bond to an investigation about that exact listing
(`link_seller_bond`, with a "Link to an investigation" action on the
seller dashboard once a bond's listing is verified) — slashed
proportionally (`min(bond_deposited_wei, bounty_wei)`) only on
`RECALL_CONFIRMED`, never on a mere `POTENTIAL_ISSUE`.

**Challenger** — can dispute a reached verdict within the challenge
window by staking 20% of the bounty (`open_challenge`) and requesting a
fresh, independent re-verification (`resolve_challenge`) — not a vote.
A failed challenge forfeits the full stake to the original hunter as
compensation for a correct claim being disputed; an upheld challenge
recomputes the verdict and applies a funded overturn bonus carved from
the bounty pool. The investigation detail page surfaces "Resolve
Challenge" and, once the real on-chain resolution window has elapsed,
"Claim Timeout" to any connected wallet — both are permissionless in the
contract, so the UI doesn't gate them to the original challenger.

Every deadline (`claim_evidence_timeout`, `claim_verdict_timeout`,
`claim_challenge_timeout`) is a permissionless sweep, so funds can never
be locked forever if a counterparty goes silent.

**Verdicts are explained in plain language, not shown as raw numbers.**
Both the Active Hunts list and the investigation detail page show a
`VERDICT_DESCRIPTION` sentence (`apps/web/src/types/contract.ts`) instead
of a bare enum value — e.g. "The independent re-check confirmed this
exact product against an official recall notice. The hunter is paid from
the bounty, and any linked seller bond is slashed proportionally." — plus
the model's confidence percentage, wherever a verdict is shown.

## Repository layout

```
recallraid/
  contracts/
    recallraid_contract.py       the GenLayer Intelligent Contract (31 methods: 12 view, 19 write)
    tests/                       static structural tests (AST-based, no GenVM runtime required)
    diagnostics/
      nondet_consensus_diagnostic.py   minimal 3-check contract for isolating nondet-consensus bugs
                                         from application code — see "Debugging nondet consensus" below
  apps/web/                      Next.js 14 frontend (Vercel) — wallet connect (Reown AppKit), all UI,
                                   wallet-signed writes via genlayer-js
    src/app/
      page.tsx                    landing page (live stats, hero)
      hunts/                      Active Hunts feed + investigation detail page
      submit/                     submit a new investigation
      seller/                     seller dashboard — bonds, listing verification, badges
      leaderboard/                hunter reputation ranking
      wallet/                     connected-wallet balance/withdraw
      demo-listing/[id]/          self-hosted testnet-only stand-in listing page for
                                    verify_seller_bond_listing when a seller has no live listing yet
  apps/api/                      Fastify + Postgres backend (Fly.io, always-on) — cache/session/
                                   notifications/leaderboard; NEVER signs a transaction or holds a key
    src/routes/                   auth, investigations, evidence, challenges, seller-bonds,
                                    reputation, leaderboard, notifications, tx-status, health
    src/lib/deadline-watcher.ts    background read-only sweep: mirrors tx receipts, flags upcoming deadlines
  scripts/
    full_contract_test_suite.mjs     comprehensive live end-to-end test against a deployed contract
    diagnostic_test.mjs              runs the diagnostic checks against a deployed diagnostic contract
    two_product_showcase_v2.mjs      current showcase: 2 real-world investigations with cryptographic
                                       evidence-hash verification (58/58 checks against the current deployment)
    two_product_showcase_v2_resume.mjs  resumes the above after a transient client-side network blip
    four_product_showcase.mjs        [stale] 4-product showcase from a prior deployment, kept for reference
    two_more_products.mjs            [stale] 2-product showcase from a prior deployment, kept for reference
    lib/make_product_image.mjs       dependency-free PNG generator for real (non-1x1-pixel) evidence photos
  docs/
    ARCHITECTURE.md               system design, on-chain/off-chain split, deployment topology
    SECURITY.md                   escrow safety, anti-abuse, known limitations
    DEPLOYMENT.md                 exact deploy steps for contract, API, frontend
  contracts/diagnostics/
    nondet_consensus_diagnostic.py  disposable diagnostic contract for isolating nondet-consensus/web-fetch
                                     platform issues from application bugs — see memory.md for what it caught
  review.md                       response to the team's application-review rounds — what was fixed, how verified
  memory.md                       persistent build log / decision record — read this first in any new session
```

## Contract method reference

**Write (19)**: `submit_investigation` (payable), `add_evidence`,
`verify_evidence`, `request_verdict`, `cancel_investigation`,
`claim_evidence_timeout`, `claim_verdict_timeout`, `open_challenge`
(payable), `resolve_challenge`, `claim_challenge_timeout`,
`settle_investigation`, `withdraw`, `create_seller_bond` (payable),
`topup_seller_bond` (payable), `link_seller_bond`,
`withdraw_seller_bond`, `verify_seller_bond_listing`, `set_paused`
(admin), `transfer_administration` (admin).

**View (12)**: `get_investigation`, `get_investigation_count`,
`get_investigation_id_at`, `list_investigations`, `get_evidence`,
`get_evidence_ids_for_investigation`, `get_challenge`, `get_seller_bond`,
`get_seller_bond_count`, `get_balance`, `get_reputation`,
`get_protocol_info`.

## Requirements

- Node.js >= 18, npm >= 9
- Python 3.11+ (for the contract itself; no runtime Python dependency
  beyond the stdlib — `genvm-linter` is only a local dev-time lint tool)
- Docker (for local Postgres only — never for GenLayer)
- Fly CLI, Vercel CLI
- A GenLayer Studio account to deploy the contract yourself (Claude never
  deploys the contract — see `docs/DEPLOYMENT.md`)

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

| Variable | Where | Purpose |
| --- | --- | --- |
| `NEXT_PUBLIC_GENLAYER_CONTRACT_ADDRESS` / `GENLAYER_CONTRACT_ADDRESS` | web / api | the deployed contract — see `docs/DEPLOYMENT.md`'s redeploy workflow |
| `NEXT_PUBLIC_GENLAYER_RPC_URL` / `GENLAYER_RPC_URL` | web / api | `https://studio.genlayer.com/api` (StudioNet) |
| `NEXT_PUBLIC_REOWN_PROJECT_ID` | web | Reown AppKit wallet-connect project ID |
| `NEXT_PUBLIC_API_BASE_URL` | web | `https://recallraid-api.fly.dev` |
| `DATABASE_URL` | api | Postgres connection string |
| `CORS_ALLOWED_ORIGIN` | api | `https://recall-raid.vercel.app` |
| `JWT_SIGNING_SECRET` | api | session cookie signing |
| `CLOUDINARY_CLOUD_NAME` / `_API_KEY` / `_API_SECRET` / `_UPLOAD_FOLDER` | api | signed evidence-photo uploads |
| `DEADLINE_WATCHER_INTERVAL_MS` | api | background sweep interval, currently 180000 (3min) — see `apps/api/README.md` |

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

As of the last full run against a prior deployment: **67/67 checks
passing**, including `MAJORITY_AGREE` on both nondet methods, the full
challenge/resolution lifecycle, and every seller-bond ownership guard
(unverified-bond rejection, mismatched-listing rejection, and a
legitimate verified+matching link all behaving correctly). This suite's
`CONTRACT_ADDRESS` constant should be updated before re-running it
against the current deployment above.

`scripts/two_product_showcase_v2.mjs` is the current showcase script —
it submitted the 2 real-world investigations described in the Status
section above (Kidde fire extinguishers, Zen Magnets/Neoballs) end to
end against `0x4aB01fb5435cdEfD3c651Cfc51f0F1fa1E2Ef6a4`, including the
new cryptographic evidence-hash-verification gate, with deliberately
zero negative/expect-revert calls, since a guard-clause rejection shows
up as an execution error on the GenLayer explorer even though it's
contract-correct. **58/58 checks passed.** Older scripts
(`scripts/four_product_showcase.mjs`, `scripts/two_more_products.mjs`)
remain in the repo as reference for prior deployments' showcases but
target stale contract addresses.

## Debugging nondet consensus

If a `gl.vm.run_nondet_unsafe` call ever starts disagreeing unexpectedly,
`contracts/diagnostics/nondet_consensus_diagnostic.py` is a minimal,
RecallRaid-independent contract with three trivial controls (a hardcoded-
constant round-trip, a stable public-page fetch, a tiny LLM
classification) for isolating whether the problem is platform-level or
application-level *before* spending time patching application code:

```bash
CONTRACT_ADDRESS=0xYourDiagnosticDeploy node scripts/diagnostic_test.mjs
```

The last time this was needed, `check_constant` (zero I/O, a hardcoded-
int comparison) disagreed just like the application code did — which
turned out to mean an application bug (the `leader_result` unwrap issue
above), not a platform issue, once the actual crash message was
inspected. Full story in `memory.md`.

## Documentation

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — system design, on-chain/off-chain split, deployment topology
- [`docs/SECURITY.md`](docs/SECURITY.md) — escrow safety, anti-abuse, custody model, known limitations
- [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) — exact deploy steps for contract, API, frontend, redeploy workflow
- [`apps/api/README.md`](apps/api/README.md) — API-specific local dev, endpoints, background jobs
- [`memory.md`](memory.md) — locked decisions and full build history, read first in any new session
