# Review response — evidence verifiability, challenge resolution/timeout, seller-bond linking

**Review received (verbatim):**

> Thanks for the submission. Please add application actions for resolving
> or timing out an open challenge and for linking a verified seller bond
> to an investigation. Also make the required uploaded evidence
> materially verifiable and available to the contract's adjudication
> path, rather than storing only an unchecked URL and client-supplied
> hash with empty metadata.

**Re-audit received after round 1 (verbatim):**

> The application-action requirement is now fixed, but the evidence
> requirement is still only partially fixed. Remaining blocker:
> `request_verdict` only requires that every item was checked; it
> permits unreachable evidence and hash-mismatched evidence to reach
> adjudication. There is also a data-flow gap: `content_hash_verified`
> exists in the contract but was not added to the API chain type,
> database migration/cache sync, serializer, or frontend type.

This document is the full record: what was already correct, what was
genuinely missing, what broke along the way, and how everything was
verified — both structurally (lint/tests/typecheck) and live, on-chain,
against the final deployed contract
(`0x4aB01fb5435cdEfD3c651Cfc51f0F1fa1E2Ef6a4`, StudioNet).

## 1. "Resolving or timing out an open challenge" — contract + UI

**Status: contract logic was already correct; the review's actual ask
(an application action) was genuinely missing and is now added.**

