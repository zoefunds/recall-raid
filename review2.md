# Review follow-up — functional challenge completion in the application

## Review received

> The requested challenge completion actions are still not functional through
> the application: after a challenge is opened, the app refreshes only the
> investigation while the new controls depend on a challenge-cache record that
> this flow never creates.

## Root cause

`open_challenge` creates two related on-chain state changes:

1. it updates the investigation with `open_challenge_id`; and
2. it creates a separate `Challenge` record.

The investigation page refreshed only the investigation cache after a
successful `open_challenge` call. The Resolve Challenge and Claim Timeout
controls load their data from `challenges_cache`, so the page could observe
the new `open_challenge_id` but have no cached challenge record to render or
act upon.

There was also a shared client-side return-value issue: `callContractWrite`
returned the raw GenLayer receipt, while UI flows attempted to read contract
return values such as `challenge_id` from it. GenLayer nests those values in
the leader receipt payload.

## Fix implemented

### Decode contract return values centrally

`apps/web/src/lib/genlayer-client.ts` now decodes the leader receipt payload
(including the double-JSON encoding used by contract `json.dumps` return
values) and returns that decoded value from `callContractWrite`.

This makes returned IDs reliable for `submit_investigation`, `add_evidence`,
`open_challenge`, and `create_seller_bond`, instead of requiring each page to
interpret the raw receipt shape.

### Seed the challenge cache when a challenge opens

`apps/web/src/app/hunts/[id]/page.tsx` now:

1. obtains `challenge_id` from a successful `open_challenge` result;
2. calls `POST /challenges/:id/sync` through `syncChallenge`; and
3. invalidates the investigation and challenges queries after that sync.

The sync endpoint reads the contract's Challenge record into
`challenges_cache` and refreshes its parent investigation. The application
therefore has the data required to render and execute the permissionless
`resolve_challenge` action immediately, and `claim_challenge_timeout` once
the on-chain resolution deadline has elapsed.

If a future RPC response lacks a decodable return payload, the page still
refreshes the investigation as a safe fallback; the normal success path always
performs the challenge sync.

## Existing protections retained

- `resolve_challenge` and `claim_challenge_timeout` remain contract-enforced,
  permissionless actions.
- The timeout button is gated in the UI by the real `resolution_deadline` and
  independently rechecked by the contract.
- The earlier evidence changes remain intact: adjudication requires every
  evidence item to be checked, reachable, and content-hash verified.
- Verified seller-bond linking remains bound to the exact canonicalized
  marketplace URL under investigation.

## Verification and deployment

- `npx tsc --noEmit` in `apps/web` completed successfully.
- `git diff --check` completed successfully.
- API production deployment completed on Fly.io; both machines reported
  passing checks and `/health` returned `{"status":"ok","db":"ok"}`.
- Vercel production deployment completed and
  `https://recall-raid.vercel.app/hunts` returned HTTP 200.

No intelligent-contract redeployment was required for this fix because it
changes only the frontend's transaction-result decoding and cache-sync flow.
