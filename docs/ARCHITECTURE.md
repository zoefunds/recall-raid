# Architecture and data flow

## Components

| Component | Responsibility | Source of truth |
|---|---|---|
| Next.js app (`apps/web`) | Wallet-connected UI, Base funding and claims, GenLayer writes, evidence upload orchestration | The chains for financial and adjudication state |
| GenLayer StudioNet contract | Investigation metadata, evidence references and verification, verdict consensus, challenges, timeouts, reputation | GenLayer state |
| Base Sepolia escrow | USDC deposits, challenge deposits, seller bonds, settlement accounting, claimable balances | Base state and USDC token contract |
| Fastify API (`apps/api`) | Wallet nonce auth, upload signatures, cache sync, Base/GenLayer validation and attestation, watcher, reads | Derived cache; it must re-read chains for sensitive operations |
| PostgreSQL | Searchable cache, transaction status, notifications, upload metadata | Not authoritative; rebuildable from chains where event/state readers permit |
| Cloudinary | Uploaded evidence file bytes | Off-chain object storage; GenLayer stores its URL and committed SHA-256 |

The API's background watcher uses a PostgreSQL advisory lock for one sweep at
a time across API machines. It polls pending transaction receipts, refreshes
active chain records, sends deadline notifications, and retries terminal Base
relays. Relays are idempotent at the Base escrow: a case can be finalized once.

## Case creation and cross-chain registration

The browser creates a random 32-byte case id and asks the submitter to approve
and fund a Base escrow deposit. It then submits the same id, submitter, and
six-decimal USDC amount (represented as integer token base units) to GenLayer.
After the GenLayer transaction is visible, the API sync route reads both
contracts and checks:

- Base payer equals GenLayer submitter;
- Base bounty equals GenLayer's declared bounty;
- Base case is not finalized and has not been registered already;
- the GenLayer contract address and investigation id match the intended
  registration.

The decision signer attests to this registration, and the relayer submits it
to Base. The escrow stores the bound GenLayer contract and investigation id.
An orphan deposit can be recovered by its original payer after seven days only
when the API confirms the matching GenLayer payer/case registration is absent
and signs the exact recovery instruction. A registration failure does not
allow recovery while a matching GenLayer investigation exists.

## Evidence and adjudication

The API creates a short-lived, signed Cloudinary upload request; the browser
uploads bytes directly, then submits the resulting URL and client-computed
SHA-256 digest to GenLayer. Each investigation supports up to 25 evidence items.
The contract's validator pass fetches the URL and compares SHA-256 of fetched
raw bytes to the committed digest. Reachability and hash-match are on-chain
verification results; a text excerpt is best-effort context. A present
`recall_source_url` must use an explicitly allowed regulator domain. The
marketplace and manufacturer URLs are user-provided sources and are not
classified as official regulator sources.

Current StudioNet timing constants in `contracts/recallraid_contract.py`:

| Window | Duration |
|---|---:|
| Initial evidence | 72 hours |
| Verdict request/resolution | 48 hours after the evidence window |
| Challenge window after a verdict | 7 days |
| Open challenge resolution | 48 hours |

These are testnet contract parameters, not a promise about a future production
deployment. Verdict buckets are `NO_ISSUE`, `POTENTIAL_ISSUE`,
`RECALL_CONFIRMED`, and `NEEDS_MORE_EVIDENCE`; settlement waits for a terminal
state, so `NEEDS_MORE_EVIDENCE` returns the investigation to evidence collection
rather than releasing funds.

## Challenge and settlement

The Base challenge stake is exactly 20% of the bounty (minimum one USDC base
unit for very small bounties). Challenge deposits are stored per case and
challenger wallet so multiple deposits cannot be confused or consumed as one
shared balance. Each investigation can open one GenLayer challenge. GenLayer
retains that challenge id and final outcome for settlement. The API
validates the originating Base `fundChallenge` receipt, case, challenger, and
exact amount before authorizing settlement. Both the relay and independent
decision signer apply the same rule: a verified Base-funded challenge may
affect the final payout and stake recipient; a confirmed mismatch is treated
as unbacked, so the Base payout uses the challenge's snapshotted prior verdict
and does not consume a challenge stake. Any unmatched Base deposit remains
recoverable by its depositor after the case finalizes. Missing RPC transaction
or receipt data is treated as uncertainty and stops settlement for retry.

At terminal settlement, `NO_ISSUE` refunds the bounty to the submitter;
`POTENTIAL_ISSUE` and `RECALL_CONFIRMED` pay the hunter. The hunter is the first
evidence submitter in GenLayer's evidence order. This is a declared first
submitter policy, not an attribution score. A linked seller bond may be slashed
on a confirmed recall, capped by both remaining bond and bounty. An overturned
challenge returns its own stake to its challenger; otherwise the stake follows
the adjudication allocation. The Base contract increments pull-payment
balances, and recipients withdraw separately with `claim()`.

## Authorization boundary

The Base relayer can submit registrations and settlements, but the contract
also requires a separate EIP-712 decision-signer signature over the exact
registration, adjudication, cancellation, or orphan-recovery fields. The API
signs only after querying GenLayer and validating the matching Base records.
This reduces what a compromised relayer alone can do, but the signer remains a
trusted financial authority. Base does not independently verify GenLayer
consensus; the system has no on-chain light client or consensus-proof bridge.

## API and cache

Wallet authentication uses a one-time nonce signed by an EVM wallet and an
HTTP-only session cookie. PostgreSQL stores serialized investigation, evidence,
challenge, bond, reputation, transaction, notification, and pending-upload
records. Public reads use this cache for pagination; post-transaction sync
routes refresh individual chain records. A stale cache can delay display but
must not authorize settlement, registration, or orphan recovery.

Historical database columns ending in `_wei` retain their name for migration
compatibility. For USDC they contain six-decimal token base units, not wei.
