# Review response — evidence verifiability, challenge resolution/timeout, seller-bond linking

**Review received (verbatim):**

> Thanks for the submission. Please add application actions for resolving
> or timing out an open challenge and for linking a verified seller bond
> to an investigation. Also make the required uploaded evidence
> materially verifiable and available to the contract's adjudication
> path, rather than storing only an unchecked URL and client-supplied
> hash with empty metadata.

This document records what was checked, what was already correct, what
was fixed, and how each fix was verified — both structurally (lint/tests)
and live, on-chain, against a freshly deployed contract
(`0xcb8081F71210EC19Db3E70b4A880CfcfEb9a9E27`, StudioNet).

## 1. "Resolving or timing out an open challenge"

**Status: already implemented, verified correct, no change needed.**

`resolve_challenge(challenge_id)` (`contracts/recallraid_contract.py`)
re-runs the same independently-verifiable nondet adjudication pass
against the investigation's live evidence — a challenge is resolved by
re-fetching public evidence again, not by a vote on the challenger's
opinion. It correctly:

- Marks the challenge `CHALLENGE_OVERTURNED` or `CHALLENGE_UPHELD`.
- On overturn, refunds the challenger's stake plus a bonus funded strictly
  from the submitter's own already-escrowed `bounty_deposited_wei`
  (capped at what's actually in the pool — never manufactured from
  nothing, per an earlier audit finding already fixed in this codebase).
- On uphold, forfeits the stake to the original submitter and dings the
  challenger's reputation.
- Reopens the investigation's challenge window (`challenge_deadline`)
  rather than leaving it permanently unchallengeable.

`claim_challenge_timeout(challenge_id)` is the companion permissionless
sweep: if a challenge sits unresolved past its `resolution_deadline`, it
is treated as upheld (the standing verdict wins), the stake is forfeited
to the submitter, and the investigation is unfrozen — so an abandoned
challenge can never lock an investigation forever.

**Verified live on the new deployment**: `open_challenge` →
`resolve_challenge` exercised end-to-end on Product 1 (see §4) —
`MAJORITY_AGREE`, verdict correctly overturned from `NO_ISSUE` to
`POTENTIAL_ISSUE`, challenger stake + bonus credited. `claim_challenge_timeout`
was not exercised in this round (no challenge was left to sit past its
real 2-day resolution deadline — see the "not exercised" note in §4);
its correctness was instead confirmed by code review of the stake/refund/
reputation accounting above, which matches `resolve_challenge`'s upheld
path exactly.

## 2. "Linking a verified seller bond to an investigation"

**Status: already implemented, verified correct, no change needed.**

`link_seller_bond(investigation_id, bond_id)` requires, in order:

1. The caller owns the bond.
2. The bond is `BOND_ACTIVE`.
3. `bond.listing_verified` is `True` — i.e. `verify_seller_bond_listing`
   has already succeeded for this bond (a real GenVM-fetch + validator
   consensus check that the bond owner controls the listing's page
   content, not a self-reported claim).
4. The bond's verified `listing_url` **canonically matches** the target
   investigation's own `marketplace_url` (`_canonicalize_url` on both
   sides) — closing a real prior audit finding where a bond verified
   against one URL (even an unrelated demo page) could be linked to any
   investigation regardless of listing.
5. The investigation hasn't already reached a verdict, and doesn't
   already have a linked bond.

So a linked bond is a genuine, listing-specific accountability stake:
"this seller proved control of the exact page this investigation is
about," not "this seller controls some page somewhere."

**Verified live on the new deployment**: `create_seller_bond` →
`verify_seller_bond_listing` (real code-in-page check against a live
demo-listing URL) → `submit_investigation` with that same URL as
`marketplace_url` → `link_seller_bond` — all `MAJORITY_AGREE`, all
succeeded (see §4, Product 1).

## 3. Evidence verifiability — the real gap, now fixed

**Status: genuine gap, fixed this round.**

Before this fix, `Evidence` stored only `content_hash` (computed
client-side, never checked by the contract) and `url` (never fetched),
plus a free-text `description` — i.e. exactly what the review described:
an unchecked URL and a client-supplied hash, with no real metadata, and
the adjudication prompt in `_run_verdict_pass` only ever saw the
submitter's own claim about that evidence, never anything the contract
itself had gone and looked at.

### What changed

- **New fields on `Evidence`**: `url_checked`, `url_reachable`,
  `fetch_excerpt`, `verified_at`.
- **New write method `verify_evidence(evidence_id)`**: mirrors the exact
  trust model `verify_seller_bond_listing` already uses — every validator
  independently fetches `ev.url` live via `gl.nondet.web.render` and the
  network reaches consensus on the boolean `reachable` result (only the
  boolean is required to agree byte-for-byte across validators; exact
  text equality on a live page's content across independent fetches is
  fragile and was never required elsewhere in this codebase either — see
  the manufacturer/recall/listing fetches inside `_run_verdict_pass`,
  which are leader-attested best-effort in exactly the same way). Sets
  `url_checked`, `url_reachable`, `fetch_excerpt`, `verified_at` on the
  evidence record.
- **Adjudication now sees real material, not just a claim**:
  `_run_verdict_pass`'s evidence snapshot and `_render_verdict_prompt`
  tell the model, per evidence item, one of three states — "independently
  fetched and confirmed reachable" (with the actual fetched excerpt),
  "fetched but unreachable/empty — treat as unsupported," or "NOT
  independently checked yet — treat as an unverified claim only." This
  lets the verdict pass weigh verified evidence differently from an
  unchecked claim, which is what the review asked for.
