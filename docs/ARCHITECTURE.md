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
hunter, and challenge result, then relays that outcome once.

Payments use a pull pattern. Settlement increments `claimable[address]`; each
recipient calls `claim()`. A confirmed recall can slash a linked seller bond by
`min(bond balance, bounty)`.

Historical database columns retain `*_wei` names to avoid destructive schema
migration, but their values now always mean six-decimal USDC base units.
