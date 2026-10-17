# Security model

This document describes the repository's current testnet implementation. The
testnet protections are useful defense-in-depth but do not establish a
production security review or trustless cross-chain settlement.

## Assets and authority

- **Base Sepolia USDC:** funded bounties, challenger stakes, seller bond
  balances, claimable credits.
- **GenLayer state:** investigation, evidence metadata and verification,
  verdict, challenge, and reputation records.
- **API credentials:** database access, upload-signing credentials, JWT
  signing secret, Base relayer key, and Base decision-signer key.
- **Evidence files:** off-chain bytes served from Cloudinary or public URLs.

The Base escrow owner can rotate the relayer and decision signer. The relayer
submits transactions; a separate EIP-712 decision signer must authorize the
exact registration, settlement, cancellation, or recovery instruction. This
split limits a relayer-only compromise, but the decision signer remains a
privileged authority over settlement. Base verifies the signature and stored
case data; it does not independently verify GenLayer consensus. This is an
attested relay design, not a trustless bridge.

## Base escrow controls

- The USDC token is immutable at deployment. Funding uses `transferFrom`
  after the wallet approves the escrow.
- A nonzero `bytes32` case id can be funded once. Its payer and exact amount
  are retained on Base.
- Registration authorization binds the case id, payer, bounty, GenLayer
  contract, and investigation id. The escrow records that reference once.
- Settlement authorization binds the registered GenLayer reference, verdict,
  recipient, challenge id and wallet, overturn result, and decision hash. A
  case can finalize only once; the stored registration must match.
- A challenge requires exactly 20% of the bounty (minimum one token base unit)
  and is recorded under the individual challenger address. API validation
  checks the successful Base receipt, `fundChallenge` calldata, case id,
  challenger, and amount against GenLayer state before signing settlement.
- Seller-bond slashing is capped by remaining bond and bounty. Linked bonds
  cannot be withdrawn while their cases remain open.
- Claims use checks-effects-interactions and a reentrancy guard. USDC claims
  are pull payments from per-address balances.
- Orphan recovery requires the original payer, an unregistered and
  unfinalized case, seven elapsed days, and a decision-signer authorization.
  The API checks GenLayer for the matching payer/case registration before
  issuing it. A matching live investigation blocks recovery. Foundry tests
  cover the time-dependent path; live validation did not wait seven days.
- Unmatched challenge deposits can be recovered by their depositor after case
  finalization, or after seven days if the case was never registered.

## GenLayer controls

- GenLayer stores no USDC and has no user-value transfer path.
- The same wallet cannot register the same Base case id more than once.
- Settlement uses the retained last challenge id after resolution or expiry.
- Verdict agreement requires the same verdict bucket; confidence has a
  separate 15 percentage-point tolerance.
- Validators fetch evidence URLs and compare SHA-256 of fetched raw bytes to
  the committed hash. URL reachability and byte-hash comparison are recorded
  as verification results. Text excerpts are best-effort and are not the
  byte-integrity proof.
- A supplied official-recall source must match the explicit regulator-domain
  allowlist in the contract. This is a hostname check and does not prove that
  a page's content is accurate or remains available.
- Challenge resolution re-fetches and re-adjudicates evidence. The code's
  current StudioNet windows are 72 hours for evidence, 48 hours to request or
  resolve the initial verdict after that window, seven days to challenge, and
  48 hours to resolve a challenge.

## API, browser, and operations

- Wallet sessions begin with a one-time nonce, verified EVM signature, and
  HTTP-only session cookie. Sensitive API routes require an authenticated
  session; authorization remains separate from chain-state validation.
- Chain reads and writes are not trusted to PostgreSQL cache contents. The API
  re-reads GenLayer and Base records before registration, settlement, and
  recovery authorization.
- Cloudinary upload signatures are issued server-side. The browser uploads
  file bytes directly; Cloudinary credentials and JWT/private keys must never
  be placed in `NEXT_PUBLIC_*` variables or committed to Git.
- Production startup fails when `JWT_SIGNING_SECRET` is absent. Use a unique,
  high-entropy secret and separate testnet relayer and decision-signer keys.
- `.env`, `apps/api/.env`, and `apps/web/.env.local` are local-only. Use the
  ignored files as appropriate; deploy secrets via the hosting provider's
  secret store. If a key was exposed, rotate it on-chain where applicable and
  replace the secret before further use.
- PostgreSQL is a derived cache, not a ledger. The API watcher serializes its
  sweep with a database advisory lock and retries terminal relays. Base
  idempotency makes duplicate relay attempts safe.

## Validation evidence and limitations

The live validation record is
[`e2e-evidence/live-base-security-branches.json`](e2e-evidence/live-base-security-branches.json).
It documents Base Sepolia funding, registration, EIP-712 settlement, and USDC
claims for refund, recall/bond-slash, and overturned-challenge branches. The
attestations used test inputs, including a synthetic GenLayer reference; they
validate Base accounting and signature binding, not the authenticity of a
GenLayer verdict. The revised GenLayer contract was separately deployed to
StudioNet and its accepted deployment/schema were verified, but those Base
branch transactions did not consume that deployment's consensus result.

Local API tests, Foundry tests, compilation, and web builds are useful checks,
not substitutes for independent contract review, key management review,
production deployment validation, or a complete wallet-driven cross-chain
exercise.
