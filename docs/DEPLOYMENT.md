# Deployment and operations

This is the canonical RecallRaid testnet deployment record as of October 18,
2026. Dated JSON files under `docs/e2e-evidence/` are immutable execution
records; superseded rollout snapshots are intentionally not repeated here.

RecallRaid is deployed on GenLayer StudioNet and Base Sepolia. These are
testnet deployments, not production financial infrastructure.

## Current public configuration

| Component | Current value |
|---|---|
| Public frontend | `https://recall-raid.vercel.app` |
| Vercel deployment | `dpl_9f4swrixEisMkUUn14hhvbGKeHf5` |
| Public API | `https://recallraid-candidate-api.fly.dev` |
| Public API image | `deployment-01M564HVPZA6F8N6ESYG4GGV3D` |
| GenLayer network | StudioNet, chain `61999` |
| GenLayer contract | `0xfAc47CB7eEbF95f3d043A0cd8112ecdb24486ecA` |
| Base network | Base Sepolia, chain `84532` |
| Base escrow for new cases | `0xBf74703d38cc83DE796B174efFdC02FaD69dE0dB` |
| Base escrow deployment tx | `0x7a095758a6aa678d235103a54c31e468be043bb6d2f2cb6b944b17ccef433ed8` |
| Base Sepolia USDC | `0x036CbD53842c5426634e7929541eC2318f3dCF7e` |
| Owner and relayer | `0xE3F1A34307349be94f3657276ebcF51eaB810730` |
| Independent decision signer | `0x6C76E71a9AeEBE3A79D1b078122D2c42dC69Cd4C` |

The frontend, candidate API, hardened GenLayer contract, and bonus-aware Base
escrow are the only configuration for new public registrations. The separate
`recallraid-usdc-api.fly.dev` service is version-pinned to the legacy escrow
only for historical settlement. It must not be used for new cases.

## Deployed escrow equivalence and economics

The current escrow exposes `BPS_DENOMINATOR = 10000` and
`CHALLENGE_OVERTURN_BONUS_BPS = 1500`. A challenge requires a 20% stake. A
successful overturn returns that stake, pays the challenger 15% of the funded
bounty, and pays the ordinary bounty recipient the remaining 85%.

At Base Sepolia block 48,257,048, `contracts/base/verify.mjs` compiled the
checked-in source with optimizer runs 200 and `viaIR`, masked only the
compiler-reported immutable references, and produced identical compiled and
deployed runtime hashes:

`0xa6f7e6b088719cd96c7ec6b4ff0532a3f184257d5a8061d31233d494f4ab20ea`.

The deployed runtime hash is
`0xf4a0dfbb23ac86463f6f4ef51581aa0fd47164d75204133c06b94efed2cdbb11`
and the checked-in source hash is
`0xac9b080d27653056fe9e777e35e4eb46f4619fe53afd47ade115b6699fa79dc7`.
The verification also checked the live USDC, owner, relayer, decision signer,
and bonus constants. See
[`e2e-evidence/base-escrow-source-equivalence-2026-10-18.json`](e2e-evidence/base-escrow-source-equivalence-2026-10-18.json).

The Foundry suite includes an exact 0.100 USDC bounty and 0.020 USDC successful
challenge test. It credits 0.035 USDC to the challenger and 0.085 USDC to the
ordinary bounty recipient, verifies 0.120 USDC total backing, completes both
claims, and verifies zero escrow residue.

## Public workflow evidence

The public application currently renders successor investigations 1, 2, and
3. Investigations 2 and 3 were browser-originated and funded with 1.000 and
0.500 USDC respectively.

Investigation 2 transactions:

- GenLayer submission:
  `0x2b081588ae852fed8f943903c87580f2d0564924d8938de4455676b5b3cd269b`;
- Base approval:
  `0x0dd4ff071cf30f5a1671bc66e7bc07d0fa7934bffc57c904de7d59cc1113c53c`;
- Base funding:
  `0x098582c8aaa5b8f53392138ac865e385ef87e5e7fac5b1f806ff82d2f823872e`;
- Base registration:
  `0x2bfd1770bd1c78714ac8412ae8b9cf3c924a979aad416ac2334a8ca1bbaac66b`.

Investigation 3 transactions:

- Base funding:
  `0x57c6db2683b2023d722c2fdd5de6033fa9d866333d48b66b3f31e1e55114455c`;
- Base registration:
  `0xab3f450b758fd69554e5197111ea1f2c6709cc3a76cd86ea5261499370c3d676`.

See
[`e2e-evidence/bonus-aware-rollout-2026-10-18.json`](e2e-evidence/bonus-aware-rollout-2026-10-18.json)
for the complete chain, API, deployment, and frontend record.

## Outstanding historical obligations

Existing Base registrations are immutable. They remain bound to the escrow and
GenLayer contract recorded when funded and must never be recreated or silently
rebound. All three obligations below are deliberately unsettled until their
contractual deadlines on October 24, 2026.