`resolve_challenge(challenge_id)` re-runs the same independently-
verifiable nondet adjudication pass against the investigation's live
evidence — a challenge is resolved by re-fetching public evidence again,
not by a vote on the challenger's opinion. It correctly marks the
challenge `CHALLENGE_OVERTURNED` or `CHALLENGE_UPHELD`, refunds/forfeits
the stake and bonus accordingly (the bonus is capped and funded strictly
from the submitter's own already-escrowed bounty, never manufactured),
and reopens the investigation's challenge window.
`claim_challenge_timeout(challenge_id)` is the companion permissionless
sweep for an abandoned challenge past its `resolution_deadline`.

The re-audit correctly pointed out that neither had an application
surface: [apps/web/src/app/hunts/[id]/page.tsx](apps/web/src/app/hunts/[id]/page.tsx)
now fetches the investigation's open challenge (`GET
/investigations/:id/challenges`, newly serialized correctly — see §4)
and shows a "Resolve Challenge" button, switching to "Claim Timeout"
once the real `resolution_deadline` has elapsed. Both actions are
permissionless in the contract (no sender check), so the UI offers them
to any connected wallet.

**Verified live**: `open_challenge` → `resolve_challenge` exercised
end-to-end on the final run (§5) — `MAJORITY_AGREE`, challenge correctly
upheld (`overturned: false`), challenger's reputation shows
`failed_challenges: 1`. `claim_challenge_timeout` was not exercised live
(no challenge was left to sit past its real 2-day window) — the UI
button and contract logic were verified separately (code review + the
`resolve_challenge` upheld path, which shares the same accounting).

## 2. "Linking a verified seller bond to an investigation" — contract + UI

**Status: same pattern — contract logic already correct, application
action was missing, now added.**

`link_seller_bond(investigation_id, bond_id)` requires the caller to own
an `ACTIVE` bond, that `bond.listing_verified` is `True` (a real
GenVM-fetch + validator consensus proof of listing-page control, not a
self-reported claim), and that the bond's verified `listing_url`
**canonically matches** the target investigation's own `marketplace_url`
— closing a real prior audit finding where a verified-for-one-URL bond
could be linked to an unrelated investigation.

[apps/web/src/app/seller/page.tsx](apps/web/src/app/seller/page.tsx) now
has a "Link to an investigation" action on every verified, active bond —
an investigation-ID input plus a client-side pre-flight check
(`normalizeUrlForCompare`, mirroring the contract's own
`_canonicalize_url`) that surfaces a clear message if the listing
doesn't match, instead of only an on-chain revert.

**Verified live**: `create_seller_bond` → `verify_seller_bond_listing`
→ `submit_investigation` (same listing URL) → `link_seller_bond` — all
`MAJORITY_AGREE` (§5, Product 1).

## 3. Evidence verifiability — the real gap, fixed in three passes

**Status: genuinely fixed, including the two problems the re-audit
caught that round 1 missed.**

### Round 1: added `verify_evidence`, but only checked reachability

Before any fix, `Evidence` stored only a client-supplied `content_hash`
(never checked) and `url` (never fetched) — exactly the review's
complaint. Round 1 added `verify_evidence(evidence_id)`: every validator
independently fetches the URL live and reaches consensus on whether it's
reachable, feeding the result into the adjudication prompt. This closed
half the gap but not the "materially verifiable" half — no cryptographic
tie between the claimed hash and the actual bytes.

### Round 2 (re-audit): fixed the hash gate and the data-flow gap

The re-audit was accurate on both points:

1. **`request_verdict`'s gate was too weak** — it only required
   `url_checked`, silently permitting unreachable or hash-mismatched
   evidence through to adjudication. Fixed: `request_verdict` now
   reverts unless every evidence item is `url_checked` **and**
   `url_reachable` **and** `content_hash_verified`.
2. **`content_hash_verified` never reached the API/frontend** — and it
   was worse than flagged: `serializeEvidence` was silently dropping the
   *entire* verification block (`url_checked`, `url_reachable`,
   `fetch_excerpt`, `verified_at` too), so `GET /evidence` exposed none
   of it. Fixed everywhere: `ChainEvidence`/`Evidence` types, `sync.ts`,
   a new migration, a full `serializeEvidence` rewrite, and a visible
   "Hash verified / Hash mismatch / Not yet verified" badge on the
   evidence gallery in [apps/web/src/app/hunts/[id]/page.tsx](apps/web/src/app/hunts/[id]/page.tsx).

`verify_evidence` was also rewritten to actually fetch raw bytes
(`gl.nondet.web.get`, not `.render`, which returns browser-processed
text) and cryptographically compare `sha256(fetched bytes)` against the
submitter's claimed `content_hash` — the real "materially verifiable"
tie the review asked for, not just a reachability check.

### The `.status_code` bug this uncovered — and how it was found

Live-testing round 2's rewrite surfaced a genuine platform-level bug:
`gl.nondet.web.get()`'s response object has **no `status_code`
attribute** on this pinned runner (`py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6`),
contrary to GenLayer's own docs examples. `int(resp.status_code)` threw
`AttributeError` on every call, silently caught by the broad
`except Exception`, indistinguishable from a genuinely unreachable URL.
Switching to `gl.nondet.web.request()` first (also documented) made no
difference — same response object, same missing attribute, proving the
bug was about the attribute name, not the fetch method.

Root-caused with a dedicated, disposable diagnostic contract
(`contracts/diagnostics/nondet_consensus_diagnostic.py`) rather than
guessing against RecallRaid's real state a third time: added
`check_web_get_raw`, which printed the response object's actual
attributes (`sorted(dir(resp))` → `body, headers, status`). Confirmed
the fix end-to-end on the diagnostic contract before touching RecallRaid
again — `resp.status` returns `200`, and `sha256(resp.body)` matched a
plain local fetch of the same URL byte-for-byte. Fixed
`verify_evidence` to use `.status` instead of `.status_code`. See
`memory.md` for the full diagnostic trail (four diagnostic-contract
redeploys, all free/harmless, to avoid burning RecallRaid redeploys on
guesses).

### A second real finding: cpsc.gov itself is unreliable for hash-verification

With the `.status` fix live, the Kidde photo evidence verified correctly
(`url_reachable: true, content_hash_verified: true`) but the recall-
notice evidence pointing directly at `cpsc.gov`'s own page came back
unreachable. Tested directly via the diagnostic contract's parametrized
`check_web_get_url`: the live cpsc.gov page returns `MAJORITY_DISAGREE`
under `gl.nondet.web.get` — independent validator fetches don't converge
on identical bytes (likely WAF/bot-detection or per-request dynamic
content), and the same was true of a PRNewswire mirror of the same
release. A static PDF hosting of the identical official recall document
(confirmed via the same diagnostic tool) round-trips reliably with
`MAJORITY_AGREE` and a stable sha256. **This is about where GenVM can
reliably fetch identical bytes from, not about using different
information** — `scripts/two_product_showcase_v2.mjs` now points each
recall-notice evidence item's hash-verified URL at a static PDF copy of
the same real, official CPSC recall document, while the investigation's
own `recall_source_url` (used by `_run_verdict_pass`'s adjudication
fetch via `gl.nondet.web.render`, a different, apparently more tolerant
code path) still points at the live cpsc.gov page.

### Honest scope

`content_hash_verified` is a real cryptographic guarantee: GenVM
independently fetched the exact bytes at the URL and confirmed
`sha256(bytes) == content_hash`, with validator consensus required on
that boolean. It does not protect against a URL's content silently
changing *after* verification (the URL itself isn't pinned to a specific
snapshot beyond the hash check performed at `verify_evidence` time) —
that's an inherent limit of hash-checking a live URL rather than storing
the file on-chain, not a shortcut taken here.

### Verification performed

- `genvm-lint check contracts/recallraid_contract.py` → **Lint passed (3
  checks)**, **Validation passed**, **31 methods (12 view, 19 write)**.
- `pytest contracts/tests/test_contract_structure.py` → all 27
  structural tests pass.
- `apps/api` and `apps/web` both typecheck and build clean.
- Live on the final deployed contract (`0x4aB01fb5435cdEfD3c651Cfc51f0F1fa1E2Ef6a4`):
  every evidence item across both real products came back
  `url_reachable: true, content_hash_verified: true`.

## 4. API/serializer fixes uncovered along the way

- `GET /investigations/:id/challenges` previously returned raw
  `challenges_cache` rows (text-label enums, `challenge_id`/
  `challenger_wallet` column names) that didn't match the frontend's
  numeric `Challenge` type at all — would have silently broken any
  consumer. Now runs through a real `serializeChallenge`
  (`apps/api/src/lib/serialize.ts`).
- `serializeEvidence` was dropping the entire evidence-verification
  block from every `GET /evidence` response (see §3). Fixed.

## 5. Final live verification run

Contract `0x4aB01fb5435cdEfD3c651Cfc51f0F1fa1E2Ef6a4` deployed by the
project owner (never by Claude). Wired into `.env`, `apps/web/.env.local`,
`apps/api/.env`, Fly secrets, Vercel production env, and every script's
hardcoded `CONTRACT_ADDRESS`. Postgres cache tables truncated so nothing
from any prior contract carried over.

Two real products, run via `scripts/two_product_showcase_v2.mjs`:

**Product 1 — Kidde plastic-handle fire extinguishers** (real CPSC
recall, November 2017/2018 — 37.8 million units, failure-to-discharge
and nozzle-detachment hazard, one death reported). Full lifecycle:
`create_seller_bond` → `verify_seller_bond_listing` →
`submit_investigation` → `link_seller_bond` → `add_evidence` (photo +
static-PDF recall notice) → `verify_evidence` (both items, both
cryptographically hash-verified) → `request_verdict` (`POTENTIAL_ISSUE`,
7200bps) → `open_challenge` → `resolve_challenge` (upheld).

**Product 2 — Zen Magnets / Neoballs high-powered magnet sets** (real
CPSC recall, August 2021 — ~10 million units, ingestion hazard, deaths
and surgeries reported). `submit_investigation` → `add_evidence` (photo
+ static-PDF recall notice) → `verify_evidence` (both items,
hash-verified) → `request_verdict` (`POTENTIAL_ISSUE`, 6800bps).

Plus: a third minimal submission exercising `cancel_investigation`'s
real refund path; a second, unlinked seller bond exercising
`topup_seller_bond` + `withdraw_seller_bond`; `withdraw()` for both
hunter and seller against real credited balances; and the full
non-admin view-method sweep.

**Result: 58 checks run, 58 passed, 0 failed. Every write call reached
clean consensus (`MAJORITY_AGREE`), zero errors on the explorer.** Final
state: `get_investigation_count=4` (including the cancelled exercise),
`get_seller_bond_count=3`, hunter and seller both withdrew their real
credited GEN balances, challenger's reputation shows
`failed_challenges: 1` from the upheld Product 1 challenge.

**Not exercised (by design)**: `claim_evidence_timeout` (3-day window),
`claim_verdict_timeout` (2-day), `claim_challenge_timeout` (2-day), and
`settle_investigation` (2-day challenge window) — all four are gated by
real elapsed time; no investigation in this round sat unresolved long
enough to hit those deadlines. `set_paused`/`transfer_administration`
are admin-only and out of scope per the original request.
