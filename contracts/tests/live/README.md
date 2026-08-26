# Live StudioNet testing

The plan originally described here — a `studionet_suite.mjs` living in
this directory — was superseded before it was ever written.
**The actual live end-to-end test suite is
[`scripts/full_contract_test_suite.mjs`](../../../scripts/full_contract_test_suite.mjs)
at the repo root.**

It runs every read and write method against a real deployed
`recallraid_contract.py` instance using three funded StudioNet test
wallets (hunter/challenger/seller), including real Cloudinary evidence
uploads, a real nondet verdict pass, a full challenge/resolution cycle,
and the seller-bond listing-verification flow. See the root
[`README.md`](../../../README.md#live-end-to-end-testing) for how to run
it, and [`memory.md`](../../../memory.md) for the full history of what it
has caught.

```bash
node scripts/full_contract_test_suite.mjs
```

There is also a separate, minimal diagnostic contract
(`contracts/diagnostics/nondet_consensus_diagnostic.py` +
`scripts/diagnostic_test.mjs`) for isolating a `gl.vm.run_nondet_unsafe`
consensus problem from application-code bugs, independent of RecallRaid
entirely — see the root README's "Debugging nondet consensus" section.
