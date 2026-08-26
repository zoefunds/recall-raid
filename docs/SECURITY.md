# RecallRaid Security Notes

## Wallet & key custody

RecallRaid is wallet-based auth only — there is no custodial wallet, no
private key ever touches the backend or database. The backend's only
cryptographic responsibility is verifying a signed nonce (challenge-
response) to issue a session; it never signs on the user's behalf.

## Escrow safety (contract-level)

`contracts/recallraid_contract.py` follows the zero-then-transfer discipline
throughout:

1. Every payout path reads the relevant `*_deposited_wei` ledger field into
   a local variable.
2. Zeroes that field in storage.
3. Persists the record.
4. Only then credits `balances[address]` (a pull-payment ledger) or, in
   `withdraw()`, calls `_send_gen`.

No function transfers before the ledger is zeroed and saved, so a second
call into the same payout path finds a zero balance and rejects before
reaching any transfer. `withdraw()` is the single chokepoint that ever
calls `_send_gen` — every other payout path only credits the internal
ledger, which avoids doing an unbounded number of external transfers inside
one settlement call (a single verdict can owe money to the submitter, a
hunter, and a challenger simultaneously).

Every escrow entry point (`submit_investigation`, `open_challenge`,
`create_seller_bond`, `topup_seller_bond`) is `@gl.public.write.payable` and
reads the amount exclusively from `gl.message.value` — never from a
caller-supplied parameter — and validates it before recording it as a term.

Exit paths enumerated up front (per the escrow design brief this project
was built against):
- **Success** (RECALL_CONFIRMED/POTENTIAL_ISSUE verdict, settled) → hunter share paid.
- **Failure** (NO_ISSUE verdict, settled) → full refund to submitter.
- **Split** — not applicable to a binary bounty (payout_bps is either 0 or 10000 for this contract; a challenge can flip the verdict, not fractionally split it), a deliberate simplification versus warranty-style split payouts because a safety verdict is a binary fact, not a negotiated percentage.
- **Stuck/abandoned** → `claim_evidence_timeout`, `claim_verdict_timeout`, `claim_challenge_timeout` are all permissionless sweeps so funds can never be locked forever if a counterparty goes silent.
- **Cancellation** → `cancel_investigation`, refund before any evidence is committed.

## Anti-abuse for the Seller Clean Inventory Bond

- A bond can only be linked to an investigation by its own owner, and only
  before a verdict exists (`link_seller_bond` checks `status in (OPEN,
  EVIDENCE_SUBMITTED)`) — a seller cannot retroactively attach a bond after
  seeing an unfavorable outcome, and cannot be forced into a bond they
  didn't choose to link.
- Slashing only fires on `RECALL_CONFIRMED`, never on `POTENTIAL_ISSUE` —
  the bond only carries real financial consequence for a fact the contract
  independently verified as confirmed, not a "maybe."
- Slash amount is capped at `min(bond_deposited_wei, bounty_wei)` — a small
  bounty can never trigger a full-bond wipeout disproportionate to the
  claim.

## Anti-abuse for challenges

- Challenge stake is fixed at 20% of the original bounty (`CHALLENGE_STAKE_BPS`)
  — cheap enough to be accessible, expensive enough to deter spam
  challenges against a correct verdict (an upheld challenge forfeits the
  full stake to the original submitter).
- A challenge triggers a full independent re-run of the leader/validator
  web-fetch verification, not a vote — so a challenge cannot be won by
  social pressure or a better-worded reason string, only by the same class
  of evidence the original verdict was based on.
- `claim_challenge_timeout` defaults an unresolved challenge to **upheld**
  (the standing verdict wins) rather than overturned — an attacker cannot
  benefit from stalling.

## Sybil / collusion considerations

- Reputation (`ReputationScore`) accrues only from settled outcomes, never
  from submission volume — a wallet farming many low-quality submissions
  accumulates `invalid_reports`, which directly lowers its computed
  accuracy_bps shown on the leaderboard.
- Multiple wallets colluding to submit and "confirm" a false claim against
  a seller cannot bypass the independent web-fetch verification — the
  contract's verdict depends on externally observable evidence
  (manufacturer/recall-database pages), not on how many wallets assert a
  claim.

