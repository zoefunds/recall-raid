# RecallRaid — Build Memory

## CRITICAL: deployed contract has a fatal bug in `submit_investigation` — needs redeploy (found 2026-08-25)

A real end-to-end test (`scripts/e2e_submit_flow_test.mjs` — funded a
throwaway test wallet via `sim_fundAccount`, ran the actual wallet-auth
flow, called `submit_investigation` for real) revealed that **every
`submit_investigation` call on the currently deployed contract
(`0x34935D3d16a1Db83925117AEf95c045c2c197756`) fails.** The transaction
finalizes (`MAJORITY_AGREE` — validators agree the execution errors), but
`execution_result: ERROR` with:
```
TypeError: this class can't be instantiated by user
  File "/contract.py", line 552, in submit_investigation
    self.evidence_by_investigation[inv_id] = DynArray[u32]()
```

**Root cause**: `DynArray[u32]()` / `TreeMap[...]()` cannot be manually
constructed at runtime anywhere in a GenVM contract — not just in
`__init__` as I'd documented earlier, but anywhere. The correct call is
`gl.storage.inmem_allocate(DynArray[u32])`, confirmed against
docs.genlayer.com's storage/memory-management page. This is a genuinely
different, stricter rule than what genvm-lint and schema validation check
— both passed cleanly on the broken version, because this is a *runtime*
error, not a schema/lint-time one. **Static checks cannot catch this
class of bug — only actually executing the method does.**

**Fixed in source** (both call sites, `submit_investigation` line ~552 and
the `add_evidence` fallback branch ~594) — `python3 -m py_compile`, all 7
structural tests, and `genvm-lint` all still pass after the fix (as
expected, since none of them exercise runtime execution).

**Blast radius check — confirmed safe**: `get_investigation_count()` on
the live deployed contract still reads `0` after the failed test
transaction — GenVM correctly reverted all state changes on the errored
leader/majority-error outcome, so **no corrupted investigation records
exist**. The only real cost: the test wallet's 0.01 GEN (test tokens, not
real value) bounty `gl.message.value` was deducted and is now sitting in
the contract's ghost-contract EVM balance with no way to reclaim it,
since the investigation record was never created for the deposit to be
tracked against. This is a general GenVM/ghost-contract behavior worth
knowing: **a payable call's value transfer can complete even when the
contract's own Python logic subsequently errors and reverts its state** —
harmless here since it was 10^16 wei of test GEN into a contract that's
about to be redeployed anyway, but worth remembering for the next
contract's design (money in transit during an erroring call isn't
automatically returned).

**This means: the currently deployed contract cannot actually be used for
its core feature and must be redeployed with the fixed source before
RecallRaid is functional for real users.** Per the standing rule in this
file, Claude does not deploy the contract — the user needs to redeploy
`contracts/recallraid_contract.py` (now fixed) via GenLayer Studio and
give the new address, which then needs to flow into: root `.env`,
`apps/web/.env.local` + Vercel env var, `apps/api/.env` + `fly secrets set
GENLAYER_CONTRACT_ADDRESS=...`. Once redeployed,
`node scripts/e2e_submit_flow_test.mjs` should be re-run against the new
address (edit the `CONTRACT_ADDRESS` const at the top of that script) to
confirm the full submit → upload → evidence → sync → list-feed pipeline
actually works before considering this shipped.

## LIVE DEPLOYMENT (2026-08-25)

Both apps are deployed and verified working end-to-end against the live contract:

