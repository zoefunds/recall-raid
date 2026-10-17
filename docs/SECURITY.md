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
  and is recorded under the individual challenger address. In the current
  source, the API authenticates the challenger and checks the successful Base
  receipt, `fundChallenge` calldata, case id, challenger, exact amount,
  registration, and challenge window before it relays `open_challenge` as the
  GenLayer admin. GenLayer rejects direct wallet calls to that method, removing
  the path for an unrelated wallet to occupy the one challenge slot with a
  fabricated transaction hash. The API is the intended challenge-opening
  path, but the contract cannot constrain its admin to that path: the admin key
  can call the write directly. A compromised admin can therefore bypass API
  checks. Keep it
  server-side, match it to the deployed GenLayer admin, monitor its use, and
  rotate it if exposed. The separate EIP-712 signer still independently
  reconstructs the finalized challenge and checks Base funding before it signs
  settlement.
  GenLayer permits one challenge per investigation. If another wallet makes a
  direct Base challenge deposit, that unmatched deposit cannot occupy the
  GenLayer challenge record and is recoverable by its depositor after terminal
  settlement. A finalized GenLayer challenge with absent or mismatched Base
  funding cannot alter the Base payout verdict or claim a stake: settlement
  falls back to the challenge's snapshotted `prior_verdict`, signs no challenge
  id, and leaves any Base deposit recoverable by its owner after finalization.
  If the Base transaction or receipt is temporarily unavailable, both relay
  and signer fail closed and retry rather than treating uncertainty as an
  invalid challenge.
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
- Only one challenge can be opened for an investigation. Resolution must occur
  before its 48-hour deadline; after that, anyone can expire the challenge and
  the original verdict stands. Both paths retain the closed challenge id.
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
- A private key formerly embedded in `scripts/diagnostic_test.mjs` was exposed
  in repository history. The script now requires `PRIVATE_KEY` from the
  environment, and on 2026-10-17 `main` history was rewritten to redact the
  exact value; the rewritten remote `main` was scanned and contains no matching
  blob. The key must still be treated as compromised: history rewriting does
  not revoke it or erase clones, forks, caches, or copies made before cleanup.
  The derived wallet is `0x551f5b8b2c517bfd780f2e005be2dd2754b7aa85`; checks
  confirmed it is not either configured Fly Base signer and held zero Base
  Sepolia native token or USDC. It held 998.795 GEN on StudioNet at the time of
  the check. Recovery to a fresh wallet is pending because StudioNet RPC
  returned its 500-requests-per-hour limit; a subsequent public-explorer check
  still showed 998.795 GEN and no transfer from that wallet. Do not
  reuse the exposed wallet; the generated receiver key is held locally at
  `/private/tmp/recallraid-rotated-diagnostic-wallet.json` with mode 0600 and is
  not committed. Confirm the transfer receipt and balances after StudioNet
  rate limiting clears. Rotate any service configuration if further checks
  identify use of this key.
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
GenLayer verdict. The deployed `EDFF...` source was subsequently queried and its
schema and protocol windows were inspected. The current checkout now additionally
makes challenge opening admin-only, with API-side Base receipt verification.
That challenge-opening change is **not present in the deployed `EDFF...` source**;
the hardened successor is deployed and the public frontend has since been cut
over to its candidate API. The status notes below are timestamped snapshots, so
earlier production and preview descriptions are historical. Existing Base
registrations must continue to route to `EDFF...` until safely settled or
reconciled, because the escrow permanently binds each case to its registered
GenLayer contract. The synthetic Base branch transactions did not consume the
EDFF deployment's consensus result.

Local API tests (50), direct-mode GenVM tests (2), Foundry tests (9),
compilation, and web builds are useful checks, not substitutes for independent
contract review, key management review, production deployment validation, or a
complete wallet-driven cross-chain exercise. The GenVM direct-mode tests verify
that an unrelated caller is rejected before it can occupy the challenge slot
and that an authorized admin call records the explicit challenger. Direct mode
does not simulate Base receipts or StudioNet consensus; those properties remain
covered separately by API/escrow tests and live deployment evidence.
The hosted source/configuration check and successor rollout findings are captured in
[`e2e-evidence/hardened-challenge-rollout-check.json`](e2e-evidence/hardened-challenge-rollout-check.json).

