# Deployment and configuration

This repository documents the RecallRaid testnet deployment on StudioNet and
Base Sepolia. The contracts are test deployments, not production contracts.
The Base escrow deployment is verified below. The public Vercel production
alias now serves the hardened successor and candidate API. The former
production deployment remains available to project members at its immutable
URL with the EDFF adjudicator and original Fly API, preserving historical case
access.
The repository adds a stricter HTTPS check for official regulator URLs and
admin-relayed, Base-receipt-verified challenge opening. The public frontend now
uses the hardened successor for new investigations; existing Base registrations
remain bound to their original adjudicator and must not be reassigned. The
current seven-day settlement is intentionally documented as pending, not
executed early.
The deployed `EDFF...` source was retrieved with `genlayer code` on
2026-10-17. Its normalized source hash is
`d51ae75dbf23bcdb23c0ae1f83ef4df51933767c0108e631074a40ef766b23e5`; known
differences from the hardened successor include that the deployed URL
validator does not require HTTPS or reject URL credentials, and it accepts
direct wallet `open_challenge` calls with a caller-declared challenger. The
checked-out source closes the latter path by requiring the admin relay; the API
verifies Base funding first. The successful live challenge used a version-pinned
HTTPS CPSC PDF and followed the older deployed challenge-opening path.

## Networks and recorded deployments

Base Sepolia chain id is `84532`; the commonly used Base Sepolia USDC test
token is `0x036CbD53842c5426634e7929541eC2318f3dCF7e`. The GenLayer chain used
here is StudioNet (`61999`), served through `https://studio.genlayer.com/api`.

| Purpose | Network | Contract | Transaction / status |
|---|---|---|---|
| Prior milestone escrow (historical) | Base Sepolia | `0x5D6426aA81583Fd795385952CB6d82A1Ed5a15F4` | `0xb60871d4e652d66cef7a3e66431a8ff1819ce24d662603369d3467681d731aa4` |
| Prior milestone adjudicator (historical) | StudioNet | `0xa4e1D02aBaed368461870D1453d709d51183A119` | `0x0a9929c10a80cf39d590ff108a09da6d7bf0ec7cb6e9cda5f9c0341971f50e51` |
| Remediation validation escrow (test only) | Base Sepolia | `0xea0973CbFf42F1B41A339103f133d3D43a24A54b` | `0xe8e2814512e4e49ec623551ee42358c797b467c531b30f21dfcb1b2bc975ec67` |
| Corrected escrow | Base Sepolia | `0x861d5D4E903805cbE283A86f08E10D031601774E` | `0xf50fe9f4af945ab79208eaf3895347ea1d0b85b7fb4f641bfa0be7f499d460c7`; source verified 2026-10-17 |
| Earlier corrected adjudicator | StudioNet | `0xa239189c2921b592dBa1eccde830977edbfD1CB5` | `0x2bb98b6e3897235a7ae96790b565e5fa38c269e493a209a2595485e42474ecb0`; accepted; superseded by next row |
| Latest source with challenge rebuttal controls | StudioNet | `0xEDFFB4B4999D65A248441438233c18717515973d` | `0xe457b81502a2a9f66ab4f620f7d0ad738e27cac3f07ff23696ff61fef52ab350`; accepted; `get_protocol_info` reports 604800s challenge / 172800s resolution |
| Hardened challenge-opening successor | StudioNet | `0xfAc47CB7eEbF95f3d043A0cd8112ecdb24486ecA` | `0xfc7aceb0a2d8eea60db169363bdb711b81fac216f0008c4452ac227bc58fa25c`; finalized `MAJORITY_AGREE`; retrieved source matches checked-in SHA-256 `e7ca95221338bd213448be1cd18e0483eccd97312a8ba81a5c3fac94ef4daee0`; protocol info reports 604800s challenge / 172800s resolution |

### Current signer and administrator state

