# Historical Base Sepolia USDC milestone

This page records the milestone completed on 7 October 2026. It is a historical
implementation summary, not the current deployment guide. Its contract
addresses and earlier end-to-end transactions refer to the versions deployed
at that time. For current repository behavior and later security remediation,
see [Architecture](docs/ARCHITECTURE.md), [Security](docs/SECURITY.md),
[Deployment](docs/DEPLOYMENT.md), and the
[2026-10-17 live Base validation record](docs/e2e-evidence/live-base-security-branches.json).

## Milestone scope

The milestone separated product adjudication from value custody: GenLayer
handled investigation and evidence state while Base Sepolia USDC handled
bounties, challenge stakes, seller bonds, slashing, settlement accounting, and
claims. It established the first cross-chain workflow and three claimed live
scenarios. Those scenarios predate the later EIP-712 authorization and
registration changes. Their history must not be used as proof of the current
remediation path.

## Historical deployments

| Component | Historical value |
|---|---|
| Base Sepolia chain | `84532` |
| USDC | `0x036CbD53842c5426634e7929541eC2318f3dCF7e` |
| Escrow | `0x5D6426aA81583Fd795385952CB6d82A1Ed5a15F4` |
| Escrow deployment tx | `0xb60871d4e652d66cef7a3e66431a8ff1819ce24d662603369d3467681d731aa4` |
| GenLayer adjudicator | `0xa4e1D02aBaed368461870D1453d709d51183A119` |
| GenLayer deployment tx | `0x0a9929c10a80cf39d590ff108a09da6d7bf0ec7cb6e9cda5f9c0341971f50e51` |

These addresses are retained for audit/history only. Verify deployment and
source version before interacting with them. The current remediation
validation deployment is documented separately in `docs/DEPLOYMENT.md`.

## Capabilities delivered in the milestone

- Base USDC funding, challenge and seller-bond deposits, one-time settlement,
  seller-bond slashing, cancellation/timeout handling, and pull claims.
- GenLayer case metadata, evidence verification, adjudication, challenge
  re-adjudication, and a Base decision relay marker.
- API cache synchronization, wallet auth, transaction status, and settlement
  coordination.
- Frontend flows for Base funding and claims plus GenLayer investigation and
  evidence actions.
- Active Hunts backed by the API cache.

Subsequent changes added the EIP-712 decision-signer boundary, explicit Base
registration binding, per-challenger deposits, stronger API verification, and
orphan recovery. Consult `docs/SECURITY.md` for current controls and remaining
trust assumptions.

## Historical live scenarios

The 7 October milestone report recorded three settled and claimed cases:

1. Fisher-Price Rock 'n Play Sleeper, investigation 2, `0.50 USDC`,
   `POTENTIAL_ISSUE` at 65% confidence.
2. Peloton Tread+ Treadmill, investigation 3, `0.75 USDC`,
   `POTENTIAL_ISSUE` at 68% confidence.
3. Fisher-Price Rock 'n Play Sleeper, investigation 5, `0.50 USDC`,
   `POTENTIAL_ISSUE` at 62% confidence.

Their historical transaction hashes were retained in the original milestone
commit. They are omitted here to keep the current validation record distinct;
use chain explorers and the repository history to inspect them. Do not treat
this list as evidence for the updated Base registration or signer-authored
authorization rules.

## Later changes

The initial milestone used a 20% Base challenge stake, six-decimal USDC base
units, a seven-day StudioNet challenge window, and API-driven chain/cache sync.
Later work added browser-side Base network and funding checks, retry-safe
watcher relays, StudioNet network rechecks, and then the security remediation
described in current docs. Deployment names, addresses, environment values,
and remote service health can change; use `docs/DEPLOYMENT.md` and verify the
target environment before deployment.
