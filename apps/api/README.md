# RecallRaid API

Fastify/TypeScript service for the RecallRaid Base Sepolia USDC milestone.

Responsibilities:

- mirror GenLayer adjudication state into PostgreSQL;
- authenticate wallets with signed nonces;
- issue signed Cloudinary evidence-upload parameters;
- relay final GenLayer decisions to `RecallRaidEscrow` on Base Sepolia;
- expose cached investigations, evidence, challenges, seller bonds,
  reputation, notifications, statistics, and transaction status.

The API holds one testnet relayer key. That key can finalize already-funded
cases but cannot debit a user wallet. All user deposits, stakes, bonds, and
claims remain wallet-signed Base Sepolia transactions.

## Development

```bash
npm install
npm run migrate
npm run dev
npm run test
npm run build
```

Environment variables are documented in the repository `.env.example`.

## Production

- App: `recallraid-usdc-api`
- Database: `recallraid-usdc-db`
- Health: `https://recallraid-usdc-api.fly.dev/health`

`apps/api/fly.toml` keeps one machine running. Run migrations after each deploy:

```bash
flyctl ssh console -a recallraid-usdc-api -C 'node /app/dist/db/migrate.js'
```

The settlement endpoint is `POST /investigations/:id/relay`. It requires an
authenticated wallet session, re-reads the final GenLayer state, derives a
decision hash, and performs the one-time Base Sepolia relay.
