# RecallRaid Base Sepolia USDC Milestone

Completed on 7 October 2026.

## Scope delivered

RecallRaid now separates adjudication from value custody. All bounty funding,
challenge staking, seller bonding, escrow, slashing, settlement balances, and
claims execute in USDC on Base Sepolia. GenLayer is used only for live evidence
verification, verdict consensus, and challenge re-adjudication.

## Deployments

| Item | Value |
|---|---|
| Base Sepolia chain id | `84532` |
| USDC | `0x036CbD53842c5426634e7929541eC2318f3dCF7e` |
| RecallRaidEscrow | `0xce45b80019A59C153659f014bC74900d930A6886` |
| Base deployment tx | `0x3a1388328c4d23d1775e4c74a4d8e8cb31722feb65ae16a8773d18d8a6a76bd5` |
| GenLayer adjudicator | `0x193f060bc67A350B4158f52D403BCdd14151A835` |
| GenLayer deployment tx | `0x07ec2204e37d069573f98507a35e510b1e91361343f2e2e337a78bb671b0e830` |
| Deployer / relayer | `0x7401c129EDfc26E68FE19309fE461eb3Db1058Eb` |

The Base contract was compiled locally with Solidity optimizer settings of 200
runs. The GenLayer deployment reached `MAJORITY_AGREE` and was accepted in one
round.

## Contract implementation

`contracts/base/RecallRaidEscrow.sol` implements:

- one-time `fundInvestigation` deposits;
- USDC-funded challenges;
- independently funded and linkable seller bonds;
- relayer-only, one-time GenLayer decision settlement;
- no-issue refunds and confirmed/potential-issue hunter payouts;
- challenge stake routing based on whether the verdict was overturned;
- seller-bond slashing capped by both bond balance and bounty;
- relayed cancellation/timeout refunds;
- pull-based USDC claims protected by checks-effects-interactions and a
  reentrancy guard.

`contracts/recallraid_contract.py` no longer accepts payable bounty, challenge,
or bond calls. It records matching Base identifiers and declared USDC base-unit
amounts, performs evidence verification/adjudication, and exposes a Base relay
marker. GenLayer contains no user-value transfer path.

## Backend and database

The API now includes a Base Sepolia client that reads case escrow, wallet USDC,
and claimable balances and submits finalized adjudications with the relayer.
`POST /investigations/:id/relay` re-reads the final GenLayer state, selects the
first evidence submitter as the payout hunter, builds a deterministic decision
hash, and calls the Base contract. Duplicate Base finalization is rejected on
chain.

A migration adds `base_case_id`, `base_bond_id`, `base_tx_hash`, and
`relay_tx_hash` to the cache. Historical numeric columns retain their previous
database names for migration safety, but now store six-decimal USDC base units.

The previous Fly deployment is no longer referenced by source configuration.
The replacement resources are:

- API app: `recallraid-usdc-api`
- Dedicated Postgres: `recallraid-usdc-db`
- Account: `gideon820001@gmail.com`

`apps/api/fly.toml`, frontend defaults, local environment files, and deployment
documentation point to the replacement API.

## Frontend

The wallet configuration supports Base Sepolia plus GenLayer. Investigation
submission now approves and escrows USDC on Base before recording the case on
GenLayer. Challenge and seller-bond flows similarly fund Base first. The wallet
page reads actual USDC wallet/claimable balances and claims directly from the
Base escrow. All monetary labels and formatting use six-decimal USDC.

The `/milestone` route displays the three real E2E cases below with direct Base
Sepolia explorer links. No displayed case or transaction is placeholder data.

## Three live E2E scenarios

Run timestamp: `2026-10-07T14:04:13.991Z`. The test wallet began and ended with
`15.9 USDC`, proving that every funded amount was accounted for and reclaimed.

### 1. No-issue refund

- Product: Fisher-Price Rock 'n Play Sleeper
- Bounty: `0.50 USDC`
- Outcome: `NO_ISSUE`
- Case: `0x494a00ea51ca1e430729387ad77a498edeb4dc3922917838fa1e6b2e92ed0497`
- Fund: `0xf9a70755a0eecf03d73b82cdc728d0f6e84b9f9e516d95330de3f6faa47ff04f`
- Relay: `0x4cf36927ce009fee953df16ba45fd9684acb1f516ee8a6e936026bb3ae6d0966`
- Claim: `0x456001fadee3dc4421fbf98bf5904832130f2dcf618086c962c7e28d7344e933`

### 2. Recall confirmed with seller-bond slash

- Product: Peloton Tread+ Treadmill
- Bounty: `0.75 USDC`
- Seller bond: `0.50 USDC`
- Outcome: `RECALL_CONFIRMED`; `1.25 USDC` became claimable
- Case: `0xfd2282394ab4091d152044aa3c15f7ffa0dac7023a56fbb1bcb015aea3bcef53`
- Fund: `0x503361dad62cd161c3966099402f8374c8218dcd35fd093566196f3d3de6fa72`
- Relay: `0x1777c927e1ca69f9264299cd17567d821fae5c89a66efdf3e7bd89393e7f7a52`
- Claim: `0x25fa33c7d4d5377e7fa33336dc595ffecaa8a27a31ac586ca1f48cd71f0d8631`

### 3. Funded challenge overturned

- Product: Anker 535 Power Bank
- Bounty: `0.60 USDC`
- Challenge stake: `0.12 USDC`
- Outcome: `POTENTIAL_ISSUE`, challenge overturned; `0.72 USDC` became claimable
- Case: `0xbfc4a983b5e86e71e435288d3c66f6e2728d37c42355ff1f1f3222ff045d9b38`
- Fund: `0xd04c788c14baffbb720d8503f0b37d5e015abe896ba0b08c2ebf2559da009fdd`
- Relay: `0xc5288fbe2bf41a4a08e0d8aa0e91a047cead51f928867f8de17953428d122426`
- Claim: `0xdeeef085a9c0cd342df5cab0d5a9c55c33758a3dcee5f8bc19ab4ced8ca32590`

The first attempt also exposed a public-RPC consistency race. The permanent E2E
harness now waits for two confirmations before a dependent transaction, which
prevents a second RPC backend from seeing a stale allowance or claimable value.

## Verification commands

- `npm run compile:base` — passed
- `npm run build:api` — passed
- `npm run build:web` — passed
- Python syntax compile of the GenLayer contract — passed
- Base Sepolia three-scenario E2E — passed
- GenLayer deployment consensus — accepted with `MAJORITY_AGREE`

## Compare range

Milestone base: `fe45e9a` (the latest repository update before this work).
The final compare URL is recorded after the milestone commit is pushed.
