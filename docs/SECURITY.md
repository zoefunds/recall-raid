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