On 2026-10-17 the former `0x7401...` operational account was removed from
privileged roles. A fresh wallet `0xE3F1A34307349be94f3657276ebcF51eaB810730`
is now the GenLayer administrator on both EDFF and the successor, and the Base
escrow owner and relayer. Base relayer rotation finalized in transaction
`0x12f0cd955db5b6316fd326c8bbc804668cea483cb7ed912968a6b2dd92779723`, and
escrow ownership transfer finalized in
`0xcfdbfe2fef0d20b89500530a9bf307249c3bff5ed84e556e034e164d0ff79d4b`.
StudioNet administrator transfers finalized on EDFF in
`0x73a4016de5babdfa0e5a645bcdd1b9e77cd36524fd6a6f05fa7eb1bd7e4d71dc` and on
the successor in
`0x6480a440d1184e4c10357fa85149c6fb3296086066681959cfa9527fdde2a54a`.
The distinct Base decision signer remains `0x6C76...`. Fly production and
candidate relayer secrets were rotated to the fresh operational key; the old
account remains the depositor for historical cases and is retained only in a
local mode-0600 E2E environment as the case claimant. The 551f diagnostic
wallet is a different key and its 998.795 GEN recovery remains unresolved.

The successor had zero investigations and seller bonds at source verification;
the current live challenge exercise is investigation 1. It is now the production
frontend default; existing Base registrations remain owned by their original
EDFF or A239 deployment. A read-only `get_protocol_info` call verified the
successor admin, unpaused
state, and protocol windows. The schema query was rate-limited by StudioNet at
the 500-requests/hour ceiling and remains a documented verification item; do
not spend further StudioNet requests on retries while that limit is exhausted.

At the initial isolated-preview rollout, Fly app
`recallraid-candidate-api` runs the candidate API image with the successor
address, a candidate-only database, and a separate JWT secret; all repository
migrations were applied, and its health endpoint returned API/database `ok`.
Vercel preview deployment `dpl_FRHqacHsYQbwYaLJwzRuSYRvPcJ6` is READY at
`https://recall-raid-2k364g3a6-adebiyi2002gmailcoms-projects.vercel.app`, built
with the candidate API URL and successor contract address. Its preview access
protection remains enabled (anonymous requests redirect to Vercel SSO). The
candidate API CORS allowlist is set to this exact preview origin. See
[`e2e-evidence/hardened-challenge-rollout-check.json`](e2e-evidence/hardened-challenge-rollout-check.json).

### Public frontend cutover

On 2026-10-17 production Vercel deployment
`dpl_DQtVdvHcoMXoZujc27p3Ye9NB3ye` was promoted to the public alias
`https://recall-raid.vercel.app`. The production build was created from
`apps/web` with candidate API `https://recallraid-candidate-api.fly.dev` and
successor `0xfAc47CB7eEbF95f3d043A0cd8112ecdb24486ecA`; its `/submit` page and
compiled assets were fetched and inspected. The successor/API strings are
present and EDFF is absent. Persistent Vercel Production variables now match
that build. Candidate API CORS allows both this production origin and the
successor preview, verified by credentialed preflight responses.

The former production build is preserved at
`https://recall-raid-ou77oyqjz-adebiyi2002gmailcoms-projects.vercel.app` and
uses the original EDFF API and database. Vercel CLI authenticated access to
both the legacy page and the new production page returned HTTP 200. The legacy
immutable URL is project-member protected; its origin was added to the EDFF
API's explicit CORS allowlist. No existing Base registration was rewritten.
The candidate Fly API is image
`deployment-01M556DD7858ADZ91NADTMMP17`; the EDFF Fly API is
`deployment-01M556G07KBTF9Q9CS9XWPETHC`. Both service health endpoints report
API and database `ok`. Read-only investigation endpoints return successor case
1 as status 4 with `open_challenge_id = 1`, and EDFF case 3 as status 3 with
`last_challenge_id = 3`; both remain unsettled.

Both Fly APIs now run commit `77a7df1`, including the explicit confirmation
validator and regression test for a finalized challenge transaction submitted
by the previous admin before role rotation. The API build passes and the suite
has 50 passing tests. Candidate `/open-status` still awaits StudioNet RPC quota
recovery; no new Base or GenLayer transaction is needed to resume it.

### Hardened successor live challenge