Historical snapshot at 2026-10-17 12:33Z: the hardened source was deployed to StudioNet at
`0xfAc47CB7eEbF95f3d043A0cd8112ecdb24486ecA` in transaction
`0xfc7aceb0a2d8eea60db169363bdb711b81fac216f0008c4452ac227bc58fa25c`.
The receipt is `FINALIZED` with `MAJORITY_AGREE`; the deployed source hash
matches the checked-in contract, and a read-only protocol-info call reports
604800 seconds for the challenge window and 172800 seconds for challenge
resolution. This deployment has no investigations or seller bonds yet. The
schema query hit the StudioNet 500-requests/hour limit and remains unverified.
Fly and Vercel still point to `EDFF...`, and its funded records were preserved.
The existing 100,000-unit bounty and 20,000-unit challenge stake remain in Base
escrow until the recorded deadline `2026-10-24T10:31:44Z`; settlement and wallet
withdrawals are documented follow-up steps and were not executed early.

Historical snapshot at 2026-10-17 12:44Z: an isolated Fly candidate API and protected Vercel
preview were deployed against the successor. The candidate API has its own
database and JWT secret; migrations and health checks passed. The preview build
used the candidate API URL and successor address, and candidate CORS allows its
exact origin. The preview is ready but was not opened through the user's
authenticated browser session for wallet interaction testing. The production
Fly/Vercel pair remains on `EDFF...`, preserving three indexed unsettled cases.

Historical snapshot at 2026-10-17 14:47Z: the former `0x7401...` account is no longer a
GenLayer administrator on EDFF or the successor, nor the Base escrow owner or
relayer. A fresh wallet `0xE3F1A34307349be94f3657276ebcF51eaB810730` now holds
those roles, and both Fly relayer secrets were rotated to it. The distinct
decision signer remains unchanged. The old account is still the depositor on
funded historical cases, so it remains available only for those claim rights
in a local mode-0600 E2E environment. The candidate API historical challenge
confirmation fix was deployed as `deployment-01M555BTMXRNNNSND406M6W0JK` and
both machines pass health checks. A direct HTTPS `/health` check returned API
and database `ok`; Fly's final public DNS probe timed out. The subsequent
challenge sync retry was rate-limited by StudioNet. The separate exposed 551f
diagnostic key has not been recovered; its transfer to the fresh wallet is
still pending.

Snapshot at 2026-10-17 15:00Z: public Vercel production now serves the hardened
successor and isolated candidate API. Its assets were fetched and checked for
the successor address and candidate API; EDFF is absent. The former production
deployment remains available to project members at its immutable URL, backed
by the original EDFF API and database. Both API services now accept explicit
exact-origin lists; candidate production/preview and legacy preflight checks
returned 204 with credentials enabled. The candidate challenge confirmation
is still waiting on StudioNet's `500 requests/hour` limit.

Snapshot at 2026-10-17 15:14Z: both Fly APIs now run commit `7cb64e0`. API build
passes and 50 API tests pass, including a regression that accepts the exact
successful admin-gated challenge transaction submitted before the admin
rotation while rejecting altered target, challenger, stake, or failed GenVM
execution. `GENLAYER_CHALLENGE_OPEN_ADMIN_GATED=true` is enabled only on the
candidate API for the verified successor; the legacy EDFF API leaves it false
and requires the configured relay sender. Candidate and legacy APIs both
report healthy. Challenge sync remains waiting on StudioNet quota.

Direct Base Sepolia reads at 15:15Z confirmed the rotated owner/relayer, the
separate decision signer, and the still-unsettled successor escrow case with
its exact bounty and challenger deposit. No settlement or withdrawal was sent.

