# Security model

This document describes the current RecallRaid testnet implementation as of
October 18, 2026. These controls are defense in depth; they do not constitute a
production audit or a trustless cross-chain bridge.

## Assets and sources of truth

- GenLayer StudioNet is authoritative for investigation metadata, evidence,
  verdicts, challenges, timeouts, and reputation.
- Base Sepolia escrow and the USDC token are authoritative for bounties,
  challenge deposits, seller bonds, claimable balances, and withdrawals.
- PostgreSQL is a derived cache. It can delay display but cannot authorize a
  financial operation.
- Evidence bytes are stored off-chain. GenLayer stores their URLs and committed
  SHA-256 hashes and records validator verification results.

## Current deployed security boundary

New public cases use:

- GenLayer: `0xfAc47CB7eEbF95f3d043A0cd8112ecdb24486ecA`;
- Base escrow: `0xBf74703d38cc83DE796B174efFdC02FaD69dE0dB`;
- relayer/owner: `0xE3F1A34307349be94f3657276ebcF51eaB810730`;
- decision signer: `0x6C76E71a9AeEBE3A79D1b078122D2c42dC69Cd4C`.

The relayer and decision signer are separate keys. The relayer submits Base
registrations and settlements, but the escrow requires an EIP-712 signature by
the decision signer over every exact financial instruction. A compromised
relayer alone cannot change an authorized verdict, recipient, challenge,
seller-bond slash, cancellation, or recovery.

The decision signer remains a trusted attestation authority. It reconstructs
the instruction from live GenLayer and Base state, but Base does not verify a
GenLayer consensus proof or light-client commitment. Compromise or collusion of
the decision signer can authorize incorrect financial state. This trusted
attestation boundary must remain disclosed until replaced by a cryptographic
cross-chain verification mechanism.

## Registration controls

The browser funds a random nonzero Base case id and submits the same case id,
wallet, and six-decimal bounty amount to GenLayer. Before signing registration,
the backend re-reads both chains and requires:

- Base depositor equals GenLayer submitter;
- Base bounty equals the GenLayer bounty;
- case id, GenLayer contract, and investigation id match;
- Base case is neither finalized nor previously registered;
- Base and GenLayer report the same challenge bonus policy.

The registration signature binds all of those fields. The escrow stores the
GenLayer contract and investigation id once. Existing registrations cannot be
rebound to a newer contract.

## Challenge controls

A challenge requires exactly 20% of the bounty, with a minimum of one token
base unit. Deposits are keyed by case and challenger so unrelated deposits
cannot be consumed as the selected challenge stake.

The backend authenticates the challenger wallet and verifies the successful
Base receipt, transaction target, `fundChallenge` calldata, case id, wallet,
amount, stored deposit, registration, deadline, and empty challenge slot. Only
then may the configured GenLayer administrator relay `open_challenge` with the
explicit challenger. The hardened GenLayer contract rejects direct calls by
ordinary wallets. A live unauthorized direct call finalized with a GenVM error
and did not change challenge state.

The administrator remains privileged and can call the GenLayer method outside
the API if compromised. The independent Base decision signer therefore repeats
the Base-funding and finalized-challenge checks before settlement. A challenge
with a confirmed missing or mismatched Base deposit cannot change the Base
payout or consume a stake. Unavailable receipt data is treated as uncertainty
and stops settlement.

GenLayer retains `last_challenge_id` after clearing `open_challenge_id`, so the
backend can retrieve the actual finalized challenge. One challenge is allowed
per investigation. Unmatched Base deposits remain recoverable by their owners
after finalization, or after seven days if the case was never registered.

## Settlement and accounting

The EIP-712 adjudication binds:

- Base case id and registered GenLayer contract/investigation;
- verdict and ordinary bounty recipient;
- challenge id, challenger, and overturn flag;
- seller-bond id and slash amount;
- decision hash.

The escrow verifies the signature, stored registration, exact challenge
deposit, allowed verdict fields, and one-time finalization before crediting
pull-payment balances. Claims use checks-effects-interactions and a reentrancy
guard.

For a successful challenge on the current escrow:

- the challenger receives the original stake;
- the challenger receives 15% of the funded bounty, rounded down;
- the ordinary bounty recipient receives the exact remainder;
- bounty shares equal the funded bounty;
- stake shares equal funded stakes;
- seller-bond funds remain separate.

The exact 0.100 USDC bounty and 0.020 USDC stake test credits 0.035 USDC to the
challenger and 0.085 USDC to the ordinary bounty recipient. It verifies 0.120
USDC backing before claims and zero escrow residue after both withdrawals. The
current Foundry suite has 11 passing tests, including rounding, conservation,
authorization tampering, duplicate registration, wrong stakes, seller-bond
slashing, cancellation, and orphan recovery.

The deployed escrow was independently compared to the checked-in build at Base
Sepolia block 48,257,048. The compiler-reported immutable slots were masked and
the remaining runtime matched byte for byte. Live reads confirmed the 1,500-bps
bonus and the expected roles. See
[`e2e-evidence/base-escrow-source-equivalence-2026-10-18.json`](e2e-evidence/base-escrow-source-equivalence-2026-10-18.json).

