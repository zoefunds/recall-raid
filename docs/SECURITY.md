# Security

## Base Sepolia escrow

- The USDC token is immutable.
- Funding uses `transferFrom` after explicit user approval.
- A case can be funded once and finalized once.
- Only the configured relayer can submit a decision.
- Claims use checks-effects-interactions and a reentrancy guard.
- Seller-bond slashes cannot exceed the bond balance or bounty.
- Linked bonds cannot be withdrawn before their cases finalize.
- Cancellation/timeout release refunds the bounty and challenge stake.

## GenLayer adjudication

- GenLayer holds no bounty, stake, bond, or payout value.
- Validators fetch evidence and compare fetched-byte SHA-256 values with
  committed hashes.
- Official-recall URLs use an explicit regulator allowlist.
- Validators agree on the exact verdict bucket.
- Challenges re-fetch and re-adjudicate evidence.

The relayer key belongs only in Fly secrets. Browser code receives public
addresses only. The deployer key is testnet-only and must never be reused on a
production network. PostgreSQL is a cache; both chains remain authoritative.
