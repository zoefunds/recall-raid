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
  Methods: 29 (12 view, 17 write)
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

`GENLAYER_CONTRACT_ADDRESS = 0x34935D3d16a1Db83925117AEf95c045c2c197756`

Wired into root `.env`, `apps/web/.env.local`, `apps/api/.env` (all
gitignored, local-only — see `docs/DEPLOYMENT.md`'s note on Fly secrets for
the production equivalent). Live-verified with:

```bash
node scripts/verify_deployed_contract.mjs
```

which confirmed `getContractSchema` loads (29 methods) and
`get_protocol_info()` returns this repo's exact fixed economics constants
— i.e. the deployed bytecode really is this contract. Re-run this script
after any future redeploy before wiring in a new address.

**Still needed before this address is live in production**: `fly secrets
set GENLAYER_CONTRACT_ADDRESS=0x34935D3d16a1Db83925117AEf95c045c2c197756`
against the deployed `recallraid-api` Fly app, and the same value as a
Vercel environment variable for `apps/web`.

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
fly secrets set GENLAYER_CONTRACT_ADDRESS=<address> GENLAYER_RPC_URL=... CLOUDINARY_CLOUD_NAME=... CLOUDINARY_API_KEY=... CLOUDINARY_API_SECRET=... JWT_SIGNING_SECRET=...
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

## 5. Post-deploy verification checklist

- [ ] `curl https://recallraid-api.fly.dev/health` returns 200
- [ ] `fly status` shows the API machine in `started` state with no auto-stop configured
- [ ] Landing page loads on the Vercel URL and shows live stats (not zeros/errors)
- [ ] Wallet connect works for at least MetaMask
- [ ] `submit_investigation` completes a real transaction against the deployed contract and appears in `/hunts`
- [ ] `get_protocol_info` view call succeeds from both the frontend and the backend independently
