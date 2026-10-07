# Deployment

## Current addresses

- Base Sepolia USDC: `0x036CbD53842c5426634e7929541eC2318f3dCF7e`
- RecallRaidEscrow: `0xce45b80019A59C153659f014bC74900d930A6886`
- GenLayer adjudicator: `0x193f060bc67A350B4158f52D403BCdd14151A835`
- Deployer/relayer: `0x7401c129EDfc26E68FE19309fE461eb3Db1058Eb`
- Base deployment tx: `0x3a1388328c4d23d1775e4c74a4d8e8cb31722feb65ae16a8773d18d8a6a76bd5`
- GenLayer deployment tx: `0x07ec2204e37d069573f98507a35e510b1e91361343f2e2e337a78bb671b0e830`

## Contracts

```bash
npm run compile:base
DEPLOYER_PRIVATE_KEY=... npm run deploy:base
genlayer deploy --contract contracts/recallraid_contract.py
genlayer schema 0x193f060bc67A350B4158f52D403BCdd14151A835
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
Verify `/`, `/hunts`, `/submit`, `/seller`, `/wallet`, and `/milestone`.
