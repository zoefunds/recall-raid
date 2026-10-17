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
verifies Base funding first. The earlier live EDFF challenge used the old direct-opening path. The
successor challenge below used the authenticated admin relay and a version-pinned
HTTPS CPSC PDF.

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
local mode-0600 E2E environment as the case claimant. The separate 551f
diagnostic wallet's balance was recovered to the rotated role wallet at
15:41Z; its source now holds zero GEN. See the
[recovery receipt and role checks](e2e-evidence/diagnostic-wallet-recovery.json).

The successor had zero investigations and seller bonds at source verification;
the current live challenge exercise is investigation 1. It is now the production
frontend default; existing Base registrations remain owned by their original
EDFF or A239 deployment. A read-only `get_protocol_info` call verified the
successor admin, unpaused
state, and protocol windows. At 2026-10-17 15:24Z, `genlayer code` and
`genlayer schema` both succeeded against the canonical StudioNet RPC. After
removing the CLI `Result:` wrapper and trailing newline, deployed successor
source is byte-for-byte identical to the checked-in
`contracts/recallraid_contract.py` and has SHA-256
`e7ca95221338bd213448be1cd18e0483eccd97312a8ba81a5c3fac94ef4daee0`.

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
`deployment-01M556PJJBDPR2DWAP3WR1MD7Y`; the EDFF Fly API is
`deployment-01M556T7X34PPRT529WW611ENF`. Both service health endpoints report
API and database `ok` on the 15:24Z recheck. The successor investigation 1
is now status 3 with verdict 2, `open_challenge_id = 0`, and
`last_challenge_id = 1`; its API challenge record is `OVERTURNED`. EDFF case 3
remains a separate unsettled registration.

Both Fly APIs now run commit `7cb64e0`, including the explicit confirmation
validator and regression test for a finalized challenge transaction submitted
by the previous admin before role rotation. The API build passes and the suite
has 50 passing tests. `GENLAYER_CHALLENGE_OPEN_ADMIN_GATED=true` is enabled only
on the candidate API, whose address is the verified hardened successor. It
remains unset on the legacy EDFF API, which therefore continues to require the
current relay sender when confirming an opening. The candidate `/open-status`
confirmation later succeeded against the exact recorded opening transaction;
no funding or challenge-opening transaction was repeated.

A direct Base Sepolia read at 15:26Z reconfirmed escrow owner and relayer
`0xE3F1A34307349be94f3657276ebcF51eaB810730`, with the separate decision
signer `0x6C76E71a9AeEBE3A79D1b078122D2c42dC69Cd4C`. The successor case remains
registered to investigation 1 with 100,000 bounty units and the exact 20,000
challenger deposit; `finalized` is false.

### Hardened successor live challenge

The challenge workflow for Base case
`0xd370cf1ea5d45edace9ba669f396d6ab139dc4566a9933b8f5e738b0f8953987` and
successor investigation 1 is finalized and synchronized. Base funding of
100,000 USDC base units by the submitter is recorded in transaction
`0x45d0d80a71cb717ca2cf226aef602800926ab0d0e83146449d9c500ae76f3caf` and
bound to the hardened GenLayer contract. The user confirmed the initial
browser-wallet transaction flow. The resumed CLI verified the recorded
funding and did not resubmit it.

Control evidence was finalized and verified, and the initial verdict was
`NO_ISSUE` (7,800 confidence basis points). Challenger
`0xA0E30f264f4Db37CdDcFED0C93A6BcDff5C70F8d` funded exactly 20,000 units in
Base transaction
`0xa4689db52e8b97353e70f72eff30f96845a9c91cab1cfd5a3221bd9299dc68d0`.
The authenticated API relayed challenge 1 through GenLayer transaction
`0x916f5c93bab7da2d35cf2acd7d3b953c49c7f47353d63a92f717051f6cd8352a`;
the candidate `/open-status` endpoint later confirmed its exact finalized
transaction, named challenger, and Base funding. The official CPSC PDF
rebuttal was reachable and SHA-256 verified by GenLayer. Resolution transaction
`0x39247ac7480615388c4c1437aaeadefd6a7185072572dd1690fceea69fb0c62c`
finalized with `MAJORITY_AGREE` and `FINISHED_WITH_RETURN`, overturning the
verdict to `POTENTIAL_ISSUE`. GenLayer retains `last_challenge_id = 1` after
clearing `open_challenge_id`; the hosted API returns the same `OVERTURNED`
record with the exact funded challenger and stake.

