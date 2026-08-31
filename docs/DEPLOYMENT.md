# RecallRaid Deployment

## 1. Intelligent Contract (you deploy this — Claude does not)

Target: **GenLayer Studio simulator, StudioNet**. Fee token: **GEN**.

Before deploying:

```bash
python3 -m py_compile contracts/recallraid_contract.py
python3 -m venv .venv && .venv/bin/pip install genvm-linter   # PyPI package is "genvm-linter"; the CLI command it installs is "genvm-lint"
.venv/bin/genvm-lint check contracts/recallraid_contract.py
```

You must see **both** lines below — either one missing or failing means the
contract will not deploy cleanly (this is what a "could not load contract
schema" error looks like caught early, before spending real GEN on a
deploy):

```
✓ Lint passed (3 checks)
✓ Validation passed
  Contract: RecallRaid
  Methods: 31 (12 view, 19 write)
```

Fix every lint/validation failure before deploying — do not deploy a
contract with unresolved output. Two real bugs were caught this way while
building this contract (see `memory.md` for the full story): a missing
`from dataclasses import dataclass` (this SDK's `from genlayer import *`
does not re-export it) and a `gl.nondet.web.render` call that was reachable
only through an indirect `self.method()` call rather than lexically inside
the closure passed to `gl.vm.run_nondet_unsafe` — both are exactly the
class of bug that produces "could not load contract schema" at deploy
time, and both are already fixed in the committed contract.

If `genvm-lint` flags a newer runner as available, do not switch the
pinned `# { "Depends": "py-genlayer:..." }` hash without first confirming
the same "Validation passed" output against the new hash — see the note in
the contract's header comment for why the current pin was chosen
deliberately.

Deploy via the GenLayer Studio UI or CLI following the current official
workflow at https://docs.genlayer.com/developers/intelligent-contracts —
the contract takes no constructor arguments (the deploying account
automatically becomes `admin`). After deployment, verify it immediately:

```bash
genlayer schema <deployed_address>
genlayer call <deployed_address> get_protocol_info
```

`get_protocol_info` should return JSON with your deploying wallet as
`admin`, `paused: false`, and all the fixed economics constants
(`challenge_stake_bps: 2000`, etc.) — if any of those look wrong, redeploy
rather than patching state, since there is no admin method to change fixed
economics constants post-deploy.

**Once you have the deployed address, give it to Claude.** It gets wired
into environment configuration only — never hardcoded in source:

- `apps/web/.env.local` → `NEXT_PUBLIC_GENLAYER_CONTRACT_ADDRESS=<address>`
- `apps/api` Fly secrets → `GENLAYER_CONTRACT_ADDRESS=<address>`

Claude will not ask you to redeploy unless a contract code change is
technically required (e.g. a bug fix to the deployed logic) — routine
integration work never requires a new address.

### ✅ Current deployment (StudioNet)

`GENLAYER_CONTRACT_ADDRESS = 0xb2CB610EBbB773e2a6B9895CD49E3032C0722a70`

Wired into root `.env`, `apps/web/.env.local`, `apps/api/.env` (all
gitignored, local-only), Fly.io secrets for `recallraid-api`, and Vercel
production environment variables for `apps/web`. Live-verified with:

```bash
node scripts/full_contract_test_suite.mjs
```

which runs every read and write method against the deployed contract
using three funded StudioNet test wallets — as of the last run: **67/67
checks passing**, including both nondet-consensus paths
(`request_verdict`/`resolve_challenge` and `verify_seller_bond_listing`)
and the full seller-bond ownership-verification flow. Re-run this script
after any future redeploy before considering a new address production-
ready — a passing `genvm-lint`/structural-test pass only validates schema
and static safety rules, not real GenVM consensus behavior.

Also seeded with 6 real-world showcase investigations via
`scripts/four_product_showcase.mjs` and `scripts/two_more_products.mjs`
(Fisher-Price Rock 'n Play Sleeper, Peloton Tread+, IKEA MALM chest,
Instant Pot Duo Plus, Boppy Original Newborn Lounger, Jetson Rogue
42-Volt Hoverboard) — every transaction reached clean consensus, with
zero unresolved errors left on the explorer. See the root README's
Status section and `memory.md` for the full record, including the one
`NO_MAJORITY` result that was retried to a clean outcome and the
1x1-test-pixel evidence-photo mistake that was fixed for investigations
5 and 6 but can't be retroactively fixed for 1-4 (evidence is
append-only once a verdict is reached).

There is also a separate, minimal diagnostic contract
(`contracts/diagnostics/nondet_consensus_diagnostic.py`, last deployed to
`0xDD5ab7df97DB9CeCadA8bB2692e5c115B7AE8E6d`) kept in the repo for
isolating any *future* nondet-consensus regression from application-code
bugs before spending time patching RecallRaid itself — see the README's
"Debugging nondet consensus" section and `memory.md` for why this exists
and what it already caught once.

