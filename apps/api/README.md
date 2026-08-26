# RecallRaid API

Fastify + TypeScript backend for RecallRaid. **Read-only against the
blockchain** — it never holds a private key and never signs a transaction.
It mirrors GenLayer StudioNet contract state into Postgres (via
`@gl.public.view` calls and transaction-receipt polling) for fast reads,
search, and notifications. Every value-moving call (`submit_investigation`,
`add_evidence`, `open_challenge`, `settle_investigation`, `withdraw`,
`create_seller_bond`, etc.) is signed client-side by the connected wallet
directly from `apps/web` against the GenLayer RPC — this API is not in that
path.

See `/Users/macbook/recallraid/docs/ARCHITECTURE.md` for the full system
design and `/Users/macbook/recallraid/memory.md` for locked decisions.

## Local development

1. **Start Postgres** (repo root, not this directory):

   ```bash
   docker compose up -d
   ```

   This starts a local-only Postgres for `apps/api` — unrelated to
   GenLayer, which always talks to the hosted StudioNet simulator.

2. **Configure environment**. Copy the repo-root `.env.example` to
   `apps/api/.env` and fill in the server-only / secret sections:

   ```bash
   cp ../../.env.example .env
   ```

   At minimum for local dev you need `DATABASE_URL` (matches the
   docker-compose Postgres by default: `postgres://recallraid:changeme@localhost:5432/recallraid`),
   `GENLAYER_RPC_URL`, and `GENLAYER_CONTRACT_ADDRESS` (once the contract is
   deployed — see `docs/DEPLOYMENT.md`). Cloudinary vars are only required for the
   evidence upload-url endpoint to work; everything else runs fine without
   them.

3. **Install dependencies and run migrations**:

   ```bash
   npm install
   npm run migrate
   ```

   Migrations are plain numbered `.sql` files in `src/db/migrations/`,
   applied in filename order by `src/db/migrate.ts`, tracked in a
   `schema_migrations` table. Re-running `npm run migrate` is always safe —
   already-applied files are skipped.

4. **Run the dev server**:

   ```bash
   npm run dev
   ```

   Starts on `PORT` (default `8080`) with `tsx watch`.

5. **Run tests**:

   ```bash
   npm run test
   ```

   Covers the two most safety-critical pieces of backend logic: wallet
   signature verification (`test/auth.test.ts`) and the tx-status state
   machine's legal transitions (`test/tx-status-machine.test.ts`).

## Adding a migration

Create a new file in `src/db/migrations/` named
`<UTC timestamp>_<short_description>.sql` (sorts correctly by filename),
write plain SQL, then run `npm run migrate`. There is no down-migration
tooling by design — write forward-only migrations, and handle any needed
backfill/cleanup in the same file.

## Deployment (Fly.io)

The app is configured for **always-on** operation
(`min_machines_running = 1`, `auto_stop_machines = "off"` in `fly.toml`) —
this is a hard "24/7 uptime" requirement, not a default left in place, so
do not change it to allow scale-to-zero.

```bash
fly launch --no-deploy   # first time only, uses this directory's fly.toml
fly postgres create      # if not already provisioned
fly postgres attach <postgres-app-name>   # wires DATABASE_URL as a secret

fly secrets set \
  GENLAYER_RPC_URL=https://studio.genlayer.com/api \
  GENLAYER_CONTRACT_ADDRESS=0x... \
  CORS_ALLOWED_ORIGIN=https://recall-raid.vercel.app \
  JWT_SIGNING_SECRET=$(openssl rand -hex 32) \
  CLOUDINARY_CLOUD_NAME=... \
  CLOUDINARY_API_KEY=... \
  CLOUDINARY_API_SECRET=... \
  CLOUDINARY_UPLOAD_FOLDER=recallraid-evidence

fly deploy
```

After every deploy that adds a new migration file, apply it against the
production database. The build compiles `src/db/migrate.ts` to
`dist/db/migrate.js`, so the simplest way is directly on the running
machine:

```bash
fly ssh console -a recallraid-api -C 'node /app/dist/db/migrate.js'
```

This prints `applied: <filename>` for each newly-applied migration and
`migrations up to date` when there's nothing left to run — safe to
re-run any time.

## Endpoints

| Method | Path | Auth | Notes |
| --- | --- | --- | --- |
| GET | `/health` | none | liveness + DB check |
| POST | `/auth/nonce` | none | issues a sign-in nonce for a wallet address |
| POST | `/auth/verify` | none | verifies a signed nonce, sets a session cookie |
| POST | `/auth/logout` | none | clears the session cookie |
| GET | `/auth/session` | none | returns the current session, if any |
| GET | `/investigations` | none | paginated, filterable Active Hunts feed (cache) |
| GET | `/investigations/:id` | none | one investigation + its evidence/challenges (cache) |
| POST | `/investigations/:id/sync` | session | re-reads chain state after a confirmed tx |
| POST | `/evidence/upload-url` | session | Cloudinary signed upload params for an evidence file |
| POST | `/evidence/:investigationId/sync` | session | re-reads evidence after `add_evidence` confirms |
| GET/POST | `/challenges/...` | mixed | mirror pattern of investigations |
| GET/POST | `/seller-bonds/...` | mixed | mirror pattern of investigations |
| GET | `/reputation/:address` | none | live `get_reputation` read-through |
| GET | `/leaderboard` | none | cached, periodically-refreshed ranking |
| GET | `/notifications` | session | this wallet's notifications |
| POST | `/notifications/:id/read` | session | mark one read |
| POST | `/tx-status` | session | client reports a tx hash + lifecycle status |
| GET | `/tx-status/:hash` | none | poll a specific transaction's mirrored status |

All error responses use the shape `{"error": {"code": "...", "message": "..."}}`;
stack traces are never sent to the client, only logged server-side via
Fastify's built-in pino logger.

## Background jobs

`src/lib/deadline-watcher.ts` runs two read-only loops on an interval
(`DEADLINE_WATCHER_INTERVAL_MS`, currently set to 180000ms/3min in
production — an earlier 20000ms/20s setting exhausted StudioNet's RPC
rate limit of 500 req/hour):

1. Polls every non-terminal `tx_status_log` row's transaction receipt from
   chain and mirrors the outcome.
2. Sweeps `investigations_cache` for evidence/verdict/challenge deadlines
   approaching within an hour and pushes a notification — purely
   informational; the actual `claim_*_timeout` call is still signed and
   sent by a wallet from `apps/web`.

Neither loop ever constructs a signer or calls a write method.