## Historical escrow obligations

Three funded cases remain on the immutable pre-bonus escrow
`0x861d5D4E903805cbE283A86f08E10D031601774E`. They must settle through their
original registered GenLayer contracts after their October 24, 2026 deadlines.
They must not be migrated by rewriting registration state.

For the two successful legacy overturns, the legacy escrow returns the stake
but does not carve the promised 15% bonus from the bounty. The guarded runner
therefore completes the original settlement and claims, then transfers exactly
15% of the funded bounty from the ordinary bounty recipient to the challenger.
For a 0.100/0.020 USDC case, final wallet increases must be 0.085 and 0.035 USDC.
The evidence must show the EIP-712 payload, Base relay, both claims, correction
transfer, before/after balances, and conservation.

The A239 investigation is a separate historical liability with an upheld
challenge and a version-specific runner. It must be settled through
`0xa239189c2921b592dBa1eccde830977edbfD1CB5`, not through EDFF or the hardened
successor. See [Deployment](DEPLOYMENT.md) for exact deadlines and commands.

## Evidence and URL controls

Evidence upload authorization is wallet authenticated and state checked.
Challenge rebuttal preparation is restricted to the recorded challenger during
an open challenge. Official-recall URLs must use HTTPS and an explicit
regulator hostname, reject embedded credentials, follow bounded redirects, and
respect a 10 MB response limit. GenLayer validators fetch the bytes and compare
their SHA-256 hash to the committed value. Reachability and hash agreement are
recorded; extracted text is best-effort context rather than the integrity
proof.

A hostname allowlist and content hash do not prove that a regulator statement
is correct, complete, or permanently available. Validator retrieval remains
dependent on external network access and source availability.

## Authentication, secrets, and operations

Wallet sessions use one-time nonces, EVM signatures, and HTTP-only cookies.
Sensitive routes require authentication in addition to live chain checks.
Production startup fails without a JWT signing secret. Private keys, database
credentials, JWT secrets, and upload credentials belong only in provider secret
stores or ignored mode-restricted local files. They must never appear in Git or
`NEXT_PUBLIC_*` variables.

The API watcher uses a PostgreSQL advisory lock so only one machine performs a
sweep at a time. Base settlement is idempotent: a case can finalize once.
Transient chain-read uncertainty must stop signing or relaying rather than
being interpreted as a negative result.

## Compromised diagnostic wallet remediation

A private key previously embedded in `scripts/diagnostic_test.mjs` is treated
as permanently compromised. The script now requires an environment variable,
the value was removed from reachable and unreachable repository objects, and
temporary recovery scripts were deleted.

The affected address is
`0x551f5b8b2c517bfd780f2e005be2dd2754b7aa85`. Its remaining
998.795000000000001 GEN was transferred to the rotated role wallet in finalized
transaction
`0x3159771506004c57508b7da5bf6f35915edea75e7311bd12eb54d47838abf275`.
The source balance is zero. It is not an administrator on A239, EDFF, or the
hardened successor and is not a Base owner, relayer, or decision signer. It
must never be restored to an operational role. See
[`e2e-evidence/diagnostic-wallet-recovery.json`](e2e-evidence/diagnostic-wallet-recovery.json).

## Validation status and limitations

Current local validation:

- 50 API tests pass;
- 2 direct-mode GenLayer authorization tests pass;
- 11 Foundry escrow tests pass;
- API and frontend production builds pass;
- the public API/database are healthy;
- public frontend assets contain the hardened GenLayer contract, bonus-aware
  escrow, and candidate API;
- public investigations 1, 2, and 3 render through the live application.

The live successor challenge demonstrated Base-funded challenge authentication,
official CPSC evidence retrieval, SHA-256 verification, validator-backed
overturn, persistent historical challenge identity, and API synchronization.
The remaining three historical settlements are intentionally outstanding until
their contractual deadlines. Until their finalized Base receipts, withdrawals,
corrections, and balance increases are published, those liabilities remain
open.

Testnet validation does not replace independent contract review, key-management
review, production infrastructure hardening, or trustless cross-chain proof.

## Evidence index

- Current deployed-code and accounting proof:
  [`base-escrow-source-equivalence-2026-10-18.json`](e2e-evidence/base-escrow-source-equivalence-2026-10-18.json)
- Current rollout and browser workflow:
  [`bonus-aware-rollout-2026-10-18.json`](e2e-evidence/bonus-aware-rollout-2026-10-18.json)
- Hardened challenge execution:
  [`hardened-successor-live-challenge.json`](e2e-evidence/hardened-successor-live-challenge.json)
- A239 state and guarded preflight:
  [`legacy-cache-cleanup.json`](e2e-evidence/legacy-cache-cleanup.json)
- Diagnostic-wallet remediation:
  [`diagnostic-wallet-recovery.json`](e2e-evidence/diagnostic-wallet-recovery.json)
- Historical synthetic Base branches and limitations:
  [`live-base-security-branches.json`](e2e-evidence/live-base-security-branches.json)
