# RecallRaid Architecture

## What RecallRaid is

A crowdsourced marketplace-safety bounty platform. A user ("hunter") finds a
potentially recalled/defective/mislabeled product listing, stakes GEN as a
bounty, and submits evidence. The GenLayer Intelligent Contract independently
re-fetches public evidence (manufacturer pages, recall databases, the listing
itself) via multiple validators and reaches a verdict. If confirmed, the
hunter is paid from the bounty and, if the seller had voluntarily posted a
Clean Inventory Bond, that bond is slashed proportionally. Verdicts can be
challenged within a window by staking GEN against them, which triggers a
fresh independent re-verification.

## Layer responsibilities

**Blockchain (GenLayer Intelligent Contract, `contracts/recallraid_contract.py`)**
owns: bounty escrow, seller bond escrow, evidence *references* (hash + URL,
never raw files), verdicts, challenge stakes/outcomes, the pull-payment
balance ledger, and reputation counters. This is the only layer whose state
is trust-minimized and independently re-computable by anyone.

**Application backend (`apps/api`, Fastify + Postgres on Fly.io)** owns: user
profile/session data keyed by wallet address, full evidence text and Cloudinary file
metadata, notifications, a transaction-status mirror for the frontend
(idle → preparing → wallet-confirm → submitted → pending → confirmed/failed/
timeout), and a leaderboard cache built by periodically reading the
contract's view methods and reputation events. **The backend never signs a
transaction and never holds a private key** — it only calls read/view
methods and polls transaction receipts. Every value-moving call
(`submit_investigation`, `add_evidence`, `open_challenge`, `withdraw`, etc.)
is signed client-side by the connected wallet via `genlayer-js`, directly
from `apps/web`.

**Frontend (`apps/web`, Next.js on Vercel)** is the consumer-facing surface.
It never exposes a private key, contract deploy key, or Cloudinary secret — those
live only in Fly.io server-side environment.

## Why this split

Putting everything on-chain would mean storing large images/screenshots and
free-text descriptions in contract storage — expensive, and GenVM storage is
not designed for large blobs. Keeping business/session data entirely
off-chain would mean the bounty payout and verdict have no independently
verifiable anchor. The dividing line used throughout: **on-chain only for
what benefits from immutability, trust-minimization, or economic
enforcement (money, verdicts, evidence integrity hashes); off-chain for
everything else (full content, UX state, caching).**

## Deployment topology

```
┌────────────┐        ┌──────────────────┐        ┌───────────────────┐
│  Vercel    │──HTTPS─▶│   Fly.io API     │──RPC──▶│  GenLayer StudioNet │
│  Next.js   │         │  Fastify + PG    │        │  RecallRaid contract│
└─────┬──────┘         └────────┬─────────┘        └───────────────────┘
      │  genlayer-js (wallet-signed writes, direct to StudioNet RPC)
      └───────────────────────────────────────────────────▶ (same RPC, bypassing the API for writes)
                              │
                        ┌─────▼─────┐        ┌──────────────┐
                        │ Fly Postgres│        │  Cloudinary   │
                        └────────────┘        └──────────────┘
```

The frontend talks to the API for reads/caching/notifications, and talks
directly to GenLayer's RPC for wallet-signed writes — the API is never in
the critical path for a transaction to be submitted, which is also why the
API dying briefly cannot block a user from submitting a bounty (only from
seeing the cached leaderboard update immediately).

## Contract address flow

The contract is deployed by the user via the GenLayer Studio CLI (never by
Claude). The resulting address is placed in `GENLAYER_CONTRACT_ADDRESS`
(server) and `NEXT_PUBLIC_GENLAYER_CONTRACT_ADDRESS` (client) — never
hardcoded in source. See `docs/DEPLOYMENT.md` for the exact procedure.

## Nondet consensus (GenVM Equivalence Principle)

Two contract methods use `gl.vm.run_nondet_unsafe` directly (the
lower-level leader/validator primitive, not the higher-level
`gl.eq_principle.*` helpers): `request_verdict`/`resolve_challenge`'s LLM
verdict pass, and `verify_seller_bond_listing`'s web-fetch ownership
proof. Both follow the same pattern — a `leader_fn` that does the real
`gl.nondet.*` call, and a `validator_fn` that independently re-runs
`leader_fn` and compares against the leader's proposed value via
`_unwrap_leader_result` (unwrapping GenVM's `gl.vm.Return` wrapper via
`.calldata`, per GenLayer's own docs — see `memory.md` for why this
exact unwrap step matters and what happens without it).