The successor-pair CLI exercise is being resumed from its exact on-chain state. Base case
`0xd370cf1ea5d45edace9ba669f396d6ab139dc4566a9933b8f5e738b0f8953987` was
funded with 100,000 USDC base units by its submitter, finalized as GenLayer
investigation 1 at the successor, and authenticated registration was confirmed
on Base and in the candidate API. Control evidence id 1 was added and verified
through successful finalized GenVM writes (`0xde9959…77def4` and
`0xf54a75…04c5e8`). The initial `NO_ISSUE` verdict was finalized at transaction
`0xebcf8ce730fac66e3ec309ea9caac326c50046124a90a963196c468cf37a46ca` with
7,800 confidence basis points. The challenger funded 20,000 USDC base units in
Base transaction `0xa4689db52e8b97353e70f72eff30f96845a9c91cab1cfd5a3221bd9299dc68d0`.
The GenLayer challenge opening finalized in transaction
`0x916f5c93bab7da2d35cf2acd7d3b953c49c7f47353d63a92f717051f6cd8352a`;
the candidate API returned HTTP 202 but its confirmation endpoint failed
because it compared the transaction sender against the newly rotated current
admin. The source now validates finalized execution, exact call arguments, and
the funded on-chain challenge record without requiring the current admin to
equal the historical sender. This is safe because `open_challenge` itself is
admin-gated at execution. The corrected candidate API image
`deployment-01M555BTMXRNNNSND406M6W0JK` is deployed; both Fly machines are
healthy and `/health` reports API and database `ok`. The deploy's final DNS
probe timed out at 8.8.8.8, but Fly had completed both machine health checks
and direct HTTPS health returned `ok`. A single confirmation retry reached
StudioNet but was rejected by its `500 requests per hour` rate limit, so the
challenge is not yet confirmed in the candidate cache. Resume
this case using the checkpoint in
[`e2e-evidence/hardened-successor-live-challenge.json`](e2e-evidence/hardened-successor-live-challenge.json)
after StudioNet read access returns. Do not repeat funding, registration,
evidence, or challenge opening. The successor case remains unsettled while its
challenge proceeds. A read-only Base Sepolia recheck at 14:30Z confirmed the
successor case has the exact 100,000-unit bounty and 20,000-unit challenger
deposit. The EDFF case 3 still holds its 100,000-unit bounty and
20,000-unit funded challenge stake; the A239 case 2 still holds its separate
100,000-unit bounty and 20,000-unit stake. All three are bound to their
original GenLayer addresses, remain unsettled, and have zero claimable USDC.
These on-chain snapshots are recorded in the evidence file. Settlement and
withdrawals are not claimed and remain deferred to the recorded seven-day
deadline.

The runner now has an explicit `RECALLRAID_HARDENED_SUCCESSOR_RESUME=1` mode.
It refuses to start unless the successor address, case id, finalized submit
transaction, Base funding transaction, investigation id `1`, report path, and
checkpoint all match the recorded case. It carries earlier checkpoint data
forward when a later read is rate-limited. Resume from the repository root
after RPC access returns with:

```sh
RECALLRAID_HARDENED_SUCCESSOR_RESUME=1 \
GENLAYER_CONTRACT_ADDRESS=0xfAc47CB7eEbF95f3d043A0cd8112ecdb24486ecA \
RECALLRAID_API_BASE_URL=https://recallraid-candidate-api.fly.dev \
RECALLRAID_E2E_ORIGIN=https://recall-raid-2k364g3a6-adebiyi2002gmailcoms-projects.vercel.app \
RECALLRAID_E2E_REPORT=docs/e2e-evidence/hardened-successor-live-challenge.json \
RECALLRAID_E2E_CASE_ID=0xd370cf1ea5d45edace9ba669f396d6ab139dc4566a9933b8f5e738b0f8953987 \
RECALLRAID_E2E_INVESTIGATION_ID=1 \
RECALLRAID_E2E_SUBMIT_TX=0x5c7081620580dcac4f430a8a1f6d519ab9072a219b767007f685296ec9c8e1a5 \
RECALLRAID_E2E_BASE_FUNDING_TX=0x45d0d80a71cb717ca2cf226aef602800926ab0d0e83146449d9c500ae76f3caf \
RECALLRAID_E2E_CHALLENGE_FUNDING_TX=0xa4689db52e8b97353e70f72eff30f96845a9c91cab1cfd5a3221bd9299dc68d0 \
RECALLRAID_E2E_OPEN_CHALLENGE_TX=0x916f5c93bab7da2d35cf2acd7d3b953c49c7f47353d63a92f717051f6cd8352a \
RECALLRAID_GENLAYER_READ_WAIT_MS=3600000 \
node --env-file=apps/api/.env scripts/studionet_base_challenge_e2e.mjs
```

The challenge deposit, evidence, challenge opening, adjudication, and any later
settlement are each verified and checkpointed independently. Stop and preserve
the checkpoint if the wallet, case registration, receipt, or finalized
GenLayer execution does not match; never run this successor command with the
production EDFF contract or the generic fresh-case defaults.