**Redeploy workflow** (every time the contract's Python source changes):
1. The project owner deploys the updated `recallraid_contract.py` via
   GenLayer Studio and gives Claude the new address.
2. Claude updates `GENLAYER_CONTRACT_ADDRESS` /
   `NEXT_PUBLIC_GENLAYER_CONTRACT_ADDRESS` everywhere (root `.env`,
   `apps/api/.env`, `apps/web/.env.local`, `scripts/
   full_contract_test_suite.mjs`'s hardcoded `CONTRACT_ADDRESS` constant,
   Fly secrets, Vercel env), then redeploys `apps/api` (if its own code
   also changed) and `apps/web`.
3. Claude truncates the Postgres cache tables (`evidence_cache`,
   `challenges_cache`, `seller_bonds_cache`, `notifications`,
   `tx_status_log`, `leaderboard_cache`, `evidence_uploads_pending`,
   `investigations_cache`) so stale rows from the old contract address
   never get served under the new one's IDs.
4. Claude re-runs `scripts/full_contract_test_suite.mjs` against the new
   address and reports the result before considering the redeploy done.

## 2. Database — PostgreSQL on Fly.io (Docker)

```bash
fly launch --dockerfile apps/api/Dockerfile --name recallraid-db --no-deploy   # or use `fly postgres create` for Fly's managed Postgres image
fly secrets set DATABASE_URL=postgres://... --app recallraid-api
```

Run migrations against the deployed database:

```bash
npm run migrate --workspace apps/api
```

## 3. Backend — Fly.io (always-on)

`apps/api/fly.toml` is configured with `min_machines_running = 1` and no
auto-stop — this is a hard requirement (the backend must never sleep/die).

```bash
cd apps/api
fly deploy
fly secrets set \
  DATABASE_URL=... \
  CORS_ALLOWED_ORIGIN=https://recall-raid.vercel.app \
  GENLAYER_CONTRACT_ADDRESS=<address> \
  GENLAYER_RPC_URL=https://studio.genlayer.com/api \
  JWT_SIGNING_SECRET=... \
  CLOUDINARY_CLOUD_NAME=... CLOUDINARY_API_KEY=... CLOUDINARY_API_SECRET=... CLOUDINARY_UPLOAD_FOLDER=recallraid-evidence \
  DEADLINE_WATCHER_INTERVAL_MS=180000
```

`DEADLINE_WATCHER_INTERVAL_MS` controls how often the background sweep
(`apps/api/src/lib/deadline-watcher.ts`) polls chain state for upcoming
deadlines and pending-tx receipts. 180000 (3 minutes) was chosen after an
initial 20000ms (20s) exhausted StudioNet's RPC rate limit (500 req/hour)
— do not set this lower without checking that limit first.

Any migration to the database schema must be applied against the
production Postgres instance after deploy — the compiled migration
runner lives at `dist/db/migrate.js` inside the deployed image:

```bash
fly ssh console -a recallraid-api -C 'node /app/dist/db/migrate.js'
```

Verify uptime after deploy:

```bash
fly status --app recallraid-api
curl https://recallraid-api.fly.dev/health
```

## 4. Frontend — Vercel

```bash
cd apps/web
vercel link
vercel env add NEXT_PUBLIC_REOWN_PROJECT_ID
vercel env add NEXT_PUBLIC_API_BASE_URL
vercel env add NEXT_PUBLIC_GENLAYER_CONTRACT_ADDRESS
vercel env add NEXT_PUBLIC_GENLAYER_RPC_URL
vercel --prod
```

`NEXT_PUBLIC_REOWN_PROJECT_ID` is a [Reown Cloud](https://cloud.reown.com)
(formerly WalletConnect Cloud) project ID — it gates the wallet-connect
modal (MetaMask, WalletConnect, Coinbase Wallet, and "All Wallets"). If
wallet connect ever breaks with no other symptom, verify this ID is
still valid in Reown Cloud before suspecting the contract or RPC layer —
this has happened once already (see `memory.md`), and the fix was
regenerating the project ID and updating it here plus root `.env` /
`apps/web/.env.local`, with no code changes needed.

## 5. Post-deploy verification checklist

- [ ] `curl https://recallraid-api.fly.dev/health` returns 200
- [ ] `fly status` shows the API machine in `started` state with no auto-stop configured
- [ ] Landing page loads on the Vercel URL and shows live stats (not zeros/errors)
- [ ] Wallet connect works for at least MetaMask and WalletConnect
- [ ] `node scripts/full_contract_test_suite.mjs` passes against the current address — this is the real
      verification step; everything above is a smoke test
- [ ] `get_protocol_info` view call succeeds from both the frontend and the backend independently

## 6. Diagnostic contract (only needed if nondet consensus misbehaves)

`contracts/diagnostics/nondet_consensus_diagnostic.py` is a separate,
minimal contract for isolating whether a `gl.vm.run_nondet_unsafe`
disagreement is a platform issue or an application bug — deploy it the
same way as RecallRaid itself, to whichever network needs testing
(StudioNet, local `gltest` Studio mode, Testnet Asimov), then:

```bash
CONTRACT_ADDRESS=0xYourDiagnosticDeploy node scripts/diagnostic_test.mjs
```

`check_constant` reaching `MAJORITY_AGREE` (a hardcoded-int comparison,
zero I/O) is the single cleanest sanity check available — if it ever
disagrees, that points at the platform/environment; if it agrees but
`check_web_fetch`/`check_llm_classification` don't, that narrows the
issue to I/O-dependent nondeterminism specifically. See `memory.md` for
the full story of the one bug this already caught (a `leader_result`
API-unwrap mistake, not a platform issue).
