# Deployment and configuration

This repository currently documents a StudioNet / Base Sepolia testnet setup.
The addresses below distinguish the previously recorded milestone contracts
from the 2026-10-17 remediation validation contracts. Confirm the target
network, deployed bytecode, owner, relayer, decision signer, token, and frontend
configuration before using any address. The validation escrow is test-only
and must not be presented as a production deployment.

## Networks and recorded deployments

Base Sepolia chain id is `84532`; the commonly used Base Sepolia USDC test
token is `0x036CbD53842c5426634e7929541eC2318f3dCF7e`. The GenLayer chain used
here is StudioNet (`61999`), served through `https://studio.genlayer.com/api`.

| Purpose | Network | Contract | Transaction / status |
|---|---|---|---|
| Prior milestone escrow (historical) | Base Sepolia | `0x5D6426aA81583Fd795385952CB6d82A1Ed5a15F4` | `0xb60871d4e652d66cef7a3e66431a8ff1819ce24d662603369d3467681d731aa4` |
| Prior milestone adjudicator (historical) | StudioNet | `0xa4e1D02aBaed368461870D1453d709d51183A119` | `0x0a9929c10a80cf39d590ff108a09da6d7bf0ec7cb6e9cda5f9c0341971f50e51` |
| Remediation validation escrow (test only) | Base Sepolia | `0xea0973CbFf42F1B41A339103f133d3D43a24A54b` | `0xe8e2814512e4e49ec623551ee42358c797b467c531b30f21dfcb1b2bc975ec67` |
| Revised adjudicator | StudioNet | `0x6d11FC5f7492407c287215CF8F8134025D6dEADE` | `0x5876729d37b8b13c9f4cec55bcb054ac218b34c88a86af473705ff24f3c1866f`; `ACCEPTED`, `MAJORITY_AGREE`, schema retrieved |

The live Base branch checks and limitations are recorded in
[`e2e-evidence/live-base-security-branches.json`](e2e-evidence/live-base-security-branches.json).
Their EIP-712 authorizations used synthetic test outcomes and a synthetic
GenLayer reference. The Base transactions did not consume the revised
adjudicator's consensus result. No completed browser-originated cross-chain
flow is claimed here.

The repository's API Fly app name is `recallraid-usdc-api`. Its source
configuration does not prove that the hosted service is currently deployed or
healthy. Check the hosting dashboard and health endpoint before using the
service. Likewise, confirm the Vercel project/domain and deployed frontend
before publishing endpoint values.

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

Base deployment also needs a Base Sepolia RPC URL and can use the configured
USDC address. Inspect deploy output and verify the deployment receipt and
constructor addresses in the explorer before configuring either application.
GenLayer deploy/schema commands require the GenLayer CLI and configured
StudioNet access. Do not copy old addresses over a new deployment without
verifying contract version and constructor values.

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

## Local remediation configuration

During the 2026-10-17 checks, ignored local files were configured to use the
revised StudioNet adjudicator, the test-only Base escrow, and a dedicated test
decision signer. Their public contract addresses and Base evidence are in the
JSON validation record. Private key material remains in ignored local API
configuration and is not part of this repository. Production hosting settings
were not changed by those local checks.