The live Base accounting branch checks and limitations are recorded in
[`e2e-evidence/live-base-security-branches.json`](e2e-evidence/live-base-security-branches.json).
Their EIP-712 authorizations used synthetic test outcomes and a synthetic
GenLayer reference. The Base transactions did not consume the revised
adjudicator's consensus result. They are accounting and signature-binding
checks, not end-to-end adjudication evidence.

The earlier CLI record in
[`e2e-evidence/studionet-base-cli-e2e.json`](e2e-evidence/studionet-base-cli-e2e.json)
used `a239...` and demonstrated an upheld challenge. The current successful
StudioNet-to-Base test is recorded in
[`e2e-evidence/studionet-base-valid-challenge-e2e.json`](e2e-evidence/studionet-base-valid-challenge-e2e.json).
It began with 100,000 Base USDC base units funded by the same wallet that
submitted investigation 3, authenticated registration through Fly, a 20,000
unit Base challenge stake from the named challenger, and a successful
StudioNet validator resolution that changed `NO_ISSUE` to `POTENTIAL_ISSUE`.
The version-pinned CPSC PDF's exact SHA-256 was verified by GenLayer validators.
Fly's API cache independently retains challenge 3's exact Base transaction,
challenger, stake, prior/final verdicts, and the closed challenge identifier.

Settlement and withdrawals are intentionally deferred: the seven-day
post-resolution window ends at `2026-10-24T10:31:44Z`. This task records the
deadline and required follow-up checks; it does not execute settlement early.
The API and contracts have not claimed or transferred these balances yet. An
authenticated relay request against this case returned HTTP 400 `GenLayer
adjudication is not terminal` and sent no Base transaction. The separate record
[`e2e-evidence/studionet-base-clean-challenge-e2e.json`](e2e-evidence/studionet-base-clean-challenge-e2e.json)
captures a failed attempt whose GenLayer challenge contains a placeholder Base
transaction string; do not use it as settlement evidence. StudioNet's hosted
RPC quota intermittently blocked Fly sync requests, although authenticated
registration sync and the final hosted cache reads subsequently succeeded.

At 2026-10-17 11:41Z the exposed diagnostic wallet was rechecked through
StudioNet's canonical RPC: chain id `61999`, balance `998.795 GEN`, and nonce
`265` matched the prepared recovery transfer. A single submission again
returned HTTP 429 (`500 requests per hour`) without a transaction hash. The
documented underlying GenLayer Chain RPC was checked read-only as a possible
supported wallet endpoint; it reported chain id `4221` and zero balance for
this address, so it is a separate ledger and was not used to bypass the
StudioNet write limit. The diagnostic funds remain unrecovered until the
canonical StudioNet endpoint accepts a transaction and its receipt and both
balances are verified.

A further read-only production check at 11:43Z returned API and database
health `ok`, `/submit` HTTP 200, and three cached investigations (IDs 1–3).
All three are still unsettled; the feed's case IDs match the current evidence
record. Base Sepolia returned chain id `84532`, and StudioNet returned
`61999`. All 16 JavaScript assets loaded; they contain the current `EDFF...`
adjudicator, Base escrow, and Fly API hostname, with no superseded `A239...`
address. API tests (46) and Foundry tests (9) passed again at 11:43Z. No write
transaction was sent during these checks.

At 11:45Z the post-deadline settlement runner inputs were preflighted without
signing or broadcasting: the configured submitter key and the mode-`0600`
challenger key file both derive the wallets recorded for the case; the API env
file is also mode `0600`, and the required deployment variables are present.
This confirms the withdrawal runner has its local credentials when the
recorded challenge deadline passes; it does not claim settlement readiness
before that deadline.
At 11:48Z the runner itself was invoked and exited at its report-deadline
guard with the expected `2026-10-24T10:31:44Z` message, before making a GenLayer
or Base RPC call. No settlement or withdrawal write was sent.

