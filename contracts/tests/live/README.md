# Live StudioNet test suite

`studionet_suite.mjs` runs a scripted end-to-end sequence against a **real
deployed instance** of `recallraid_contract.py` on GenLayer Studio. It is
not a unit test — it costs real GEN (testnet/simulator GEN) and requires
funded accounts.

## Prerequisites

- Contract deployed to StudioNet (see `docs/DEPLOYMENT.md`) and its address
  in `GENLAYER_CONTRACT_ADDRESS`.
- Three funded StudioNet accounts set as env vars: `HUNTER_PRIVATE_KEY`,
  `SELLER_PRIVATE_KEY`, `CHALLENGER_PRIVATE_KEY`. Each needs enough
  simulator GEN to cover a bounty/bond/stake plus gas.
- `node >= 18`, `genlayer-js` installed (`npm install` at repo root covers
  this via the `apps/web` workspace dependency, or run `npm install
  genlayer-js` standalone in this directory).

## What it exercises, in order

1. Baseline reads: `get_protocol_info`, `get_investigation_count` — assert zero-state sanity before mutating anything (skip if the contract already has history).
2. Admin-only negative test: a non-admin account calls `set_paused(true)` and must be rejected.
3. Hunter submits an investigation with a real bounty (`submit_investigation`, payable) — assert the returned `investigation_id`, then `get_investigation` and confirm `status == OPEN`, `bounty_deposited_wei == bounty_wei`.
4. Hunter adds two evidence items (`add_evidence`) — assert `evidence_count` increments and `status` flips to `EVIDENCE_SUBMITTED`.
5. Seller creates a Clean Inventory Bond (`create_seller_bond`, payable) and links it to the investigation (`link_seller_bond`) — assert `get_seller_bond` reflects the deposit and `get_investigation` shows the linked `seller_bond_id`.
6. Hunter requests a verdict (`request_verdict`) against two intentionally-controlled URLs (a stub page confirming a match and a stub recall notice) — assert the returned verdict is deterministic given the controlled fixtures and `status` moves to `VERDICT_REACHED` or back to `EVIDENCE_SUBMITTED` if `NEEDS_MORE_EVIDENCE` was returned (retry evidence once in that case, matching real usage).
7. Challenger opens a challenge with the exact required stake (20% of bounty, computed from `get_protocol_info().challenge_stake_bps`) — assert an off-by-one wei stake is rejected before submitting the correct one.
8. Resolve the challenge (`resolve_challenge`) — assert the investigation returns to `VERDICT_REACHED` and a fresh `challenge_deadline` is set.
9. Wait for (or, on a fast local simulator, fast-forward if supported) the challenge window to elapse, then `settle_investigation` — assert `bounty_deposited_wei` becomes `"0"`, `status == SETTLED`, `settled == true`, and the correct party's `get_balance` increased.
10. Re-read everything and assert **no double-settlement is possible**: call `settle_investigation` again and confirm it raises `[EXPECTED] investigation already settled`.

## Running

```bash
node contracts/tests/live/studionet_suite.mjs
```

The script exits non-zero on any assertion failure and prints a step-by-step
log so a failure is traceable to the exact contract call that misbehaved.

Note: this repo intentionally does not commit a working `studionet_suite.mjs`
implementation yet — it should be written against the actual `genlayer-js`
client API once `apps/web`'s `src/lib/genlayer-client.ts` integration layer
(built in parallel) has confirmed the exact working call shape for payable
writes and nondet-backed methods against the currently pinned GenVM runner.
Wire this suite up to reuse that same client module rather than
reimplementing the RPC calls a second time.