`contracts/diagnostics/nondet_consensus_diagnostic.py` is a minimal,
separate contract kept in the repo for isolating any future nondet-
consensus regression from application-code bugs before touching
RecallRaid itself — see the README's "Debugging nondet consensus"
section.

## Contract data model

Four `@allow_storage @dataclass` types, each with a corresponding
`TreeMap[u32, T]` + `DynArray[u32]` id-list pair on `RecallRaid` (a flat
`DynArray` was chosen over a nested `TreeMap[u32, DynArray[u32]]` index
after the latter hit a real `gl.storage.inmem_allocate` runtime bug on
the pinned GenVM runner — see `memory.md`):

- **`Investigation`** — product identity (name/brand/model/serial),
  category + hazard class, the three evidence-source URLs (manufacturer/
  recall/marketplace), bounty ledger fields, verdict + confidence,
  status enum (`OPEN` → `EVIDENCE_SUBMITTED` → `VERDICT_REACHED` →
  `CHALLENGED`/`SETTLED`/`CANCELLED`), deadlines, and an optional linked
  `seller_bond_id`.
- **`Evidence`** — `investigation_id`, submitter, type, `content_hash`
  (sha256 of the off-chain file, computed client-side), `url`,
  description. Never stores the file itself.
- **`Challenge`** — `investigation_id`, challenger, reason, stake
  ledger, status, resolution deadline, `prior_verdict`/`new_verdict`
  snapshots.
- **`SellerBond`** — seller, bond ledger fields, status
  (`ACTIVE`/`DEPLETED`/`WITHDRAWN`), `linked_investigation_count`,
  `slashed_total_wei`, and the listing-verification triple
  (`verification_code`, `listing_url`, `listing_verified`).

A single `balances: TreeMap[Address, u256]` pull-payment ledger backs
every payout — `withdraw()` is the ONLY function that ever calls
`_send_gen` (the single money-emission chokepoint), so no settlement
path does an unbounded number of external transfers in one call even
though a single verdict can owe money to the submitter, a hunter, and a
challenger simultaneously.

## Investigation lifecycle (state machine)

```
OPEN ──add_evidence──▶ EVIDENCE_SUBMITTED ──request_verdict──▶ VERDICT_REACHED ──challenge window elapses──▶ SETTLED
  │                          │                                       │
  cancel_investigation   claim_evidence_timeout                  open_challenge
  (refund)                (refund)                                   │
                                                                       ▼
                                                                  CHALLENGED ──resolve_challenge──▶ VERDICT_REACHED (new verdict)
```

`request_verdict` returning `NEEDS_MORE_EVIDENCE` sends the investigation
back to `EVIDENCE_SUBMITTED` rather than advancing it, so a hunter can
add more evidence and retry — this is the normal, expected outcome for
genuinely thin evidence, not an error. `claim_verdict_timeout` and
`claim_challenge_timeout` are permissionless sweeps for a stalled round.
`settle_investigation` is the terminal step that actually moves money
into the pull-payment ledger based on the final verdict.

## Seller-bond ownership-verification flow

```
create_seller_bond()                    seller publishes verification_code
  → generates verification_code           somewhere in their listing's
    (sha256 of bond_id/seller/            visible text (or uses the
    created_at)                           testnet-only demo-listing page)
         │                                          │
         └──────────────► verify_seller_bond_listing(bond_id, listing_url) ◄──────┘
                                    │
                    leader_fn + every validator independently
                    fetch listing_url live and check for the code
                    (gl.vm.run_nondet_unsafe consensus)
                                    │
                    on MAJORITY_AGREE: bond.listing_verified = True,
                    bond.listing_url = listing_url
                                    │
                                    ▼
              link_seller_bond(investigation_id, bond_id)
              requires BOTH listing_verified == True AND
              canonicalize(bond.listing_url) == canonicalize(inv.marketplace_url)
```

This proves the bond owner controls the *content* of that specific
listing page at verification time — it does not prove the underlying
marketplace account's real-world identity. See `docs/SECURITY.md` for
the full scope statement.
