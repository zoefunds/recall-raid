# Deployment and configuration

This repository documents the RecallRaid testnet deployment on StudioNet and
Base Sepolia. The contracts are test deployments, not production contracts.
The Base escrow deployment is verified below. Several StudioNet adjudicator
deployments exist; the latest accepted deployment is not yet the hosted pair.
Always verify runtime configuration and deployed source before treating the
local, hosted, and on-chain configurations as one deployment.

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

The CLI-driven cross-chain record in
[`e2e-evidence/studionet-base-cli-e2e.json`](e2e-evidence/studionet-base-cli-e2e.json)
used the earlier accepted adjudicator and demonstrates an upheld challenge,
not a successful overturn. A separate run against the latest adjudicator is
in progress; it is not evidence of completion until its report is recorded.

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

On 2026-10-17 the Fly API and Vercel app were configured with the `a239...`
adjudicator. The latest `EDFF...` deployment was applied to local ignored
configuration for testing, but the hosted API/frontend have not been verified
against that latest pair. The production health/HTTP checks are historical
reachability evidence only and do not establish current configuration or a
completed browser-originated cross-chain settlement.

After the CLI run below exposed an SDK receipt-shape mismatch, API commit
`4f998ad4c91454ea384aee47e7b620447fffbf5e` was deployed to Fly on 2026-10-17
and migration `20261017000001_terminal_genvm_tx.sql` was applied. An
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
flyctl deploy --config apps/api/fly.toml
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

The live Base accounting records use synthetic adjudication outcomes and do
not prove the decision-signing service accepted an actual successful GenLayer
consensus transaction and executed the resulting settlement on Base. A full
browser-originated flow covering funding, authenticated registration,
evidence, validator adjudication, a bonded overturned challenge, final
settlement, and wallet withdrawals remains unverified. The live CLI run
reached challenge resolution but validators upheld the original verdict. The
seven-day orphan recovery delay is covered by local time-warp tests; no live
seven-day wait was performed. Do not describe these remaining scenarios as
completed evidence.
Private key material stays in ignored local configuration and hosting secret
stores; never add it to this repository.