## Application-layer (apps/api, apps/web)

- Auth: challenge-nonce-signature flow, not bare wallet-address trust.
- Uploads: MIME/extension allowlist, size cap, signed Cloudinary upload requests so raw
  file bytes never transit the API process; evidence content hash is
  computed client-side and is what actually goes on-chain (`add_evidence`
  stores `content_hash` + `url`, never the file itself).
- CORS restricted to the deployed frontend origin.
- Rate limiting on auth and upload-url issuance endpoints.
- No stack traces or internal error detail returned to clients; structured
  logs stay server-side only, and secrets (DB credentials, Cloudinary API secret, JWT
  signing secret) are never logged.

## Known limitations / explicitly out of scope for v1

- No formal on-chain governance for changing `CHALLENGE_STAKE_BPS` etc. —
  they are fixed module constants; changing them requires a new contract
  deployment and address migration (see `docs/DEPLOYMENT.md`).
- `admin` can only `set_paused` and `transfer_administration` — it cannot
  redirect a payout, override a verdict, or unilaterally settle an
  investigation. This mirrors the OWWRE precedent that admin powers must
  never be able to touch money once a verdict path is underway.
- **Seller Clean Inventory Bonds now require a real listing-ownership
  proof before they can be linked to an investigation at all.**
  `verify_seller_bond_listing` generates a per-bond `verification_code` at
  bond creation and lets the seller prove they control a specific
  listing's page content — the same trust model as a DNS TXT record or
  domain-verification meta tag: the seller publishes the code somewhere in
  the listing's own visible text, and every GenVM validator independently
  fetches the URL live and checks for it via consensus
  (`gl.vm.run_nondet_unsafe`), not a single centralized check. A verified
  bond's `listing_verified`/`listing_url` fields are surfaced through
  `get_seller_bond` and shown as a "Verified Listing" badge in the seller
  dashboard.
  **What this does and does not prove**: it proves the bond owner controls
  the *content* of that specific listing page at verification time. It
  does **not** prove the underlying marketplace account's real-world
  identity (no KYC, no business registration check) — that would need an
  actual marketplace OAuth integration, which is out of scope here.
  **A real audit finding, now fixed**: an earlier revision let
  `link_seller_bond` attach ANY bond — verified or not, for ANY listing —
  to ANY investigation with no ownership check at all, meaning a "Verified
  Listing" badge only ever proved "this wallet controls *some* page," not
  "this wallet controls the listing actually under investigation."
  `link_seller_bond` now requires BOTH `bond.listing_verified == True` AND
  a canonicalized exact match (`_canonicalize_url` — host + path, scheme/
  query/fragment/trailing-slash-insensitive) between `bond.listing_url`
  and the target investigation's own `marketplace_url`. There is no more
  "voluntary, unverified" linked-bond state — only unlinked bonds can be
  unverified; a *linked* bond is always a real, matching, verified stake.
  The self-hosted `GET /demo-listing/:id` convenience page (`apps/web`,
  for sellers without a live marketplace listing to test against on
  StudioNet) is self-limiting under this rule: a bond verified against the
  demo page can only ever link to an investigation whose own
  `marketplace_url` is *also* that literal demo-page URL — which a real
  recall investigation targeting an actual product listing would not
  naturally have. It is explicitly labeled TESTNET/DEMO-ONLY on the page
  itself and in the seller dashboard UI: verifying against it proves
  control of RecallRaid's own demo route, NOT ownership of any real
  third-party marketplace listing, and it must never be treated as
  equivalent to a genuine verified marketplace listing in a production
  deployment.
  **Resolved**: an earlier round of live testing showed
  `verify_seller_bond_listing` (and, separately, `request_verdict`)
  landing on `MAJORITY_DISAGREE` with a 0% observed success rate across
  every test run, initially suspected to be a StudioNet/GenVM platform-
  level nondet-consensus problem. Root-caused via a minimal, RecallRaid-
  independent diagnostic contract
  (`contracts/diagnostics/nondet_consensus_diagnostic.py`): the real
  cause was that `validator_fn`'s `leader_result` parameter is a wrapped
  `gl.vm.Result` object, not a plain value — it must be unwrapped via
  `isinstance(leader_result, gl.vm.Return)` + `.calldata` per GenLayer's
  own docs, and every access pattern previously used in this contract
  (`.get(...)`, bare subscript, `int(...)`) was wrong for that reason.
  Fixed everywhere via a single `_unwrap_leader_result` helper. Both
  nondet-consensus methods, the full challenge/resolution lifecycle, and
  every seller-bond ownership guard are now confirmed passing on a real
  StudioNet deployment (67/67 live checks, 0 known open bugs — see
  `memory.md` for the full root-cause writeup).