- **Exposed everywhere data flows**: `get_evidence` (view method),
  `apps/api`'s `evidence_cache` table (new migration
  `20260831000000_add_evidence_verification.sql`, `syncEvidence`
  updated), and the `ChainEvidence`/`Evidence` TypeScript types in both
  `apps/api` and `apps/web`.

### Honest scope — what this does and does not prove

`verify_evidence` proves the URL is live and independently fetchable by
every validator, and captures what was actually there at verification
time. It does **not** cryptographically prove `content_hash` matches the
live bytes at `url` — GenVM's `gl.nondet.web.render` fetches rendered
text, not raw bytes suitable for a byte-for-byte hash comparison across a
photo upload, and exact-text consensus on a dynamic page was already a
known fragility this codebase deliberately avoids elsewhere (see the
`verify_seller_bond_listing` design note in the contract). What it closes
is the specific gap the review named: evidence is no longer *just* an
unchecked URL and a client-supplied hash sitting inert in storage — the
contract itself fetches it, reaches consensus on reachability, and feeds
the real fetched content into the same adjudication path that decides
the verdict.

### Verification performed

- `genvm-lint check contracts/recallraid_contract.py` → **Lint passed (3
  checks)**, **Validation passed**, **31 methods (12 view, 19 write)**,
  up from 30 (12 view, 18 write).
- `pytest contracts/tests/test_contract_structure.py` → all 27
  structural tests still pass, unchanged.
- `apps/api` and `apps/web` both typecheck clean (`tsc --noEmit`).
- Live on the freshly deployed contract (`0xcb8081F71210EC19Db3E70b4A880CfcfEb9a9E27`):
  `verify_evidence` called on all 4 real evidence items across both
  products, all `MAJORITY_AGREE`, `url_reachable: true` for every item —
  including a real fetched excerpt of the actual live cpsc.gov recall
  page for Product 2, confirmed present in `get_evidence`'s returned
  `fetch_excerpt` field (see §4).

## 4. Live verification run (new deployment)

New contract `0xcb8081F71210EC19Db3E70b4A880CfcfEb9a9E27` deployed by the
project owner (never by Claude, per standing project rule). Wired into
`.env`, `apps/web/.env.local`, `apps/api/.env`, Fly secrets
(`recallraid-api`), and the hardcoded `CONTRACT_ADDRESS` constants in
`scripts/full_contract_test_suite.mjs`, `scripts/four_product_showcase.mjs`,
and `scripts/two_more_products.mjs`. Postgres cache tables truncated
(`evidence_cache`, `challenges_cache`, `seller_bonds_cache`,
`notifications`, `tx_status_log`, `leaderboard_cache`,
`evidence_uploads_pending`, `investigations_cache`) and the new evidence-
verification migration applied, so nothing from the prior contract
carried over.

Two entirely new real products (never used in any prior showcase run) —
`scripts/two_product_showcase_v2.mjs` (+ a short resume script after a
transient client-side SSL/network blip, not a contract error, interrupted
the run partway through the seller-bond-2 section):

**Product 1 — Kidde plastic-handle fire extinguishers** (real CPSC
recall, November 2017 / notice updated 2018 — 37.8 million units,
failure-to-discharge and nozzle-detachment hazard, one death reported).
Full lifecycle exercised: `create_seller_bond` → `verify_seller_bond_listing`
→ `submit_investigation` → `link_seller_bond` → `add_evidence` (photo +
recall notice) → `verify_evidence` (both items) → `request_verdict`
(`NO_ISSUE`, 7200bps) → `open_challenge` → `resolve_challenge`
(overturned to `POTENTIAL_ISSUE`).

**Product 2 — Zen Magnets / Neoballs high-powered magnet sets** (real
CPSC recall, August 2021 — ~10 million units, ingestion hazard, deaths
and surgeries reported). `submit_investigation` → `add_evidence` (photo +
recall notice) → `verify_evidence` (both items — the recall-notice
item's `fetch_excerpt` captured the actual live cpsc.gov page text) →
`request_verdict` (`POTENTIAL_ISSUE`, 6800bps).

Plus: a third minimal submission exercising `cancel_investigation`'s real
refund path; a second, unlinked seller bond exercising
`topup_seller_bond` + `withdraw_seller_bond`; `withdraw()` for both
hunter and seller wallets against their real credited balances; and the
full non-admin view-method sweep (`get_protocol_info`, `get_balance`,
`get_reputation`, `get_investigation`, `get_investigation_count`,
`get_investigation_id_at`, `list_investigations`,
`get_evidence_ids_for_investigation`, `get_evidence`, `get_challenge`,
`get_seller_bond`, `get_seller_bond_count`).

**Result: 39 checks run across the two scripts (22 in the main run before
a transient client-side SSL/network blip interrupted it, 17 in the
resume), 39 passed, 0 failed. Every write call reached clean consensus
(`MAJORITY_AGREE`), zero errors on the explorer.** Final state:
`get_investigation_count=3`, `get_seller_bond_count=2`, hunter and seller
both successfully withdrew their real credited GEN balances, challenger's
reputation correctly shows `successful_challenges=1` with
`total_earned_wei=11500000000000000` (the forfeited stake plus the
15%-of-stake overturn bonus) from the Product 1 challenge.

**Not exercised (by design, not oversight)**: `claim_evidence_timeout`
(3-day window), `claim_verdict_timeout` (2-day), `claim_challenge_timeout`
(2-day) — all three are gated by real elapsed time and calling any of
them before their deadline genuinely reverts; no investigation in this
round sat unresolved long enough to hit those deadlines.
`settle_investigation` (2-day challenge window) was likewise not called
in this round for the same reason — both investigations' challenge
windows had not yet elapsed at the time of this run. `set_paused` /
`transfer_administration` are admin-only and out of scope per the
original request.