At Base Sepolia block 48241239, the registered case remained unfinalized, with
100,000 bounty units, 20,000 challenger-stake units, zero claimable USDC for
both submitter and challenger, and the expected distinct relayer and decision
signer roles. The seven-day deadline is
`2026-10-24T15:22:12Z`. No Base settlement or wallet claim has been attempted.
At eventual settlement, this positive-verdict bounty follows the documented
first-evidence-submitter policy (the submitter wallet); the overturned
challenger receives the separately funded 20,000-unit stake. The complete
receipts, current API reads, and Base snapshot are in
[`e2e-evidence/hardened-successor-live-challenge.json`](e2e-evidence/hardened-successor-live-challenge.json).

After the recorded deadline, resume settlement from the repository root with
the recorded pair and report. The settlement script rechecks live GenLayer
state and deadline, syncs through the candidate API, requires its decision
signer authorization, verifies Base finalization and event, then withdraws
only the exact expected claims and verifies wallet USDC balance deltas:

```sh
GENLAYER_CONTRACT_ADDRESS=0xfAc47CB7eEbF95f3d043A0cd8112ecdb24486ecA \
RECALLRAID_API_BASE_URL=https://recallraid-candidate-api.fly.dev \
RECALLRAID_E2E_ORIGIN=https://recall-raid.vercel.app \
RECALLRAID_E2E_REPORT=docs/e2e-evidence/hardened-successor-live-challenge.json \
RECALLRAID_E2E_CASE_ID=0xd370cf1ea5d45edace9ba669f396d6ab139dc4566a9933b8f5e738b0f8953987 \
RECALLRAID_E2E_INVESTIGATION_ID=1 \
node --env-file=apps/api/.env scripts/settle_studionet_base_e2e.mjs
```

The previous DNS failure and StudioNet quota errors were transient blockers;
read access recovered and the exact challenge confirmation, evidence, and
resolution completed. Do not rerun the challenge-opening flow for this case.

The live Base accounting branch checks and limitations are recorded in
[`e2e-evidence/live-base-security-branches.json`](e2e-evidence/live-base-security-branches.json).
Their EIP-712 authorizations used synthetic test outcomes and a synthetic
GenLayer reference. The Base transactions did not consume the revised
adjudicator's consensus result. They are accounting and signature-binding
checks, not end-to-end adjudication evidence.

The earlier CLI record in
[`e2e-evidence/studionet-base-cli-e2e.json`](e2e-evidence/studionet-base-cli-e2e.json)
used `a239...` and demonstrated an upheld challenge. The prior EDFF
StudioNet-to-Base test is recorded in
[`e2e-evidence/studionet-base-valid-challenge-e2e.json`](e2e-evidence/studionet-base-valid-challenge-e2e.json).
It began with 100,000 Base USDC base units funded by the same wallet that
submitted investigation 3, authenticated registration through Fly, a 20,000
unit Base challenge stake from the named challenger, and a successful
StudioNet validator resolution that changed `NO_ISSUE` to `POTENTIAL_ISSUE`.
The version-pinned CPSC PDF's exact SHA-256 was verified by GenLayer validators.
Fly's API cache independently retains challenge 3's exact Base transaction,
challenger, stake, prior/final verdicts, and the closed challenge identifier.
The hardened successor's separate live challenge and overturned result are
recorded in
[`e2e-evidence/hardened-successor-live-challenge.json`](e2e-evidence/hardened-successor-live-challenge.json).

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
StudioNet write limit. This 11:41Z snapshot was superseded at 15:41Z: the canonical StudioNet
endpoint accepted recovery transaction
`0x3159771506004c57508b7da5bf6f35915edea75e7311bd12eb54d47838abf275`, and
its successful receipt plus zero source balance and exact receiver delta are
recorded in [`e2e-evidence/diagnostic-wallet-recovery.json`](e2e-evidence/diagnostic-wallet-recovery.json).

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
Base Sepolia ETH or USDC at the time of the history rewrite. The transfer was
still unconfirmed in this earlier snapshot because RPC rate limiting had
interrupted the first attempt. A later retry finalized at 15:41Z; the transfer
receipt, zero source balance, exact receiver delta, and role checks are recorded
in [`e2e-evidence/diagnostic-wallet-recovery.json`](e2e-evidence/diagnostic-wallet-recovery.json).

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