On 2026-10-17 the production PostgreSQL cache was pruned of four stale hunts
from the superseded contract era, along with four dependent evidence rows, two
pending evidence uploads, and two notifications. The exact active `EDFF...`
case and its open funded challenge were preserved. One removed cache record
was still registered on Base to `A239...` with 100,000 USDC base units and is
not finalized; the database cleanup did not alter that on-chain escrow. The
cleanup inventory and guard results are in
[`e2e-evidence/legacy-cache-cleanup.json`](e2e-evidence/legacy-cache-cleanup.json).
The cleanup is a historical record, not a continuing delete job. A hosted
feed check after the live run showed three investigations (IDs 1–3), all
bound to the current `EDFF...` deployment. The two older `EDFF...` test cases
remain indexed because their on-chain challenge/deposit state is still open
or unsettled; deleting their cache rows would only hide that state. No
investigation from the superseded `A239...` deployment remains in the current
feed, while one deleted legacy Base registration remains on-chain as documented
in the cleanup record.

The production cache was rechecked read-only on 2026-10-17 at 11:07Z. Fly
reported API and database health as `ok`, and the running machine's configured
GenLayer contract was `0xEDFFB4B4999D65A248441438233c18717515973d`. The live hunts
endpoint returned only investigations 1–3. A direct PostgreSQL inventory found
zero unmatched investigation, evidence, challenge, pending evidence upload,
investigation notification, related transaction-log, or seller-bond rows.
This confirms that the cache contains no prior-contract hunts or dependent
records. The three current-contract rows remain because their Base escrow or
challenge states are unsettled. The refreshed counts and method are recorded
in [`e2e-evidence/legacy-cache-cleanup.json`](e2e-evidence/legacy-cache-cleanup.json).

At 2026-10-17 10:48Z, the Fly API was rolled to image
`recallraid-usdc-api:deployment-01M54QJ6JVBCQVTT8NYVQN3C26`, built from API
source commit `3c77c28ae3fbf0753c9503db57b54b6afe40e9c1` before the key-history
scrub; its sanitized equivalent is now
`aaa442e10bf6a19e2fddd44bfc1cb19370ac53b7`. The API source tree is unchanged
by that redaction. Both version-14 machines passed health checks.
After rollout, `/health`, `/challenges/3`, and `/investigations/3` returned
HTTP 200 with the expected finalized challenge and case-3 cache state.

On 2026-10-17 the exposed diagnostic test key was removed from all Git blobs,
including local Codex checkpoint refs, and `main` was force-updated with an
exact lease. GitHub now exposes only the sanitized `main` branch; scanning its
reachable blobs found no copy of that exact key. Commit IDs changed because
history was rewritten. For deployment records, API source commit
`3c77c28ae3fbf0753c9503db57b54b6afe40e9c1` now has sanitized equivalent
`aaa442e10bf6a19e2fddd44bfc1cb19370ac53b7`, and API source commit
`4f998ad4c91454ea384aee47e7b620447fffbf5e` now has sanitized equivalent
`622fa5383407acbfea4edf5609c179a6e2f6a707`. Tree content was unchanged by the
redaction. History rewriting cannot invalidate copies in forks or clones; the
key remains compromised. Its StudioNet test wallet held 998.795 GEN and no
Base Sepolia ETH or USDC. A transfer to a fresh key has not been confirmed;
StudioNet RPC rate limiting interrupted the recovery attempt before a
transaction hash or receipt could be verified.

The Base escrow verifier compiled the checked-out Solidity with solc
`0.8.37+commit.f401782d`, optimizer runs `200`, and `viaIR: true`. It verified
the deployed runtime bytecode (masking compiler-reported immutable slots) and
reported source hash
`0x90e7562eeb84dcd0738b61d3dba8ff406761e8d4f8581caf2b3800909aac0fc6` and
runtime hash
`0xa7919e068cf4d9a0172ad8d8b888ff3770f3c45da94c6b195cb2009e5c20b370`.
The verified owner and relayer are `0x7401c129EDfc26E68FE19309fE461eb3Db1058Eb`,
the distinct decision signer is `0x6C76E71a9AeEBE3A79D1b078122D2c42dC69Cd4C`,
and USDC is `0x036CbD53842c5426634e7929541eC2318f3dCF7e`.

On 2026-10-17 Fly was updated with the `EDFF...` GenLayer address and the
separate decision-signer secret; both API machines were healthy. Vercel
production now bundles `EDFF...`, points to the Fly API, and has a READY
production deployment. Authenticated production sync consumed the actual
finalized registration receipt and preserved the live case. Production relay
returned HTTP 400 before the seven-day settlement deadline. These checks
verify current address configuration and fail-closed behavior; they do not
prove final payout or withdrawal.