- **API**: `https://recallraid-api.fly.dev` — Fly app `recallraid-api`, 2 machines in `iad` (`min_machines_running=1`, `auto_stop_machines=off`, per the 24/7 requirement), each passing its `/health` check. Attached Postgres: Fly app `recallraid-db` (unmanaged flex Postgres, `shared-cpu-1x`, 1GB volume — this is Fly's basic self-hosted Postgres per the user's "Docker + PostgreSQL" choice, not Fly's newer Managed Postgres product). Migrations applied (`20260825000001_init.sql`). Secrets set: `DATABASE_URL` (auto-wired by `fly postgres attach`), `GENLAYER_CONTRACT_ADDRESS`, `GENLAYER_RPC_URL`, `CORS_ALLOWED_ORIGIN=https://recall-raid.vercel.app`, `JWT_SIGNING_SECRET` (freshly generated, 32-byte hex, never displayed after generation). **R2 secrets are NOT set** — no real Cloudflare R2 credentials were available at deploy time, so evidence-file upload will fail at runtime (`/evidence/upload-url` will error) until `R2_ACCOUNT_ID`/`R2_ACCESS_KEY_ID`/`R2_SECRET_ACCESS_KEY`/`R2_BUCKET_NAME`/`R2_PUBLIC_BASE_URL` are set via `fly secrets set --app recallraid-api`. Everything else (investigation/evidence/challenge reads, wallet auth, leaderboard) works without R2.
- **Frontend**: `https://recall-raid.vercel.app` — Vercel project `recall-raid` (team `adebiyi2002gmailcoms-projects`), deployed from `apps/web`, aliased exactly to the URL the user specified. All 8 routes verified returning HTTP 200 in production. Env vars set as Production-scope Vercel env vars (not just `.env.local`): `NEXT_PUBLIC_REOWN_PROJECT_ID`, `NEXT_PUBLIC_API_BASE_URL=https://recallraid-api.fly.dev`, `NEXT_PUBLIC_GENLAYER_CHAIN=studionet`, `NEXT_PUBLIC_GENLAYER_RPC_URL`, `NEXT_PUBLIC_GENLAYER_CONTRACT_ADDRESS`.
- **Cross-origin verified live**: `curl` with `Origin: https://recall-raid.vercel.app` against the API returns `access-control-allow-origin: https://recall-raid.vercel.app` — the deployed frontend can actually call the deployed API from a real browser.

**Not yet done**: no custom domain beyond the vercel.app/fly.dev defaults. No monitoring/alerting configured beyond Fly's built-in health checks.

## Final audit: frontend↔contract↔backend integration (2026-08-25)

User asked for a full audit that (a) the contract is called correctly by
the frontend, (b) the backend relays chain state to the frontend as fast
as possible, (c) nothing is stale. This surfaced several real,
previously-invisible bugs — cross-checked against the **live deployed
contract's actual schema** (`node scripts/verify_deployed_contract.mjs`-
style calls to `getContractSchema`), not just source-reading:

1. **Critical: wallet-auth session cookie was never actually usable.**
   `apps/web/src/lib/api.ts`'s `apiFetch` never set `credentials: 'include'`
   on its `fetch()` calls. The API and web app are different origins
   (Fly.io vs Vercel) and the session cookie is issued with
   `SameSite=None; Secure` specifically for cross-origin use — but without
   `credentials: 'include'` on the client, the browser silently drops both
   the `Set-Cookie` on `/auth/verify`'s response AND every outgoing
   cookie afterward. **Fixed** by adding it in one place (`apiFetch`).

2. **Critical: the entire challenge-nonce-signature auth flow was never
   invoked anywhere in the frontend.** The backend fully implements
   `POST /auth/nonce` → sign → `POST /auth/verify` (see `apps/api/src/routes/auth.ts`),
   but no frontend code ever called it — every `requireAuth`-gated
   endpoint (evidence upload-url, all four `/*/sync` triggers,
   notifications, leaderboard/refresh) would 401 forever. **Fixed** by
   adding `apps/web/src/hooks/useWalletSession.ts` (module-level dedup so
   concurrent callers share one in-flight sign request, not one prompt
   each) and calling `ensureSession()` at the top of every handler that
   needs it: `submit/page.tsx` (before uploads), `hunts/[id]/page.tsx`
   (before request_verdict/open_challenge/settle_investigation),
   `seller/page.tsx` (before create_seller_bond).

3. **Critical: `withdraw` argument type mismatch.** The live contract's
   schema is `withdraw(amount_wei: int)`, but `apps/web/src/app/wallet/page.tsx`
   was calling `write.send('withdraw', [wei.toString()])` — a decimal
   string where the contract expects native int calldata. Confirmed via
   `getContractSchema` against the live address, not assumed. **Fixed** by
   passing the bigint directly.

