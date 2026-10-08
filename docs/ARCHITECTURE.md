# Architecture

## Trust boundary

- **Base Sepolia:** USDC approvals, bounties, challenger stakes, seller bonds,
  slashing, claimable balances, and withdrawals.
- **GenLayer StudioNet:** case metadata, evidence anchoring and live fetching,
  content-hash verification, verdict consensus, and challenge re-adjudication.
- **Fly API:** PostgreSQL read cache, upload signing, wallet authentication, and
  the one-way final-decision relay.
- **Next.js frontend:** wallet-signed Base funding/claim calls and wallet-signed
  GenLayer adjudication calls.

No monetary value is held or paid on GenLayer.

`caseId` is a random `bytes32` that binds a Base escrow record to a GenLayer
investigation. Funding occurs first. When adjudication is final, the API hashes
the adjudicator address, investigation id, case id, verdict, confidence,
hunter, and challenge result, then relays that outcome once. The background
watcher performs that relay automatically for every settled, invalid, or
cancelled investigation whose cache record has no relay hash. The Base escrow
remains the idempotency boundary: a case cannot be finalized twice.

Every browser-side GenLayer write re-checks that the active wallet network is
StudioNet (`61999`) immediately before requesting the signature. Every Base
funding flow separately re-checks Base Sepolia, the configured escrow's USDC
token, account ownership, USDC balance, and gas balance before the approval
and funding transactions are submitted.

The watcher uses a PostgreSQL advisory lock held for the entire sweep. This
prevents two Fly machines (or an overlapping local interval) from racing the
same chain reads, cache syncs, notifications, or automatic relay.

Payments use a pull pattern. Settlement increments `claimable[address]`; each
recipient calls `claim()`. A confirmed recall can slash a linked seller bond by
`min(bond balance, bounty)`.

Historical database columns retain `*_wei` names to avoid destructive schema
migration, but their values now always mean six-decimal USDC base units.