After the CLI run below exposed an SDK receipt-shape mismatch, API commit
`4f998ad4c91454ea384aee47e7b620447fffbf5e` was deployed to Fly on 2026-10-17;
its sanitized history equivalent is `622fa5383407acbfea4edf5609c179a6e2f6a707`.
Migration `20261017000001_terminal_genvm_tx.sql` was applied. An
authenticated production sync consumed the real finalized `resolve_challenge`
receipt and retained the verdict, last challenge id, and challenge-used state
in the investigation cache. The hosted relay returned HTTP 400
`GenLayer adjudication is not terminal` for this nonterminal case. This
validates receipt parsing and early-relay rejection in the deployed API; it
does not validate a successful settlement.

## Environment variables

Use `.env.example` as a name/type guide and keep local files ignored. Public
browser variables are prefixed `NEXT_PUBLIC_` and are bundled into the web
client; put only RPC URLs, contract addresses, and the WalletConnect/Reown
project id there. Server settings belong to `apps/api` or the hosting secret
store.

| Variable group | Examples | Where it belongs |
|---|---|---|
| Web public config | `NEXT_PUBLIC_API_BASE_URL`, `NEXT_PUBLIC_GENLAYER_RPC_URL`, `NEXT_PUBLIC_GENLAYER_CONTRACT_ADDRESS`, `NEXT_PUBLIC_BASE_SEPOLIA_RPC_URL`, `NEXT_PUBLIC_BASE_SEPOLIA_USDC_ADDRESS`, `NEXT_PUBLIC_RECALLRAID_ESCROW_ADDRESS`, `NEXT_PUBLIC_REOWN_PROJECT_ID` | `apps/web/.env.local` and web build environment |
| API network/database | `DATABASE_URL`, `PORT`, `NODE_ENV`, `CORS_ALLOWED_ORIGIN`, `GENLAYER_RPC_URL`, `GENLAYER_CONTRACT_ADDRESS`, `BASE_SEPOLIA_RPC_URL`, `BASE_SEPOLIA_CHAIN_ID`, `BASE_SEPOLIA_USDC_ADDRESS`, `RECALLRAID_ESCROW_ADDRESS` | `apps/api/.env` locally; API runtime environment remotely |
| API secrets | `JWT_SIGNING_SECRET`, `BASE_SEPOLIA_RELAYER_PRIVATE_KEY`, `BASE_SEPOLIA_DECISION_SIGNER_PRIVATE_KEY`, `CLOUDINARY_API_SECRET`, plus Cloudinary credentials | API environment / hosting secret manager only |
| Deployment-only Base constructor settings | `DEPLOYER_PRIVATE_KEY`, `DECISION_SIGNER_ADDRESS`, optional `BASE_SEPOLIA_USDC_ADDRESS`, `BASE_SEPOLIA_RPC_URL` | Temporary deployment shell environment; never web config |

Keep the relayer and decision signer distinct. `DECISION_SIGNER_ADDRESS` at
deployment must match the address derived from the API's
`BASE_SEPOLIA_DECISION_SIGNER_PRIVATE_KEY`. The deployer should be separately
controlled. The decision signer can authorize financial settlement and is
not merely an operational relayer credential.

## Build, deploy, and verify contracts

```bash
npm install
npm run compile:base
DEPLOYER_PRIVATE_KEY=... DECISION_SIGNER_ADDRESS=0x... npm run deploy:base
genlayer deploy --contract contracts/recallraid_contract.py
genlayer schema <DEPLOYED_GENLAYER_ADDRESS>
```

The deploy script checks the RPC reports Base Sepolia chain id `84532` and
validates nonzero constructor addresses before broadcasting. Inspect the
deployment receipt and constructor arguments in an explorer before
configuring either application. The source verifier compiles the checked-out
Solidity with the same optimizer and IR settings, compares deployed runtime
bytecode while masking compiler-reported immutable slots, and checks the
network, USDC, relayer, and decision-signer addresses. Set expected public
addresses explicitly or derive them locally from the API's configured keys.
Node's env-file support loads the ignored API settings without printing key
material:

```bash
node --env-file=apps/api/.env contracts/base/verify.mjs
```

`DEPLOYER_ADDRESS=0x...` may also be supplied to compare the on-chain owner.
This verifies the deployed Base bytecode and configured authorities; it does
not establish GenLayer consensus or prove that a particular GenLayer receipt
was consumed by Base. For StudioNet, compare `genlayer code` with the local
Python source where supported, inspect the accepted deployment receipt, query
`get_protocol_info`, and retrieve the schema. The corrected deployment's
protocol info reports a 604800-second challenge period and 172800-second
challenge resolution period.