Earlier on 2026-10-17 the hosted Fly API and Vercel frontend were configured to the
`EDFF...` adjudicator and verified Base escrow. The historic web bundle contains
`EDFF...` and no longer contains `a239...`; Fly health reports both API and
database healthy. The E2E record
[`e2e-evidence/studionet-base-valid-challenge-e2e.json`](e2e-evidence/studionet-base-valid-challenge-e2e.json)
now documents an authenticated registration sync, real Base Sepolia USDC
funding, a valid challenger-owned stake receipt, a StudioNet-finalized
`NO_ISSUE` verdict overturned to `POTENTIAL_ISSUE`, and matching verified CPSC
evidence. The hosted API cache independently reports challenge 3 as
`OVERTURNED` and retains `last_challenge_id = 3` with `open_challenge_id = 0`.

The final Base relay and wallet withdrawals are not complete and must remain
deferred until the user-approved seven-day period expires. Do not settle early.
The seven-day post-resolution challenge period expires at `2026-10-24T10:31:44Z`; the escrow
still holds the 100,000-unit bounty and 20,000-unit stake. No settlement write
or withdrawal is claimed before that deadline. An authenticated production
relay attempt returned HTTP 400 `GenLayer adjudication is not terminal` and
sent no Base transaction. Fly's StudioNet RPC quota has
intermittently returned 500 errors during sync; a later authenticated sync
and hosted cache reads succeeded. A separate failed test record,
[`e2e-evidence/studionet-base-clean-challenge-e2e.json`](e2e-evidence/studionet-base-clean-challenge-e2e.json),
documents a placeholder challenge transaction hash and is explicitly not
valid payout evidence.

The deployed `EDFF...` source was retrieved with `genlayer code` on
2026-10-17 at 12:10Z and compared with the checkout. After removing the CLI's
`Result:` wrapper and normalizing the trailing newline, the deployed source
SHA-256 is
`d51ae75dbf23bcdb23c0ae1f83ef4df51933767c0108e631074a40ef766b23e5`. The
that point-in-time comparison found the URL validator difference: checkout
required HTTPS and rejected URL credentials, while deployed `EDFF...` checked
only the authoritative hostname. The current checkout also now makes challenge
opening admin-only and adds an API-verified relay, which is another source
difference and is not live on `EDFF...`. The successor is deployed with source parity. The schema query was still
pending at that historical snapshot, but was later retrieved successfully; see
the 15:24Z source and schema verification below.
Keep each deployment routed through settlement of its registered cases;
on-chain registrations cannot be moved. The historical `A239...` registration
is a valid Base liability, but the active hosted signer path is scoped to its
configured adjudicator and does not currently support an A239-versioned
settlement. Do not send it through the successor/EDFF path.

The Fly PostgreSQL cache was cleared of four stale investigation entries and
their dependent cache data. At cleanup time, the current EDFF investigation
and live challenge remained. A removed old entry corresponds to an unfinalized
100,000-unit Base escrow registration to A239; cache cleanup did not change
the on-chain record. Live A239 state was rechecked on 2026-10-17 at 15:26Z: its
GenLayer investigation 2 is `RECALL_CONFIRMED`, challenge 1 is `UPHELD`, and
the seven-day deadline is `2026-10-24T08:08:09Z`; the Base case remains bound
to A239, funded with 100,000 bounty units and 20,000 challenge units, and is
unfinalized. Its admin is `0x7452084E1Cf767bf19C743051cFf27D9F7A87a4D`, present as
the unlocked local GenLayer account `eventweaver`. The hosted API does not have a version-scoped A239 relay. The repository now
contains `scripts/settle_legacy_a239_case.mjs`; its read-only preflight checked
the exact on-chain registration and challenge receipt, and its early-relay
guard stopped before signing or broadcasting. The actual post-deadline GenLayer
settlement and Base relay remain unexecuted. See
[`e2e-evidence/legacy-cache-cleanup.json`](e2e-evidence/legacy-cache-cleanup.json).