## Current limitations and remaining obligations

The hardened successor's live challenge exercise is now complete through
StudioNet adjudication and hosted API synchronization. Investigation 1 on
`0xfAc47CB7eEbF95f3d043A0cd8112ecdb24486ecA` finalized a validator-backed
overturn from `NO_ISSUE` to `POTENTIAL_ISSUE`; the API retained challenge 1 as
`OVERTURNED`, and GenLayer preserved `last_challenge_id = 1`. The exact evidence
and current on-chain reads are in
[`e2e-evidence/hardened-successor-live-challenge.json`](e2e-evidence/hardened-successor-live-challenge.json).

The successor Base case remains registered and unfinalized with 100,000 bounty
units and the exact 20,000-unit challenger deposit. Both claimable balances are
zero. Its seven-day period ends at `2026-10-24T15:22:12Z`; settlement and wallet
withdrawals remain pending until then. The authenticated candidate frontend/API
pair is deployed, and the user confirmed the browser-wallet transaction flow;
the CLI continuation operated against the same recorded funded case without
repeating funding or challenge opening. No early settlement is permitted.

Two separate historical escrow liabilities remain. The EDFF investigation 3
case remains registered to EDFF and has its own seven-day settlement deadline
`2026-10-24T10:31:44Z`; do not route it through the successor API. The older
A239 investigation 2 is also registered in Base escrow
`0x861d5D4E903805cbE283A86f08E10D031601774E` to GenLayer contract
`0xa239189c2921b592dBa1eccde830977edbfD1CB5`. Read-only state at 15:26Z showed
100,000 bounty units, 20,000 challenger stake units, `finalized = false`,
GenLayer verdict `RECALL_CONFIRMED`, and its challenge 1 `UPHELD`; that
investigation's seven-day deadline is `2026-10-24T08:08:09Z`. A239 reports admin
`0x7452084E1Cf767bf19C743051cFf27D9F7A87a4D`, and the local GenLayer account
inventory has the unlocked `eventweaver` account at that address. The active
hosted APIs are configured for EDFF or the successor and do not currently
provide an A239-specific settlement relay. The repository now includes a
version-bound read-only-first procedure at
[`scripts/settle_legacy_a239_case.mjs`](../scripts/settle_legacy_a239_case.mjs).
Its preflight verified the Base registration, exact funded challenge receipt,
GenLayer upheld challenge, first-evidence recipient, and deadline; `--relay`
was also checked to reject before the deadline without sending a write. Cache
deletion did not release these funds. At or after the deadline, first use the
local GenLayer account that the deployed A239 protocol reports as admin, then
pass its finalized settlement transaction hash to the separate Base relay:

```sh
node --env-file=apps/api/.env scripts/settle_legacy_a239_case.mjs

# Only after the displayed deadline has passed:
genlayer account use eventweaver
genlayer write --rpc https://studio.genlayer.com/api \\
  0xa239189c2921b592dBa1eccde830977edbfD1CB5 settle_investigation --args 2
# Wait for FINALIZED + AGREE/MAJORITY_AGREE + successful returned execution.
RECALLRAID_A239_SETTLEMENT_TX_HASH=0x<finalized-GenVM-tx-hash> \\
  node --env-file=apps/api/.env scripts/settle_legacy_a239_case.mjs --relay
```