| Obligation | GenLayer contract / investigation | Base escrow | Deadline UTC | Required treatment |
|---|---|---|---|---|
| A239 historical case | `0xa239189c2921b592dBa1eccde830977edbfD1CB5` / `2` | `0x861d5D4E903805cbE283A86f08E10D031601774E` | `08:08:09` | Version-specific settlement; upheld stake follows legacy allocation |
| EDFF overturned case | `0xEDFFB4B4999D65A248441438233c18717515973d` / `3` | `0x861d5D4E903805cbE283A86f08E10D031601774E` | `10:31:44` | Settle original escrow, claim, then transfer the 15% legacy correction |
| Hardened-successor overturned case | `0xfAc47CB7eEbF95f3d043A0cd8112ecdb24486ecA` / `1` | `0x861d5D4E903805cbE283A86f08E10D031601774E` | `15:22:12` | Settle original escrow, claim, then transfer the 15% legacy correction |

The overturned 0.100/0.020 USDC cases must end with 0.085 USDC for the ordinary
bounty recipient and 0.035 USDC for the challenger. Because the immutable
legacy escrow returns only the stake, the guarded settlement runner records the
legacy claims and then transfers exactly 0.015 USDC from the bounty recipient
to the challenger. Published evidence must include the terminal GenLayer
transaction, retained `last_challenge_id`, EIP-712 payload, signer and relayer,
Base receipt, claims, correction transfer, and before/after USDC balances.

For A239, run the version-specific read-only preflight before any write:

```bash
node --env-file=apps/api/.env scripts/settle_legacy_a239_case.mjs
```

After its deadline, settle through the A239 administrator account and pass the
successful finalized GenVM transaction to the guarded relay:

```bash
genlayer account use eventweaver
genlayer write --rpc https://studio.genlayer.com/api \
  0xa239189c2921b592dBa1eccde830977edbfD1CB5 settle_investigation --args 2

RECALLRAID_A239_SETTLEMENT_TX_HASH=0x<finalized-transaction> \
  node --env-file=apps/api/.env scripts/settle_legacy_a239_case.mjs --relay
```

For EDFF and the hardened-successor case, use
`scripts/settle_studionet_base_e2e.mjs` with the exact recorded contract,
investigation, case id, API, and evidence file. The runner re-reads both chains,
enforces the deadline, validates challenge funding and retained challenge state,
obtains the exact EIP-712 authorization, submits through the relayer, performs
claims, applies a legacy correction only when required, and checks conservation.

## Key status

The diagnostic wallet
`0x551f5b8b2c517bfd780f2e005be2dd2754b7aa85` is permanently excluded from
operations. Its embedded private key was removed and Git history was rewritten.
Its remaining 998.795000000000001 GEN was transferred to the rotated role
wallet in finalized StudioNet transaction
`0x3159771506004c57508b7da5bf6f35915edea75e7311bd12eb54d47838abf275`.
The source balance is zero, and the wallet is not a GenLayer administrator or a
Base owner, relayer, or decision signer. See
[`e2e-evidence/diagnostic-wallet-recovery.json`](e2e-evidence/diagnostic-wallet-recovery.json).

## Deployment procedure

Keep private keys, JWT secrets, database credentials, and upload credentials in
provider secret stores. Never place them in `NEXT_PUBLIC_*` variables or Git.

For a new escrow deployment:

```bash
npm run compile:base
npm run test:base
npm run deploy:base
npm run verify:base
```

Update and deploy the public API before accepting registrations, then deploy
the frontend with the same GenLayer, escrow, USDC, and API values. The API
fails closed when Base and GenLayer bonus constants differ.

```bash
npm run test:api
npm run build:api
fly deploy --remote-only -a recallraid-candidate-api
curl https://recallraid-candidate-api.fly.dev/health

npm run build:web
vercel --prod --yes
```

After deployment, inspect public JavaScript assets for the exact GenLayer,
escrow, and API values; verify credentialed CORS, API/database health, Base and
StudioNet reads, browser-originated funding/registration, and public hunt
list/detail rendering.

## Evidence index

- Current escrow equivalence and allocation:
  [`base-escrow-source-equivalence-2026-10-18.json`](e2e-evidence/base-escrow-source-equivalence-2026-10-18.json)
- Current rollout and browser workflow:
  [`bonus-aware-rollout-2026-10-18.json`](e2e-evidence/bonus-aware-rollout-2026-10-18.json)
- Hardened successor challenge:
  [`hardened-successor-live-challenge.json`](e2e-evidence/hardened-successor-live-challenge.json)
- Historical A239 state and preflight:
  [`legacy-cache-cleanup.json`](e2e-evidence/legacy-cache-cleanup.json)
- Diagnostic wallet recovery:
  [`diagnostic-wallet-recovery.json`](e2e-evidence/diagnostic-wallet-recovery.json)
- Historical branch tests and limitations:
  [`live-base-security-branches.json`](e2e-evidence/live-base-security-branches.json)