## API deployment

The Fly app identifier is set in `apps/api/fly.toml`. Provision PostgreSQL,
then set server variables and secrets through the Fly dashboard/CLI, never by
committing an `.env` file. Keep one machine available because the watcher
maintains cache freshness and retry behavior.

```bash
flyctl deploy apps/api --config fly.toml
flyctl ssh console -a recallraid-usdc-api -C 'node /app/dist/db/migrate.js'
curl https://recallraid-usdc-api.fly.dev/health
```

The hostname follows the app name in `apps/api/fly.toml`; verify it in Fly and
confirm health before using it. Check logs, database migrations, StudioNet
reads, Base Sepolia reads, and successful CORS from the intended frontend
origin.

## Frontend deployment

Set the public variables from `.env.example` in the web build environment.
Verify that `NEXT_PUBLIC_API_BASE_URL` points to the healthy API and both
contract addresses are deployed on the intended networks. Build with
`npm run build:web`, deploy the `apps/web` Next.js application to its configured
host, and check `/`, `/hunts`, `/submit`, `/seller`, and `/wallet`. Use a test
wallet and verify Base network switching, approval/funding receipts, GenLayer
writes, chain-to-cache synchronization, and claims. Build success alone does
not prove a working remote integration.

## Current limitations

The live `EDFF...` exercise proves browser-equivalent Base funding,
authenticated Fly registration, finalized GenLayer evidence verification and
adjudication, and a real Base-backed challenge that validators overturned. The
current checkout additionally gates `open_challenge` behind an authenticated
API relay that verifies the actual Base receipt. That hardened challenge
opening path is not yet deployed to the live `EDFF...` pair; see the source
parity and migration notes below.
The production API cache reflects the same challenge and final verdict. The
settlement signer and Base payout have not yet been exercised against that
live finalized case: the seven-day post-resolution window expires at
`2026-10-24T10:31:44Z`. Wallet withdrawals are therefore still outstanding.
Fly's StudioNet RPC limit has intermittently blocked sync requests, although
the final authenticated registration sync and cache verification succeeded.
The seven-day orphan-recovery delay is covered by local time-warp tests; no
live seven-day orphan-recovery wait was performed. Keep these remaining
scenarios documented as pending until their transactions and wallet balances
are independently verified.

On 2026-10-17 at 11:09Z, direct read-only StudioNet and Base Sepolia RPC checks
reconfirmed that investigation 3 remains `POTENTIAL_ISSUE`, its finalized
challenge 3 is `OVERTURNED`, and the registered Base case is unsettled with the
matching submitter, challenger, bounty, and stake. Neither wallet has a
claimable balance yet. No settlement or withdrawal transaction was sent. The
seven-day window expires at `2026-10-24T10:31:44Z`; the evidence record includes
the exact state read from both chains.

At 11:12Z the deployment checks were refreshed: the Base Sepolia verifier
again matched checked-out Solidity source to the deployed runtime bytecode and
confirmed the USDC, relayer, and decision-signer addresses. The production
`/submit` page returned HTTP 200; all 16 JavaScript assets loaded and contained
the then-current GenLayer contract, Base escrow, and Fly API configuration,
with no legacy A239 address. The StudioNet source comparison at that time found
the authoritative-URL validator difference (deployed accepts any scheme; that
checkout required HTTPS and rejected credentials). The current checkout has
since added admin-only challenge opening and authenticated API verification;
the successor is now deployed and has an isolated hosted preview, while
production still serves the earlier pair. The
current checkout passes 47 API tests, 2 direct-mode GenVM tests, 9 Foundry
tests, API and web production builds, GenLayer contract lint, and both Solidity
and Python compilation. `npm run test:genlayer` uses local direct mode; it does
not consume StudioNet RPC quota or prove StudioNet consensus.