4. **Endpoint shape mismatches across the board** (the root cause of the
   "Live stats unavailable" error the user screenshotted): the frontend's
   TypeScript types (`apps/web/src/types/contract.ts`) mirror the
   contract's own JSON shape exactly (numeric `status`/`verdict`, `id`,
   `submitter`, etc.), but the Postgres cache uses different column names
   and text-label enums (`investigation_id`, `submitter_wallet`, `status`
   as `'OPEN'` not `0`). Specific breaks found and fixed:
   - `GET /stats` **didn't exist at all** — added `apps/api/src/routes/stats.ts`,
     a real aggregate query (verified_discoveries, active_threats,
     gen_distributed_wei all computed from `investigations_cache`, not
     hardcoded).
   - `GET /evidence?investigation_id=` **didn't exist at all** — added to
     `evidence.ts`.
   - `GET /investigations` and `GET /investigations/:id` returned raw cache
     rows (wrong field names, `description` missing entirely from the
     cache table, status/verdict as text) instead of the contract-shaped
     JSON the frontend expects.
   - `GET /leaderboard` and `GET /sellers/:address/bonds` returned
     `{total,items,...}`/`{sellerBonds:[...]}` wrapper objects; the
     frontend's `fetchLeaderboard`/`fetchSellerBonds` expect a bare array.
   - Fixed by adding `apps/api/src/lib/serialize.ts` (one translation
     boundary: cache row → frontend-shaped object, including reverse
     enum-label-to-code maps added to `chain-enums.ts`) and updating every
     route to use it. Added migration
     `20260825010000_add_investigation_description.sql` (confirmed applied
     in prod via direct `psql` over `fly proxy`) plus updated `sync.ts` to
     actually persist `description` going forward.
   - Also fixed: `hazard_class` list-filter — frontend sends a
     comma-joined string (`"1,2"`), backend's Zod schema was a single
     `z.coerce.number()` that would silently fail on it; `min_bounty_wei`
     was accepted as a query param but never actually filtered on.

5. **Staleness — two-layer fix**, since the frontend never called any
   `/sync` endpoint (`refreshAfterTx` only did `qc.invalidateQueries`,
   which just re-reads whatever was already in Postgres):
   - **Eager sync (actor gets instant freshness)**: added
     `syncInvestigation`/`syncEvidenceForInvestigation`/`syncSellerBond`
     client functions to `apps/web/src/lib/api.ts`, called with the
     transaction's own `txHash` immediately after every confirmed write in
     `submit/page.tsx`, `hunts/[id]/page.tsx`, `seller/page.tsx` — before
     invalidating the react-query cache, so the refetch actually sees
     fresh data.
   - **Background resync (everyone else self-heals)**: added
     `resyncActiveOnChainState()` to `apps/api/src/lib/deadline-watcher.ts` —
     every tick, re-pulls every investigation not yet in a terminal status
     (and every seller bond linked to one) straight from chain, so a
     viewer who wasn't the one who triggered a change still sees it within
     one poll interval. Poll interval tightened from 60s → 20s default
     (`DEADLINE_WATCHER_INTERVAL_MS`) for tighter "as soon as possible"
     freshness at this investigation-count scale. Added matching
     `refetchInterval` (20-30s) to the landing page's stats/preview queries
     and the `/hunts` list query, which previously only refetched on
     refocus/remount.

6. **Infra reliability finding, unrelated to the code audit but discovered
   while testing it**: `recallraid-db`'s Postgres machine had been
   provisioned at `shared-cpu-1x` with only **256MB** memory (not enough
   for even light concurrent load) and had a `critical` `vm` health check
   (`cpu: system spent 2.69s of the last 10 seconds waiting on cpu`)
   essentially since creation — causing intermittent
   `"Connection terminated unexpectedly"` errors and real 503s on
   `/health` and other endpoints (confirmed via repeated live polling,
   ~40-50% failure rate at one point). **Fixed**: upgraded to
   `shared-cpu-2x` (512MB, 2 cores) via `fly machine update ... --vm-size
   shared-cpu-2x`. Confirmed after upgrade: all 3 health checks (`pg`,
   `role`, `vm`) passing, cpu-wait dropped from 2.69s/10s to under
   1s/60s, and the API held stable 200s across dozens of consecutive
   polls afterward. This directly serves the "must never die" 24/7
   requirement — the prior sizing was the actual latent cause of any
   future flakiness, not the application code.

All of the above verified against the **live production deployment**, not
just locally: rebuilt both apps (api: 26/26 vitest passing, `tsc` clean;
web: `tsc --noEmit` clean, `next build` clean, all 8 routes 200), redeployed
both (`fly deploy --app recallraid-api`, `vercel deploy --prod`), and
re-confirmed `/stats`, `/investigations`, `/evidence`, `/leaderboard`,
`/sellers/.../bonds` all return the exact shapes the frontend types expect,
CORS still correctly scoped, and the live contract's full method schema
(29 methods) cross-checked field-by-field against every frontend call site.