- **A bounty with no linked seller bond is economically a refundable
  assertion stake, not a funded bounty.** `HUNTER_DEFAULT_PAYOUT_BPS` is
  10000 (100%) — on a confirmed verdict the hunter is paid from their own
  posted bounty, i.e. they get their own money back plus reputation. The
  only path to genuine profit beyond a refund is a linked, slashed seller
  bond. A real "funded counterparty" model (marketplace/insurer/protocol
  treasury actually paying hunters) is a product-economics decision for a
  future version, not something this contract manufactures on its own —
  see the fixed accounting note above on why the challenge-overturn bonus
  specifically had to be sourced from the bounty pool rather than minted.
- **Evidence-source trust is allowlist-gated for `recall_source_url` only.**
  `AUTHORITATIVE_RECALL_DOMAINS` restricts that one field to known
  regulator domains (CPSC, NHTSA, FDA, EU Safety Gate, etc.) so it can't be
  pointed at an arbitrary page and described to the verdict prompt as an
  official recall confirmation. `marketplace_url` and `manufacturer_url`
  remain unrestricted by design (they genuinely vary per listing/brand).
  There is no canonical product-ID/UPC/GTIN cross-matching against a
  regulator database, no durable evidence snapshot beyond the stored
  `content_hash` + URL, and no domain-reputation scoring — a
  since-edited or taken-down page changes what a re-verification (e.g.
  `resolve_challenge`) will see, since the contract re-fetches live
  rather than replaying an immutable capture. A partial, deterministic
  floor is in place: `_stable_verdict` refuses to let a `RECALL_CONFIRMED`
  verdict stand (downgrading it to `NEEDS_MORE_EVIDENCE`) for any
  submission with neither a `model_number` nor a `serial_number` at all,
  and the verdict prompt explicitly instructs the model that a recall
  notice for a different model from the same brand is not a match. This
  is a floor against the worst case (zero identifying information), not
  full UPC/GTIN/regulator-recall-ID cross-matching — that remains real
  future work.
- **Verdict agreement requires an EXACT bucket match between leader and
  validator, with no ordinal tolerance of any kind.** This went through
  two rounds of real audit findings before landing here: an initial
  version let any adjacent bucket agree (a leader `RECALL_CONFIRMED`
  could agree with a validator `POTENTIAL_ISSUE` and slash a seller bond
  the validator never confirmed); a narrower fix let only
  `NEEDS_MORE_EVIDENCE` bridge with its neighbor, but that still let a
  leader's determinate, fund-moving verdict (`NO_ISSUE`/`POTENTIAL_ISSUE`)
  get committed merely because a validator said `NEEDS_MORE_EVIDENCE` —
  because `gl.vm.run_nondet_unsafe` always commits whatever `leader_fn()`
  returned; `validator_fn`'s boolean return can never substitute a
  different stored value. There is no tolerance rule achievable at this
  layer that is both safe and "smarter than exact match" — a mismatch
  now simply means the round didn't reach consensus, which triggers
  GenVM's own leader-rotation/retry mechanics rather than committing an
  unconfirmed fund-moving outcome. Covered by
  `test_verdicts_agree_requires_exact_bucket_match`.
- No circuit-breaker for a compromised/malicious source domain being added
  to the allowlist in a future version, no monitoring of
  NEEDS_MORE_EVIDENCE/UNDETERMINED rates over time, and no independent
  third-party security audit has been performed on this contract —
  recommended before deploying with meaningful real-value funds.