That script independently revalidates the GenLayer terminal transaction,
Base registration, exact challenger deposit/receipt, role addresses, and
decision-signer EIP-712 authorization before relaying. The upheld challenger
stake is allocated to the first-evidence hunter with the bounty under the
escrow's existing policy. A later optional `--relay --claim` requires the
first-evidence wallet key in protected `RECALLRAID_A239_HUNTER_PRIVATE_KEY`
and verifies its exact USDC balance delta. Do not put that key in a command
argument or repository file.

Later diagnostic-wallet recovery at 2026-10-17 15:41Z: the exposed wallet
`0x551f5b8b2c517bfd780f2e005be2dd2754b7aa85` transferred its exact remaining
998.795000000000001 GEN to the rotated role wallet in finalized transaction
`0x3159771506004c57508b7da5bf6f35915edea75e7311bd12eb54d47838abf275`.
The source balance is zero and receiver balance increased from 1 to
999.795000000000001 GEN. Live reads verified the old address has no administrator
role on EDFF, the successor, or A239 and no Base escrow role. The two temporary
scripts holding the compromised source key were deleted; a local content scan
and unreachable-Git scan found no other copy. See
[`e2e-evidence/diagnostic-wallet-recovery.json`](e2e-evidence/diagnostic-wallet-recovery.json).

The live Base accounting branches in
[`e2e-evidence/live-base-security-branches.json`](e2e-evidence/live-base-security-branches.json)
remain synthetic authorization/accounting tests, not a replacement for the
real StudioNet-to-Base relay. Seven-day settlement and wallet USDC balance
changes are still pending for the current cases. The following dated notes are
historical rollout snapshots; newer facts in this section and above supersede
them where they conflict.

Historical snapshot at 11:12Z the deployment checks were refreshed: the Base Sepolia verifier
again matched checked-out Solidity source to the deployed runtime bytecode and
confirmed the USDC, relayer, and decision-signer addresses. The production
`/submit` page returned HTTP 200; all 16 JavaScript assets loaded and contained
the then-current GenLayer contract, Base escrow, and Fly API configuration,
with no legacy A239 address. The StudioNet source comparison at that time found
the authoritative-URL validator difference (deployed accepts any scheme; that
checkout required HTTPS and rejected credentials). The current checkout has
since added admin-only challenge opening and authenticated API verification;
the successor was then deployed with an isolated preview, while production
still served the earlier pair. At that time the checkout passed 47 API tests,
2 direct-mode GenVM tests, and 9 Foundry tests. Current local results are 50
API, 2 GenVM, and 9 Foundry tests. `npm run test:genlayer` uses local direct mode; it does
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

Direct-call authorization check at 2026-10-17 15:38Z: an unrelated wallet
called `open_challenge(1, ...)` on the hardened successor in transaction
`0x6ed41f2f7a4d30a7db2f14369ce66bdfc2cc68cb05faea334e6fcf8c25ebbacd`.
The receipt finalized with `MAJORITY_AGREE`, while the leader execution
returned `ERROR` and rolled back with `[EXPECTED] caller is not the protocol
admin`. Fresh chain and API reads showed the investigation and retained
overturned challenge unchanged; no Base transaction was sent. The exact receipt
and post-call state are recorded in the live-challenge JSON. This verifies the
deployed successor's direct-call gate and does not substitute for the still
pending Base settlement after the seven-day deadline.

Fresh hosted read-only recheck at 2026-10-17 16:56Z: production `/submit`
returned HTTP 200 and all 16 unique JavaScript assets returned HTTP 200. The
bundles include the hardened successor, Base escrow, USDC, and candidate API;
EDFF is absent. Candidate API `/health` returned `ok` with database `ok`, and
credentialed CORS preflight returned HTTP 204 for the production origin. The
15:35Z deployed StudioNet source/schema parity result remains separately
recorded above; this check did not re-fetch source.
