# RecallRaid

RecallRaid is a cross-chain marketplace-safety bounty protocol. USDC staking,
payments, seller bonds, challenge stakes, escrow, slashing, and claims execute
on Base Sepolia. GenLayer performs only evidence verification and adjudication;
the backend relays each final decision to Base Sepolia for settlement.

## Current milestone deployment

| Component | Network / URL | Identifier |
|---|---|---|
| USDC | Base Sepolia | `0x036CbD53842c5426634e7929541eC2318f3dCF7e` |
| RecallRaidEscrow | Base Sepolia | `0xce45b80019A59C153659f014bC74900d930A6886` |
| RecallRaid adjudicator | GenLayer StudioNet | `0x193f060bc67A350B4158f52D403BCdd14151A835` |
| API | Fly.io | `https://recallraid-usdc-api.fly.dev` |
| Frontend | Vercel | `https://recallraid.vercel.app` |

The deployer/relayer address is `0x7401c129EDfc26E68FE19309fE461eb3Db1058Eb`.
Private keys and service credentials are never committed.

## Architecture

1. A wallet approves Base Sepolia USDC and funds a uniquely identified case in
   `RecallRaidEscrow`.
2. The same wallet records the case and evidence on GenLayer. GenLayer fetches
   evidence bytes, verifies hashes, and reaches a validator-backed verdict.
3. Challenges are funded in USDC on Base Sepolia before GenLayer adjudication.
4. The backend hashes the final adjudication data and calls
   `relayAdjudication` on Base Sepolia exactly once.
5. Recipients claim USDC directly from the Base Sepolia escrow.

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md),
[docs/SECURITY.md](docs/SECURITY.md), [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md),
and [milestone.md](milestone.md).

## Verification

```bash
npm install
npm run build:api
npm run build:web
npm run test:api
npm run compile:base
PYTHONPYCACHEPREFIX=/tmp/recallraid-pycache python3 -m py_compile contracts/recallraid_contract.py
```

Three real Base Sepolia runs cover a no-issue refund, a recall-confirmed bounty
with seller-bond slash, and an overturned funded challenge. Their funding,
relay, and claim transactions are displayed at `/milestone`.