The successor deployment attempt described in this timestamped historical
entry was later accepted after rate limits cleared. See the deployment table
and rollout evidence for its address and source verification. Fly/Vercel still
serve `EDFF...`; preserve its cases because Base registration is immutable.
`genvm-lint` static lint passed, but
SDK validation passes when pinned to the cached compatible `v0.3.0-rc7` runner
bundle with `GENVM_VERSION=v0.3.0-rc7`; it reports 32 methods (13 views and 19
writes) and zero constructor parameters. The default linter selection picks
`v0.6.0-rc7`, which lacks the contract's pinned runner archive, so keep the
explicit version override in the validation command. `npm run lint:contract`
now selects `v0.3.0-rc7` by default while respecting an explicit
`GENVM_VERSION` override.
The public StudioNet explorer account page for the deployment wallet was
checked at 11:31Z; it shows the existing EDFF calls as the newest project
transactions and no successor deployment transaction.

At 11:47Z the deployed `EDFF...` source was retrieved once more from the
canonical StudioNet RPC. Its normalized SHA-256 remains
`d51ae75dbf23bcdb23c0ae1f83ef4df51933767c0108e631074a40ef766b23e5`; the
point-in-time difference remained URL validation (the deployed source accepts
any scheme while that checkout required HTTPS and rejected credentials). The
current checkout also adds admin-only challenge opening and an API relay with
actual Base-receipt verification; those changes are not in the deployed source.
No successor deployment or hosted cutover had been recorded at that check.
The same-time Base verifier
again matched the escrow runtime to the checked-out Solidity source: runtime
hash `0xa7919e068cf4d9a0172ad8d8b888ff3770f3c45da94c6b195cb2009e5c20b370`,
source hash `0x90e7562eeb84dcd0738b61d3dba8ff406761e8d4f8581caf2b3800909aac0fc6`,
USDC `0x036CbD53842c5426634e7929541eC2318f3dCF7e`, relayer
`0x7401c129EDfc26E68FE19309fE461eb3Db1058Eb`, and decision signer
`0x6C76E71a9AeEBE3A79D1b078122D2c42dC69Cd4C`.

Fresh checks at approximately 12:10–12:16Z reconfirmed the current external
state. The structured record is
[`e2e-evidence/hardened-challenge-rollout-check.json`](e2e-evidence/hardened-challenge-rollout-check.json).
The Base verifier again matched the deployed escrow. The hosted Fly
process reports `EDFF...`, escrow `0x861d...`, Base Sepolia chain id 84532,
relayer `0x7401...`, and decision signer `0x6C76...`; `/health` reports API and
database `ok`. Fly's active image remains deployment
`01M54QJ6JVBCQVTT8NYVQN3C26`. The production Vercel `/hunts/3` page and all 16
JavaScript assets returned HTTP 200; the rendered bundle contains `EDFF...` and
the verified escrow, and the hunt-detail bundle still contains the direct
`open_challenge` client flow rather than the new `/challenges/open-status` API
flow. This confirms the hardened frontend/API change has not been rolled out.
The hosted feed still contains investigations 1–3, all unsettled and bound to
EDFF; they were preserved. The current StudioNet source retrieval still shows
the old four-argument, caller-as-challenger `open_challenge` implementation.
Successor deployment retries again returned the RPC's 500-requests/hour error
at both gas estimation and transaction submission and produced no transaction
hash. No contract write or hosted cutover occurred during these checks.

At 11:51Z, direct read-only StudioNet/Base Sepolia reads confirmed case 3 is
still unsettled on both chains, with finalized overturned challenge 3,
20,000-unit challenger stake, 100,000-unit bounty, and the same
`2026-10-24T10:31:44Z` deadline. The Base case remains registered to EDFF
investigation 3 and preserves the submitter and challenger addresses. No write
was sent; the exact state is captured in the E2E evidence JSON.

To finish the recorded case after its deadline, run the settlement runner from
the repository root with the API key material in ignored `apps/api/.env` and
the separate challenger key file already used by the challenge test:

```bash
RECALLRAID_API_BASE_URL=https://recallraid-usdc-api.fly.dev \
RECALLRAID_E2E_ORIGIN=https://recall-raid.vercel.app \
node --env-file=apps/api/.env scripts/settle_studionet_base_e2e.mjs
```

The runner first checks the report's recorded deadline without making an RPC
write, then re-reads GenLayer state, requires successful finalized settlement,
syncs its transaction through authenticated Fly API, invokes the deployed
decision signer, verifies the Base `AdjudicationRelayed` event and case
binding, and claims USDC from the hunter and challenger wallets. It records
each completed stage in the live evidence JSON so an interrupted withdrawal
can be resumed and checked without claiming the same balance twice.
Private key material stays in ignored local configuration and hosting secret
stores; never add it to this repository.