The current source also contains an independent challenge-backing check in
both the relay path and decision signer. The API suite has 50 passing tests,
including explicit decision-signer rejection of modified verdict, hunter,
challenge id/challenger/overturn flag, seller-bond id/slash, and decision hash.
The Foundry suite has 9 passing tests covering registration ownership, exact
Base challenge receipt binding, signature tampering, seller-bond slashing,
orphan recovery, and successful Base-backed challenger stake allocation. The
tested signer comparison is deployed to Fly; its health and live case-3 cache
were verified after rollout. The live `EDFF...` run verifies the real
finalized GenLayer outcome and hosted cache; settlement and wallet withdrawal
remain pending until the recorded deadline.

Previous workstation check at 2026-10-17 15:19Z: API tests pass (50), GenVM
direct-mode tests pass (2), and Foundry tests pass (9). A guarded read/resume
attempt stopped before sending a transaction because DNS resolution failed for
`studio.genlayer.com`, `sepolia.base.org`, and `recallraid-candidate-api.fly.dev`;
an HTTPS probe to a numeric public IP also could not connect. This does not
establish current hosted health or chain state. The earlier 500-requests/hour
StudioNet quota errors are historical observations; refresh exact challenge
confirmation and chain records after network connectivity returns. No duplicate
funding/opening was sent, and no settlement or withdrawal was attempted. The
retry helper retries only the same read-only challenge confirmation and has
been committed as `9337cc7`.

Live successor continuation at 2026-10-17 15:26Z: connectivity recovered. The
authenticated API confirmed challenge 1, and GenLayer transaction
`0x39247ac7480615388c4c1437aaeadefd6a7185072572dd1690fceea69fb0c62c`
finalized with `MAJORITY_AGREE` / `FINISHED_WITH_RETURN`. The finalized state
changed verdict 1 (`NO_ISSUE`) to 2 (`POTENTIAL_ISSUE`), closed
`open_challenge_id`, and retained `last_challenge_id = 1`; the exact API
challenge record is `OVERTURNED`, with challenger `0xA0E30f264f4Db37CdDcFED0C93A6BcDff5C70F8d`, 20,000 USDC base units, and the
matching Base funding receipt. The official CPSC PDF evidence was reachable
and hash-verified by GenLayer. Candidate API reads report the same terminal
investigation and challenge. A Base Sepolia read at block 48241239 confirmed
the case remains registered to the successor and unfinalized, with the exact
100,000-unit bounty and 20,000-unit challenge deposit; both claimable balances
are zero. Its post-resolution seven-day deadline is
`2026-10-24T15:22:12Z`. No Base settlement or wallet withdrawal was attempted.
The positive-verdict bounty follows the documented first-evidence policy and
is expected to go to the first evidence submitter; the overturned challenger
is expected to receive their own stake. The user separately confirmed that the
browser-wallet transaction flow succeeded; the continuation script resumed
from existing on-chain funding and did not capture a new wallet-popup trace.
See [`e2e-evidence/hardened-successor-live-challenge.json`](e2e-evidence/hardened-successor-live-challenge.json).

Deployment/source refresh at 2026-10-17 15:35Z: public production `/submit`
returned HTTP 200; all 16 JavaScript assets contain the hardened successor
and candidate API, with EDFF absent. Candidate API CORS returned HTTP 204 for
the production origin with credentials enabled. Candidate `/health` and its
database returned `ok`. The deployed successor source was retrieved from
StudioNet and is byte-for-byte identical to the checked-in contract after
removing the CLI `Result:` wrapper and trailing newline (SHA-256
`e7ca95221338bd213448be1cd18e0483eccd97312a8ba81a5c3fac94ef4daee0`); its
schema was also retrieved. The A239 read-only preflight now exists at
[`scripts/settle_legacy_a239_case.mjs`](../scripts/settle_legacy_a239_case.mjs)
and verified its exact Base registration and challenge funding receipt. Its
relay guard exited at the recorded deadline before signing or sending any
transaction. The old A239 funds remain unfinalized; its case is not an orphan.
