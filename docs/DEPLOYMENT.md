# Deployment and configuration

This repository documents the RecallRaid testnet deployment on StudioNet and
Base Sepolia. The contracts are test deployments, not production contracts.
The Base escrow deployment is verified below. The currently hosted pair uses
the accepted `EDFF...` StudioNet adjudicator and the verified Base escrow.
The repository adds a stricter HTTPS check for official regulator URLs after
that adjudicator was deployed; deploy a successor adjudicator only after the
currently bound live case has completed settlement, because Base registration
is immutable.
The deployed `EDFF...` source was retrieved with `genlayer code` on
2026-10-17. Its normalized source hash is
`d51ae75dbf23bcdb23c0ae1f83ef4df51933767c0108e631074a40ef766b23e5`; the sole
semantic difference from the checked-out source is that the deployed URL
validator does not require HTTPS or reject URL credentials. The successful
live challenge used a version-pinned HTTPS CPSC PDF.

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

Settlement and withdrawals remain pending: the seven-day post-resolution
window ends at `2026-10-24T10:31:44Z`. The API and contracts have not claimed
or transferred these balances yet. An authenticated relay request against this
case returned HTTP 400 `GenLayer adjudication is not terminal` and sent no Base
transaction. The separate record
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

The live `EDFF...` exercise now proves browser-equivalent Base funding,
authenticated Fly registration, finalized GenLayer evidence verification and
adjudication, and a real Base-backed challenge that validators overturned.
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
the current GenLayer contract, Base escrow, and Fly API configuration, with no
legacy A239 address. The StudioNet source was retrieved again and still differs
from checkout only in the authoritative-URL validator (deployed accepts any
scheme; checkout requires HTTPS and rejects credentials). The live E2E uses
HTTPS, but exact StudioNet source parity remains an outstanding deployment
item. API tests (46), Foundry tests (9), and API/web production builds pass.

A successor deployment of the checked-out HTTPS-only source was attempted on
StudioNet. RPC rate limiting returned errors during gas estimation and
transaction submission; the CLI returned no transaction hash or contract
address. Do not treat source parity as resolved, and do not change Fly/Vercel
from `EDFF...` until the successor deployment is accepted, its source/schema/
protocol info are verified, and cases registered on `EDFF...` have been
settled or otherwise safely reconciled. `genvm-lint` static lint passed, but
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
only semantic difference remains URL validation (the deployed source accepts
any scheme while checkout requires HTTPS and rejects credentials). No
successor deployment or hosted cutover is recorded. The same-time Base verifier
again matched the escrow runtime to the checked-out Solidity source: runtime
hash `0xa7919e068cf4d9a0172ad8d8b888ff3770f3c45da94c6b195cb2009e5c20b370`,
source hash `0x90e7562eeb84dcd0738b61d3dba8ff406761e8d4f8581caf2b3800909aac0fc6`,
USDC `0x036CbD53842c5426634e7929541eC2318f3dCF7e`, relayer
`0x7401c129EDfc26E68FE19309fE461eb3Db1058Eb`, and decision signer
`0x6C76E71a9AeEBE3A79D1b078122D2c42dC69Cd4C`.

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