## Cross-agent API contract mismatches, found and fixed (2026-08-25)

`apps/web` and `apps/api` were built by two independent background agents
that never saw each other's code — each inferred the other side's contract
instead of it being specified up front. This produced real, silent bugs
that only surfaced once real traffic hit them (first spotted: the landing
page's "Live stats unavailable" error). Found by systematically diffing
every `apiFetch()` call site in `apps/web/src/lib/api.ts` against every
registered route in `apps/api/src/routes/*.ts`. Full list of what was
wrong and fixed:

1. **`GET /stats` didn't exist at all.** Landing page called it, backend
   never implemented it. Added `apps/api/src/routes/stats.ts` — a real SQL
   aggregate over `investigations_cache` (verified discoveries = settled +
   RECALL_CONFIRMED count, active threats = not-yet-terminal count, GEN
   distributed = sum of `bounty_wei * hunter_payout_bps / 10000` over
   settled rows), not a hardcoded/fake number.
2. **`GET /evidence?investigation_id=` didn't exist either.** The
   investigation detail page's evidence gallery called it; only
   `/evidence/upload-url` and `/evidence/:id/sync` existed. Added the
   missing list route.
3. **Every cache-backed list/detail response used the wrong shape.** The
   Postgres cache intentionally uses different column names than the
   contract (`investigation_id` vs `id`, `submitter_wallet` vs
   `submitter`, `created_at_chain` vs `created_at`, status/verdict stored
   as text labels for indexability vs the frontend expecting the
   contract's raw numeric codes) — but nothing translated between them at
   the API boundary, so real data would have rendered as `undefined`
   everywhere once any investigation existed (masked so far only because
   the contract has zero investigations on it yet). Added
   `apps/api/src/lib/serialize.ts` as the single translation boundary
   (`serializeInvestigation`, `serializeEvidence`, `serializeSellerBond`,
   `serializeLeaderboardRow`) plus reverse enum maps
   (`investigationStatusCode` etc.) in `chain-enums.ts`, and wired it into
   `investigations.ts`, `evidence.ts`, `reputation.ts` (`/leaderboard`),
   and `seller-bonds.ts` (`/sellers/:address/bonds`).
4. **`investigations_cache` was missing a `description` column entirely**
   (a deliberate-but-wrong call in the original migration's comment,
   reasoning "the contract already stores it" — true, but `GET
   /investigations` serves entirely from this cache with no per-row chain
   read, so it needed to be here too). Added via migration
   `20260825010000_add_investigation_description.sql` and wired into
   `sync.ts`.
5. **`GET /investigations/:id` returned `{investigation, evidence,
   challenges}` wrapped**, but `fetchInvestigation()` expects the bare
   `Investigation` object directly (the frontend fetches evidence
   separately via `fetchEvidenceForInvestigation`). Fixed to return the
   serialized investigation directly.
6. **`GET /leaderboard` and `GET /sellers/:address/bonds` returned
   `{total, items, ...}` / `{sellerBonds: [...]}` wrapped objects**, but
   `fetchLeaderboard()`/`fetchSellerBonds()` expect bare arrays. Fixed.
7. **The `hazard_class` list-filter param would have silently broken**:
   the frontend sends a comma-joined string of multiple values
   (`hazard_class.join(',')`) but the original Zod schema was
   `z.coerce.number()` (single value only) — "1,2" would coerce to `NaN`.
   Fixed to parse and filter a comma-separated list with `= any(...)`.
   Also wired up `min_bounty_wei`, which was accepted by the frontend's
   params type but silently ignored by the backend.
8. Also fixed two bugs in `apps/web`'s own upload flow while touching that
   code for the Cloudinary swap (see the Cloudinary section above):
   snake_case/camelCase field-name mismatch on `/evidence/upload-url`, and
   evidence uploads proceeding even when `investigationId` failed to parse.

**Lesson for future sessions**: when two apps are built by separate agents
against a shared contract inferred rather than specified, do NOT trust
"both sides compiled cleanly" as evidence the integration works — `tsc`
can't catch a wrong-shaped JSON response, since `apiFetch<T>` just casts
`res.json()` to `T` with no runtime validation. The only real check is
diffing actual call sites against actual route handlers, or an end-to-end
smoke test with real data flowing through — which is exactly what caught
this (a screenshot of a live error, not a build failure). If adding new
frontend↔backend surface area in future, verify the response shape
against the frontend's TypeScript type by hand, or better, share `packages/shared`
types between both apps instead of each side re-declaring its own guess.

## Evidence storage: swapped R2 → Cloudinary (2026-08-25)

User asked for Cloudinary instead of R2 (simpler credential setup — no
R2 API-token dance). Implemented:

- `apps/api/src/lib/r2.ts` deleted, replaced by `apps/api/src/lib/cloudinary.ts`
  — signed-upload pattern (backend signs `folder`/`public_id`/`timestamp`
  with SHA-1 per Cloudinary's documented algorithm, frontend POSTs
  multipart form-data with the file + signed fields directly to
  `https://api.cloudinary.com/v1_1/<cloud_name>/auto/upload`). This is a
  different shape than R2's presigned-PUT: Cloudinary's own response
  carries the final `secure_url` — the backend never knows the final URL
  in advance.
- `apps/api/src/routes/evidence.ts` updated accordingly; the
  `evidence_uploads_pending.r2_object_key` DB column was **kept as-is**
  (no rename migration) and now stores `<cloudinary folder>/<public_id>`
  — same role, different backing service, documented inline.
- Removed `@aws-sdk/client-s3` / `@aws-sdk/s3-request-presigner` from
  `apps/api/package.json` (uninstalled, not just left dangling).
- **Fixed two real pre-existing bugs in `apps/web` while doing this swap**
  (both were in the original agent-built upload flow, unrelated to the R2→
  Cloudinary change itself, but hit by the same code path): (1) the
  frontend was sending snake_case field names (`investigation_id`,
  `filename`, `content_type`) that didn't match the backend's Zod schema
  (`investigationId`, `contentType`, `declaredSizeBytes`, `fileName`) —
  the upload-url request would have failed validation every time; (2) the
  upload was being attempted for every file regardless of whether
  `investigationId` had been successfully parsed from the
  `submit_investigation` result, silently discarding evidence if parsing
  failed. Both fixed in `apps/web/src/app/submit/page.tsx` and
  `apps/web/src/lib/api.ts` alongside the Cloudinary swap.
- **Live-verified the exact shipped signing algorithm**, not just
  "no compile errors": ran a standalone Node script replicating
  `cloudinary.ts`'s signature logic byte-for-byte, POSTed a real 1x1 PNG to
  Cloudinary with the account's real credentials, got back HTTP 200 and a
  valid `secure_url`, then deleted the test asset via Cloudinary's destroy
  API. This is the same level of proof used for the contract
  ("could not load schema" was caught by actually running the tool, not by
  reading docs) applied to the upload path.
- Real Cloudinary credentials (cloud name `dy6eox1gn`) are set as Fly
  secrets on `recallraid-api` and in local `.env`/`apps/api/.env` (both
  gitignored). **Never put these in a file that gets committed or in any
  chat-visible log beyond this one-time exchange.**
- Env var names changed everywhere: `R2_ACCOUNT_ID`/`R2_ACCESS_KEY_ID`/
  `R2_SECRET_ACCESS_KEY`/`R2_BUCKET_NAME`/`R2_PUBLIC_BASE_URL` →
  `CLOUDINARY_CLOUD_NAME`/`CLOUDINARY_API_KEY`/`CLOUDINARY_API_SECRET`/
  `CLOUDINARY_UPLOAD_FOLDER`. Updated in root `.env.example`,
  `docs/ARCHITECTURE.md`, `docs/SECURITY.md`, `docs/DEPLOYMENT.md`,
  `apps/api/README.md`.
- Both apps rebuilt, retested (`apps/api`: 26/26 vitest still passing;
  `apps/web`: `tsc --noEmit` clean, `next build` clean) and **redeployed**
  to the same live URLs (`https://recallraid-api.fly.dev`,
  `https://recall-raid.vercel.app`) — no new addresses/URLs, same
  deployment identity, just updated code + secrets.

## DEPLOYED CONTRACT (live, 2026-08-25)

`GENLAYER_CONTRACT_ADDRESS = 0x34935D3d16a1Db83925117AEf95c045c2c197756` on
GenLayer StudioNet, deployed by the user. **Live-verified**, not just
assumed:

```
node scripts/verify_deployed_contract.mjs
✓ Contract schema loaded successfully. Method count: 29
✓ get_protocol_info() responded — challenge_stake_bps: 2000, challenge_overturn_bonus_bps: 1500,
  evidence_window_seconds: 259200, verdict_window_seconds: 172800,
  challenge_window_seconds: 172800, challenge_resolution_seconds: 172800,
  investigation_count: 0, seller_bond_count: 0, paused: false,
  admin: 0x7401c129EDfc26E68FE19309fE461eb3Db1058Eb
```

This confirms the exact "could not load contract schema" failure mode is
resolved on the real deployed instance, not just in the local linter. The
constants match this repo's contract source exactly, confirming the
deployed bytecode is this contract, not a stale/different version.

Wired into (never hardcoded elsewhere): root `.env` (gitignored, local
only), `apps/web/.env.local`, `apps/api/.env`. `scripts/verify_deployed_contract.mjs`
is a standalone read-only re-runnable check — run it again after any
future redeploy to confirm the new address before wiring it in.

**Note**: `apps/web`'s genlayer-js integration was independently built
against `genlayer-js@1.2.0`'s actual source, and this verification script
surfaced two real usage bugs while confirming the address: `getContractSchema`
takes the address as a plain string argument, not `{address: ...}` — worth
checking `apps/web/src/lib/genlayer-client.ts` doesn't repeat that mistake
if you see schema-load-shaped errors from the frontend specifically.

Persistent build log for this project. Read this first in any new session
before touching the code — it records decisions already made so they are
not re-litigated or silently reversed.

## Locked technical decisions (confirmed by user 2026-08-24/25)

- **Database**: PostgreSQL, self-hosted via Docker on Fly.io (not Supabase/Firebase).
- **Auth**: Wallet-based only (no email/password, no custodial wallets). MetaMask + WalletConnect + Coinbase Wallet via **Reown AppKit**. Reown project ID: `12f8ec749466943d20d79fc58594f9cd`.
- **Hosting**: Backend API on Fly.io (always-on machines — must never sleep/die, per explicit "24/7" requirement). Frontend on Vercel.
- **Object storage**: Cloudflare R2 for product photos / listing screenshots / evidence docs.
- **Frontend framework**: Next.js (App Router).
- **Socials**: none at launch (user explicitly said "no need for socials"). Do not build OAuth social linking unless asked again.
- **Contract network**: GenLayer Studio simulator (StudioNet), NOT Docker for the GenLayer side. User deploys the contract themselves and will hand back the deployed address — Claude must never deploy or ask to redeploy unnecessarily.

## Reference projects this build explicitly draws patterns from

Per user instruction, reuse (not copy) proven patterns from these sibling projects on this machine — each got strong review scores:

- `/Users/macbook/source-stake/contracts/veritine_contract.py` (560 pts) — dataclass-typed storage, four-prefix error taxonomy (`[EXPECTED]/[EXTERNAL]/[TRANSIENT]/[LLM_ERROR]`), ordinal-tolerance verdict banding, pull-payment `balances` ledger, prompt-injection defense wrapper around fetched content.
- `/Users/macbook/Witness-Weaver/` (480 pts) — monorepo layout (npm workspaces: apps/web, apps/api, packages/shared), backend is READ-ONLY against the chain (all writes signed client-side by the user's own wallet via genlayer-js — backend never holds a private key), `NEEDS_HUMAN_REVIEW`-style non-forcing verdict, settlement kept fully deterministic and separate from the nondet evaluation call.
- `/Users/macbook/Open-Web-Warranty-and-Recall-Escrow/` — zero-ledger-then-persist-then-transfer escrow chokepoint (`_send_gen`), `escrow_terms_wei` vs `escrow_deposited_wei` split, mutual-settlement + timeout-recovery exit paths, `docs/ESCROW_SECURITY.md` style documentation.

RecallRaid's own distinct contribution: combined investigation + Seller Clean Inventory Bond + challenge-window model applied specifically to marketplace recall/safety claims (not warranty claims, not generic fact disputes, not testimony bounties).

## Contract status

`contracts/recallraid_contract.py` — **written, py_compile clean, 1182 lines.**

Public write methods: `submit_investigation` (payable), `add_evidence`, `cancel_investigation`, `request_verdict` (nondet leader/validator pass), `claim_evidence_timeout`, `claim_verdict_timeout`, `open_challenge` (payable), `resolve_challenge` (nondet), `claim_challenge_timeout`, `settle_investigation` (deterministic, zero-then-credit), `withdraw` (the ONLY function that calls `_send_gen`), `create_seller_bond` (payable), `topup_seller_bond` (payable), `link_seller_bond`, `withdraw_seller_bond`, `set_paused`/`transfer_administration` (admin).

Views: `get_investigation`, `list_investigations`, `get_evidence`, `get_evidence_ids_for_investigation`, `get_challenge`, `get_seller_bond`, `get_balance`, `get_reputation`, `get_protocol_info`.

Key design choices worth remembering:
- `NEEDS_MORE_EVIDENCE` is a first-class verdict that **reopens the evidence window** rather than forcing a guess or leaving the contract in an undetermined/leader-rotation-thrash state — this directly answers the review team's "the contract should not be too strict" note.
- Verdict agreement requires an **identical ordinal verdict bucket** (no cross-bucket blur — a safety verdict shouldn't blur NO_ISSUE into RECALL_CONFIRMED) but tolerates up to 1500bps of confidence-score disagreement between leader/validator, so LLM phrasing variance alone doesn't trigger a re-round.
- Real web verification: `gl.vm.run_nondet_unsafe(leader_fn, validator_fn)`, leader fetches manufacturer/recall/marketplace URLs via `gl.nondet.web.render(url, mode="text")`, prompt explicitly wraps fetched content as untrusted data with an anti-injection instruction.
- Money: pull-payment `balances: TreeMap[Address, u256]` ledger — every payout path credits a balance, only `withdraw()` calls `_send_gen`. This avoids unbounded external calls inside one settlement (a single verdict can owe money to submitter, hunter, and a challenger).
- Seller bond slashing only fires on `RECALL_CONFIRMED` verdicts against a bond explicitly linked by the seller before any verdict existed (prevents retroactive bond attachment).

Structural test suite `contracts/tests/test_contract_structure.py` written and passing (7/7): verifies the full public write/view surface exists, the single `_send_gen` money-emission chokepoint is only called from `withdraw()`, no bare `Exception`/`RuntimeError`/`ValueError` is raised inside the contract class, and every `gl.vm.UserError` carries one of the four taxonomy prefixes. Run: `python3 -m unittest discover -s contracts/tests`.

**genvm-lint was installed and actually run** (2026-08-25): `pip install genvm-linter` (PyPI package name is `genvm-linter`, not `genvm-lint` — that's just the CLI command) in an isolated venv, since the system Python is externally managed. This caught two real bugs the earlier hand-written contract had, both of which are exactly the class of bug that produces a **"could not load contract schema"** error:

1. **`from genlayer import *` does NOT re-export `dataclass`** on the pinned runner. Every reference project's contract implicitly relied on this without it ever being validated in this environment. Fix: explicit `from dataclasses import dataclass` alongside the genlayer import. Without this the linter reports `Failed to load contract: name 'dataclass' is not defined` — this is almost certainly what a real "could not load contract schema" error looks like at deploy time.
2. **`gl.nondet.*` calls must be lexically inside the exact function object passed to `gl.vm.run_nondet_unsafe`** (nesting further inner functions is fine, but delegating to a separate `self.method()` is not — the linter's reachability analysis doesn't cross into arbitrary call graphs). The original contract built the LLM prompt (including three `gl.nondet.web.render` calls) via `self._build_verdict_prompt()` called *before* entering `leader_fn` — a real correctness bug too, since it meant the fetch happened once outside the nondet block rather than independently per validator. Fixed by moving the fetch+prompt-build+`exec_prompt` sequence fully inline inside `leader_fn` (with a nested `fetch()` closure), keeping only the pure deterministic string-formatting (`_render_verdict_prompt`) as an external helper.

After both fixes: `genvm-lint check contracts/recallraid_contract.py` reports **"✓ Lint passed (3 checks)" and "✓ Validation passed — Methods: 29 (12 view, 17 write)"**. This is the empirical proof the schema loads. Command: `/tmp/genvm_lint_env/bin/genvm-lint check contracts/recallraid_contract.py` (or install permanently: `python3 -m venv .venv && .venv/bin/pip install genvm-linter`).

genvm-lint also flagged a newer runner (`py-genlayer:1zr6nqk597d97kg0dyxg0shhrykx5v02zjgnyrajapy4wlqvfvwh`) as available. **Deliberately not adopted** — its SDK package couldn't be fetched in this sandboxed environment to verify compatibility, and switching pins without verification risks reintroducing the exact failure just fixed. The contract stays pinned to `py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6`, which is empirically verified. If you want the newer runner, run `genvm-lint check` yourself against it first and confirm "Validation passed" before switching — see the note in the contract's header comment.

Contract API surface was also cross-checked directly against live docs.genlayer.com pages (introduction, storage, types/dataclasses, first-intelligent-contract, examples/wizard-of-coin, examples/llm-hello-world, crafting-prompts, full-documentation.txt) and sdk.genlayer.com — confirmed `gl.vm.run_nondet_unsafe(leader_fn, validator_fn)` is the documented custom-agreement primitive (validator receives a `gl.vm.Return`), confirmed calldata natively supports plain Python `int`/`str`/`bool`/`bytes`/`Address`/`list`/`dict`-with-str-keys (wider than storage, which requires fixed-width types), and simplified `withdraw(amount_wei: int)` accordingly (previously over-engineered as a decimal-string parameter under a mistaken assumption that raw `int` wasn't valid calldata). Also switched `Address` serialization in every view from an unverified `.as_hex` attribute to `str(address)`, which is guaranteed via Python's normal string protocol.

`contracts/tests/live/studionet_suite.mjs` is documented (`contracts/tests/live/README.md` has the full 10-step scripted sequence) but not yet implemented — it should reuse `apps/web/src/lib/genlayer-client.ts` once that integration layer lands rather than reimplementing RPC calls separately.

## App scaffolding status

Delegated to two background agents (spawned 2026-08-25):
1. **apps/api** — **DONE (2026-08-25).** Fastify + TS, `pg` (no ORM), plain-SQL
   migrations run via `src/db/migrate.ts`. Read-only GenLayer client
   (`src/lib/genlayer.ts`, `genlayer-js`, studionet) — never imports a
   signer, never calls `writeContract`. R2 presigned-upload helper
   (`src/lib/r2.ts`). Wallet challenge/nonce/signature auth
   (`src/lib/auth.ts`, `ethers.verifyMessage`) issuing a JWT session cookie.
   Cache tables: `investigations_cache`, `evidence_cache`,
   `challenges_cache`, `seller_bonds_cache`, `notifications`,
   `tx_status_log`, `leaderboard_cache`, `login_nonces`, `users`,
   `evidence_uploads_pending` (staging row for R2 uploads before an
   on-chain evidence_id exists). Routes mirror the contract's exact view
   methods and write-method names for `kind`/sync purposes — see
   `apps/api/README.md` for the full endpoint table. Background
   `deadline-watcher.ts` polls pending tx receipts and sweeps upcoming
   deadlines for notifications — deliberately has no signer and never calls
   a write method, unlike the Witness-Weaver sibling project's
   heartbeat-wallet pattern, which this project's read-only requirement
   explicitly rules out. 26 unit tests (vitest) cover signature
   verification and the tx-status state machine transitions; `npm run
   build` and `npm run test` both pass. `Dockerfile` (multi-stage,
   non-root) and `fly.toml` (`min_machines_running = 1`,
   `auto_stop_machines = "off"` — always-on, per the 24/7 requirement) are
   in place. Root-level `docker-compose.yml` added for local Postgres dev
   only. Not yet done: no live integration test against a deployed
   contract (none was available to test against yet), and production
   migrations haven't been run against a real Fly Postgres instance.
2. **apps/web** — Next.js App Router on Vercel, Reown AppKit wallet connect, pages ported from the four HTML prototypes in `~/Documents/TO DO/recallraid/` (landing, active-hunts, submit-evidence, investigation detail) plus a leaderboard and seller dashboard page not covered by the prototypes.

Check agent completion status and this file's own edit history before assuming either is finished — update this section when they land.

## Things NOT to do (explicit user/review-team constraints)

- Do not build another "AI gives advice/summary" product with GenLayer bolted on — the contract must resolve a real outcome from real fetched evidence, never from user-submitted text alone.
- Do not make the contract's validator agreement checks strict-format-only (e.g. valid-JSON-only checks prove nothing) — agreement must be on the actual decision content.
- Do not deploy the contract myself — the user deploys and will hand back the address.
- Do not build social-account "type your username" fields — socials are OAuth-connection only, and are OFF at launch per the user's decision.
- Do not put large evidence files on-chain — only content hash + URL pointer.
