# Deployment

## Current addresses

- Base Sepolia USDC: `0x036CbD53842c5426634e7929541eC2318f3dCF7e`
- RecallRaidEscrow: `0x5D6426aA81583Fd795385952CB6d82A1Ed5a15F4`
- GenLayer adjudicator: `0xa4e1D02aBaed368461870D1453d709d51183A119`
- Deployer/relayer: `0x7401c129EDfc26E68FE19309fE461eb3Db1058Eb`
- Base deployment tx: `0xb60871d4e652d66cef7a3e66431a8ff1819ce24d662603369d3467681d731aa4`
- GenLayer deployment tx: `0x0a9929c10a80cf39d590ff108a09da6d7bf0ec7cb6e9cda5f9c0341971f50e51`

## Contracts

```bash
npm run compile:base
DEPLOYER_PRIVATE_KEY=... npm run deploy:base
genlayer deploy --contract contracts/recallraid_contract.py
genlayer schema 0xa4e1D02aBaed368461870D1453d709d51183A119
```

## API

The replacement backend is `recallraid-usdc-api`; its dedicated database is
`recallraid-usdc-db`. Required secrets are documented in `.env.example`.

```bash
flyctl deploy --config apps/api/fly.toml
flyctl ssh console -a recallraid-usdc-api -C 'node /app/dist/db/migrate.js'
curl https://recallraid-usdc-api.fly.dev/health
```

## Frontend

Set all public variables from `.env.example`, build, and deploy `apps/web`.
Verify `/`, `/hunts`, `/submit`, `/seller`, and `/wallet`.
