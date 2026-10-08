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
| RecallRaidEscrow | `0x5D6426aA81583Fd795385952CB6d82A1Ed5a15F4` |
| Base deployment tx | `0xb60871d4e652d66cef7a3e66431a8ff1819ce24d662603369d3467681d731aa4` |
| GenLayer adjudicator | `0xa4e1D02aBaed368461870D1453d709d51183A119` |
| GenLayer deployment tx | `0x0a9929c10a80cf39d590ff108a09da6d7bf0ec7cb6e9cda5f9c0341971f50e51` |
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

The `/hunts` Active Hunts feed reads these cases from the normal backend cache,
using the same cards and detail routes as user-created hunts. There is no
separate milestone page or hard-coded test-hunt section.

## Three live E2E scenarios

Completed on 7 October 2026. In every completed case, the Base contract stores
the exact finalized GenLayer adjudication transaction hash as its decision
proof. Each bounty was claimed after relay.

### 1. Fisher-Price cross-chain settlement (investigation 2)

- Product: Fisher-Price Rock 'n Play Sleeper
- Bounty: `0.50 USDC`
- Outcome: `POTENTIAL_ISSUE` at 65% confidence
- GenLayer adjudication: `0xfeb516b4a62faeb05c5a3e0af7aaf218d3b1fa36805dd5f4063bfdcee97cc28a`
- GenLayer settlement: `0x1b3a01ba56c715c777ddbef66bb3ce7a352f0567da4320781279baa1a96a509c`
- Base relay: `0xf4729bc128f9e8a24450136911b6a8549185be5e3dd8f45b8466cfe429a13952`
- Base claim: `0x3cbd50f04fbeb5d2db205790544bfccedb74a10094fa9b633303020ec78f40d2`

### 2. Peloton cross-chain settlement (investigation 3)

- Product: Peloton Tread+ Treadmill
- Bounty: `0.75 USDC`
- Outcome: `POTENTIAL_ISSUE` at 68% confidence
- GenLayer adjudication: `0xe5f04dc5b630fbbb323d84aedaae705d989e686a3569e76fb8537b025ecb5754`
- GenLayer settlement: `0xd8fc8e347b4c98c587de575bd1cf17535d2f3a9b641d35251e6078feb33ff02e`
- Base relay: `0xc26fafca76e1d95481b5bd6f809ef225adf16146a1162462133b1d00e291caed`
- Base claim: `0x550e8f865fd9d3486cd0a3fd32b4d28b22469d90c17b8d2df83fcfe1d7824313`

### 3. Independent Fisher-Price settlement (investigation 5)

- Product: Fisher-Price Rock 'n Play Sleeper
- Bounty: `0.50 USDC`
- Outcome: `POTENTIAL_ISSUE` at 62% confidence
- Case: `0x9141822015bf32736f981c2aca443dd4fe470eed08ee1b9b270f895432c88ad8`
- GenLayer adjudication: `0xa1bc2a2ba355160c2446ad41a5459b52214160a21a4f15b29c1d95bb2dd22336`
- GenLayer settlement: `0x758f073147564eeaba8515420a3d47a2dc98dc98dbb89a94eb6570aa00df868d`
- Base funding: `0xa7c194da67ca2638f7aa781c5b6e5bd10e0d301e4328e21505cd4eb7d87bdcee`
- Base relay: `0x9b5864cf16f8307582c12e534f18203d04f687399d3cb9a5f1dcd00461ea9ca2`
- Base claim: `0xc4fa639a4a0bea73fb4486a92997d463cb620ccc70da57ef350d384fefdc2d80`

The first attempt also exposed a public-RPC consistency race. The permanent E2E
harness now waits for two confirmations before a dependent transaction, which
prevents a second RPC backend from seeing a stale allowance or claimable value.

## Post-milestone frontend funding safeguard

Following an end-user submission test on 8 October 2026, the Base funding path
was made explicit and fail-closed. Before the wallet is asked to sign, the
frontend now verifies the live escrow's `usdc` token address, the connected
account, the available Base Sepolia USDC balance, and the presence of Base
Sepolia ETH for gas. It then switches (or adds and re-switches) Base Sepolia
and re-reads the active chain before sending either transaction.

Funding is a two-transaction sequence: USDC `approve` followed by escrow
`fundInvestigation`. The UI now reports each stage, waits for a successful Base
receipt, and keeps direct BaseScan links for both hashes after the escrow
deposit completes. A GenLayer submission is not attempted until that Base
deposit is confirmed.

## Verification commands

- `npm run compile:base` — passed
- `npm run build:api` — passed
- `npm run build:web` — passed
- Python syntax compile of the GenLayer contract — passed
- Three Base Sepolia + GenLayer E2E settlements — passed
- GenLayer deployment consensus — accepted with `MAJORITY_AGREE`

## Compare range

Milestone base: `fe45e9a` (the latest repository update before this work).
Implementation compare: [fe45e9a...e372aba](https://github.com/zoefunds/recall-raid/compare/fe45e9a...e372aba).
