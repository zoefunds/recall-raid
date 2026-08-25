# RecallRaid — Build Memory

## "Black box" evidence photo — real fix + a false lead (2026-08-25)

User reported the product photo on `/hunts/1` rendering as a solid black
box. Two things were true at once, and it's worth recording both clearly:

1. **Real bug, correctly fixed**: `apps/web/next.config.mjs`'s
   `images.remotePatterns` still only allowlisted the old R2 domains
   (`*.r2.dev`, `*.cloudflarestorage.com`) from before the Cloudinary
   migration — `res.cloudinary.com` was never added. This is a genuine
   bug that would silently break any real user's evidence photo. Fixed.
2. **Not actually why THIS photo was black**: investigation 1's specific
   "product photo" evidence item was the `TEST_PNG` constant from
   `scripts/full_contract_test_suite.mjs` — a deliberately trivial 1×1
   transparent pixel used only to exercise the upload pipeline during
   testing, never intended as a real visual asset. Confirmed by opening
   the raw Cloudinary URL directly — the browser tab title literally read
   "(1×1)". Stretched to fill a large gallery container, a 1×1
   transparent pixel against the dark theme is indistinguishable from a
   solid black box. This was never a rendering bug for that specific
   image — there was just no real image data behind it.

**Verified both are now resolved**: added a third real, visible evidence
photo (a generated 300×200 PNG, amber warning-triangle graphic, no
external deps) to investigation 1 via the actual upload pipeline
(Cloudinary signed upload → `add_evidence` → API sync), and confirmed via
screenshot in the live browser that it renders correctly. The original
1×1 test photo is still there (harmless, evidence is append-only) but the
gallery now also shows a genuinely visible image, proving the pipeline
and the domain-allowlist fix both work end-to-end.

**Separately answered**: user asked why a wallet other than the
submitter sees a "Request Verdict" button on this investigation.
Confirmed via source: `request_verdict` has no `msg.sender == submitter`
check — it's deliberately permissionless, same design as the
`claim_*_timeout` sweeps, since triggering the evaluation is "push the
public-evidence-anchored process forward," not a submitter privilege.
This is intentional, not a bug — flagged to the user as a product
decision to revisit only if they want it restricted (would need a
contract change + redeploy).

## Live test against `0xceE153ECE149AB35fA7D33e67Fa3aE00610061c6` — 52/53 pass (2026-08-25)

Redeployed after the consensus-detection fix, cache-upsert fix, and the
5-step verdict prompt, and re-ran the full suite. Result: **52 of 53
checks passed** — every negative test that was previously a false-negative
(due to the now-fixed `expectRevert` helper) now correctly passes, the
evidence-cache staleness bug is confirmed fixed live (`GET /evidence`
correctly returned both items under the right investigation id), and the
round-2 seller-bond-unlock fix was re-confirmed working end-to-end
(`linked_investigation_count` correctly hit 0 after cancellation, and
`withdraw_seller_bond` succeeded immediately after).

**The one remaining failure**: `request_verdict` pass 1 again hit
`MAJORITY_DISAGREE` (leader proposed `POTENTIAL_ISSUE` at 7000bps this
time — a different proposal than the previous round's `NEEDS_MORE_EVIDENCE`
at 9200bps, confirming this is genuine LLM output variance across
independent calls, not a deterministic code bug). The 5-step prompt
rewrite did not eliminate this — it can't, fully, without a temperature
control `exec_prompt` doesn't expose. **This is expected and safe**:
confirmed (again) that disagreement leaves contract state completely
unchanged, so this is a "call it again" situation, not a fund-safety or
correctness issue. Given the exact-match consensus rule is a deliberate,
audit-driven safety requirement, some residual disagreement rate on
genuinely ambiguous evidence (this test's fictional product against a
generic, non-matching CPSC homepage is about as ambiguous as it gets) is
the accepted cost of that safety property, not a defect to keep chasing
with more redeploys. Real submissions with real matching evidence should
see this far less often.

**Current status: this is very close to as good as this contract gets on
the specific finding chain from the external audit.** All critical/high
fixes (unfunded bonus, bond lock, evidence allowlist, product-ID floor,
exact-match consensus) are live-verified. The two structural blockers the
auditor named (verified seller ownership, full UPC/GTIN cross-matching)
remain honestly unsolved and out of scope for further contract patching —
they need real external integration work, not another bug fix.

## Live test against audited revision + a real "Undetermined" report (2026-08-25)

Redeployed to `0xDEf26cD6fb90F8C881E6436b6c8785f038C42112` and ran the full
suite. Results and what they actually mean:

**request_verdict genuinely hit `MAJORITY_DISAGREE`** (shown as "Consensus
Result: Undetermined" in the GenLayer Studio explorer UI — same underlying
outcome, different display label) on the very first live test after the
round-3 exact-match fix. This is the trade-off explicitly called out when
that fix landed: requiring exact agreement (correctly, per the audit) means
genuinely ambiguous cases can fail to reach consensus more often than the
old (unsafe) tolerant version did. **Confirmed safe**: `get_investigation`
immediately after showed `status=1` (still EVIDENCE_SUBMITTED, unchanged)
— GenVM correctly applied zero state change on disagreement. No funds
moved, nothing corrupted; the caller can simply call `request_verdict`
again. Real mitigation applied (not a full fix — LLM stochasticity can't be
eliminated, and `exec_prompt` doesn't expose a temperature parameter to
pin down): rewrote the verdict prompt's decision section from an
open-ended "form your own impression" instruction into a strict 5-step
decision procedure with explicit confidence-score ranges per step, so
independent validators have much less room to land on different
categorical answers for the same evidence.

**Two real, separate bugs found and fixed while investigating this**,
neither of which was the contract's fault:

1. **Frontend was checking the wrong field for consensus failure.**
   `callContractWrite` in `apps/web/src/lib/genlayer-client.ts` checked
   `receipt.status` for the string `"UNDETERMINED"` — but `status`/
   `status_name` ("FINALIZED", "PENDING", etc.) and the consensus RESULT
   (`result_name`: "AGREE"/"MAJORITY_DISAGREE"/"UNDETERMINED"/etc.) are two
   completely separate fields. The check could never match, meaning **a
   genuine consensus disagreement was being reported to the user as
   "Confirmed"** even though nothing was decided. Fixed to check
   `result_name` against the actual `AGREE`/`MAJORITY_AGREE` values,
   surfacing a clear "validators could not reach consensus — safe to
   retry" message instead.
2. **API cache upserts never updated foreign-key-ish columns on
   conflict.** `syncEvidence`/`syncChallenge`/`syncSellerBond` in
   `apps/api/src/lib/sync.ts` only updated "mutable ledger" fields on
   `ON CONFLICT`, leaving `investigation_id`, `submitter_wallet`, etc.
   stale. Harmless in a real single-deployment production setting (those
   values never actually change for a given ID there) but broke visibly
   across my repeated redeploy-testing cycles, since evidence/challenge/
   bond IDs restart at 1 with every fresh contract address — evidence
   for investigation 1 was being cached under a stale investigation_id=2
   left over from an earlier test round against a different contract.
   Fixed all three upserts to fully replace every column on conflict, not
   just the "obviously mutable" ones. Verified live: re-syncing after the
   fix immediately corrected the stale rows.

Both fixes deployed. Contract prompt change requires yet another redeploy
(the pattern continues) before it can be verified live.

## External audit round 3 response (2026-08-25) — score 2,380 → 3,000 → 3,180, final verdict-agreement fix

Auditor confirmed round-2 fixes sound, found one more real hole in the
verdict agreement rule: the NEEDS_MORE_EVIDENCE-bridges-its-neighbor logic
still let a leader's determinate, fund-moving verdict (`NO_ISSUE` or
`POTENTIAL_ISSUE`) get committed merely because a validator said
`NEEDS_MORE_EVIDENCE` — since `gl.vm.run_nondet_unsafe` always commits the
LEADER's returned value regardless of what `validator_fn` computed
internally; the validator's role is strictly agree/disagree, it cannot
substitute a different value to store. The auditor's suggested fix ("if
either side returns NEEDS_MORE_EVIDENCE, store NEEDS_MORE_EVIDENCE") is
not actually implementable at this layer — there is no way to make the
stored result something other than the leader's proposal.

**Real fix**: removed ordinal tolerance entirely. `_verdicts_agree` now
requires `order_a == order_b` unconditionally — leader and validator must
land on the literal same verdict bucket, full stop. Removed the now-dead
`VERDICT_TOLERANCE_STEPS` constant (three real audit rounds of stale-
comment findings made it not worth leaving a misleading always-1 constant
around). A leader/validator mismatch is not a bug under this rule — it
means the round didn't reach consensus and GenVM's own leader-rotation
handles it, which is the correct behavior for a fund-moving decision that
two independent parties didn't actually agree on.

Trade-off, stated plainly: this reintroduces the original round-1 concern
(exact-match-only can cause more `MAJORITY_DISAGREE`/retry rounds on
genuinely borderline confidence cases) — but given the auditor's
consistent, correct position that exact agreement is required for every
fund-moving outcome, and that there is no safe way to build "smart"
tolerance on top of `run_nondet_unsafe`'s commit-the-leader's-value
semantics, this is the right trade to make. A disagreement/retry costs
gas and time; a wrongly-committed verdict costs someone's GEN.

All 11 structural tests pass (one rewritten to match the new rule,
`test_verdicts_agree_requires_exact_bucket_match`), compiles clean, lints
clean. Still open per the auditor: no live StudioNet run against this
exact revision yet (next step), and verified seller/listing ownership
remains unsolved (out of scope, honestly documented).

## External audit round 2 response (2026-08-25) — score 2,380 → 3,000, three more fixes applied

Auditor confirmed the round-1 critical/high fixes (unfunded bonus, bond
lock) landed correctly in source, and raised new/refined findings against
the fixed version:

1. **P1, fixed** — the round-1 tolerance relaxation (`VERDICT_TOLERANCE_STEPS = 1`,
   any adjacent bucket agrees) was itself unsafe: a leader `RECALL_CONFIRMED`
   could agree with a validator `POTENTIAL_ISSUE` (1 step apart) and still
   slash a seller bond, without the validator ever confirming a recall.
   Fixed: `_verdicts_agree` now only allows tolerance to bridge
   `NEEDS_MORE_EVIDENCE` with its immediate neighbor — any two *different*
   determinate, fund-moving verdicts require an exact match, full stop.
   New structural test:
   `test_verdict_tolerance_never_bridges_two_determinate_verdicts`.
2. **P1, partially fixed (honestly scoped)** — "product identification is
   still too weak for a recall verdict" (URL + LLM interpretation alone
   isn't precise enough to justify slashing a bond). Did NOT implement
   full UPC/GTIN/regulator-recall-ID cross-matching this round (would need
   new contract fields + a schema migration + frontend changes — real
   future work). Did implement a deterministic floor: `_stable_verdict`
   now refuses to let `RECALL_CONFIRMED` stand for any submission with
   neither a `model_number` nor a `serial_number` at all, downgrading to
   `NEEDS_MORE_EVIDENCE` instead. Also strengthened the verdict prompt
   itself to explicitly require model/serial matching, not just same-brand
   matching. New structural test:
   `test_recall_confirmed_requires_a_product_identifier`.
3. **P2, fixed** — the `CHALLENGE_OVERTURN_BONUS_BPS` constant's comment
   still claimed the bonus came from "the seller bond if present, else
   protocol treasury" — stale from before the round-1 fix. Corrected to
   describe the actual bounty-pool-carve-out mechanism.
4. **P1, still open, not attempted this round** — verified seller/listing
   ownership. Auditor confirmed the honest-copy fix from round 1 addressed
   the *claim* but not the underlying mechanism. This remains the largest
   gap between "interesting demo" and real marketplace infrastructure;
   solving it needs real marketplace OAuth/signed-challenge integration,
   out of scope for a contract-focused round.
5. **P0, still open** — no live StudioNet run has validated this exact
   contract revision yet (auditor is correct that this is required before
   any production-readiness claim). This is the very next step: redeploy
   and re-run `scripts/full_contract_test_suite.mjs` against the new
   address, specifically re-checking the tightened agreement rule and the
   product-identifier guardrail don't cause unwanted NEEDS_MORE_EVIDENCE
   thrash on legitimate cases with real model numbers.

All fixes compile clean, pass all 11 structural tests (2 new ones added
this round), lint clean. `docs/SECURITY.md` updated with both the fix
descriptions and what's still explicitly NOT solved (product-ID
cross-matching beyond the floor, seller ownership verification).

## External audit response (2026-08-25) — economic/security hardening, not runtime bugs

User got an external audit scoring the repo 2,380/4,000. Findings and
what was actually done about each:

1. **Critical, fixed** — the challenge-overturn bonus (15% of stake) was
   manufactured from nothing: credited to the challenger with no matching
   debit anywhere, which could make total credited balances exceed the
   contract's real GEN (an insolvency risk). Fixed: the bonus is now
   carved directly out of `inv.bounty_deposited_wei` (capped at whatever
   remains in that pool) before being credited — a real debit backs every
   credit. Since "overturned" means the original submitter's claim was
   proven wrong, it is fair that their own escrowed bounty funds the
   correction rather than the protocol minting new value.
2. **High, fixed** — `linked_investigation_count` was incremented by
   `link_seller_bond` but never decremented anywhere, so any linked bond
   became permanently non-withdrawable forever (contradicting
   `withdraw_seller_bond`'s own zero-count requirement). Fixed: added
   `_unlink_seller_bond_if_present()`, called from all four terminal
   investigation transitions (`cancel_investigation`,
   `claim_evidence_timeout`, `claim_verdict_timeout`,
   `settle_investigation`) — confirmed via a structural test
   (`test_seller_bond_unlinked_on_every_terminal_path`) that all four
   actually call it.
3. **High, addressed via honest disclosure, not a false claim of fixing
   it** — the contract cannot verify a bond owner actually controls the
   marketplace listing it gets linked to. Building real storefront-
   ownership verification (OAuth to the marketplace, a signed challenge)
   is real future work and was not attempted this round. Instead: the
   `SellerBond` dataclass, `link_seller_bond`, and the seller dashboard UI
   copy were all updated to explicitly say "voluntary third-party safety
   bond, not verified seller-backed accountability" rather than implying
   verified ownership.
4. **High, partially fixed** — evidence-source trust. Added
   `AUTHORITATIVE_RECALL_DOMAINS` (CPSC, NHTSA, FDA, FSIS, EU Safety Gate,
   UK OPSS, Health Canada, Australia ACCC) and a `submit_investigation`-
   time validation that `recall_source_url`, if provided, must match one
   of them — it's the one field the prompt describes to the LLM as an
   authoritative recall confirmation, so it's the one field worth gating.
   `marketplace_url`/`manufacturer_url` remain unrestricted by design
   (genuinely arbitrary per listing/brand). NOT done this round: canonical
   product-ID/UPC matching, durable evidence snapshots beyond
   hash+URL, source-reputation scoring — documented as open gaps in
   `docs/SECURITY.md`, not silently ignored.
5. **Medium, fixed** — verdict agreement required an exact ordinal-bucket
   match between leader and validator (`VERDICT_TOLERANCE_STEPS = 0`),
   which the auditor correctly flagged as brittle for genuinely borderline
   cases. Raised to `1` — adjacent buckets (e.g. NEEDS_MORE_EVIDENCE vs
   POTENTIAL_ISSUE) can now agree, while the two opposite conclusions
   (NO_ISSUE vs RECALL_CONFIRMED, 3 ordinal steps apart) still can never
   blur together via tolerance alone.
6. **Medium, in progress** — "no tested live proof for the current source
   revision" was accurate at audit time. This round's fixes still need a
   fresh deploy + full live `full_contract_test_suite.mjs` pass before
   that claim can be retired — see the deploy-cycle log above/below this
   entry for the ongoing live-testing history.
7. **Medium, documented, not solved** — "the bounty is self-funded" is
   accurate: `HUNTER_DEFAULT_PAYOUT_BPS = 10000` means a hunter with no
   linked seller bond just gets their own bounty back on a confirmed
   verdict, no real profit beyond reputation. A genuinely funded
   counterparty (marketplace/insurer/treasury) is a product-economics
   redesign, not attempted this round — documented honestly in
   `docs/SECURITY.md` rather than left implicit.
8. **Medium, partially documented** — no circuit-breaker for a
   compromised allowlisted domain, no monitoring of
   NEEDS_MORE_EVIDENCE/UNDETERMINED rates, no independent third-party
   audit performed. Documented as open items in `docs/SECURITY.md`.

All five code-level fixes (1, 2, 4, 5, plus the honesty-copy change for 3)
compile clean, pass all 9 structural tests (2 new ones added specifically
for findings 1 and 2), and lint clean. **Still needs**: a fresh contract
redeploy (this changes contract behavior, so it's a new address, same as
every prior round) and a full live `full_contract_test_suite.mjs` pass —
per finding #6, structural tests proves the code shape, not GenVM runtime
behavior or economic invariants under real execution.

## CRITICAL round 4: `0x0D04E797bC40F62e631159663b5664186462D704` — round 3's snapshot fix was correct but incomplete (found 2026-08-25)

Confirmed round 3's storage-snapshot fix actually deployed correctly
(`genlayer code <address>` dump showed `evidence_snapshot`, no
`evidence_by_investigation` — verified the real deployed source, not
assumed) and `submit_investigation`/`add_evidence` both ran clean. But
`request_verdict` STILL produced `MAJORITY_DISAGREE`, with the exact same
"Reading storage in nondet mode" warning. That warning turned out to be a
red herring — pulled `receipt.consensus_data.votes` and each node's own
`result` field, which showed the *actual* cause: both the leader and a
validator independently raised
`gl.vm.UserError("[LLM_ERROR] model returned an unrecognized verdict label")`
— **this contract's own guard clause**, raised because the LLM's verdict
string didn't exactly match one of the four expected labels.

**Why that broke consensus rather than failing cleanly**: this raise
happens *inside* `leader_fn`/`validator_fn`, the closures handed to
`gl.vm.run_nondet_unsafe`. A `gl.vm.UserError` raised in normal
deterministic contract code produces a clean, comparable rejection —
but raised inside a nondet closure, it does not resolve to an agreed
"[LLM_ERROR]" outcome the way you'd hope; it manifested as `disagree`
votes instead. **Lesson: never raise inside a nondet closure, full stop
— always return a value, even a degraded/fallback one.**

**Fix**: `_verdict_label_to_code` no longer raises — an unrecognized label
now falls back to `VERDICT_NEEDS_MORE_EVIDENCE` (also now tolerates space/
hyphen variants like `"POTENTIAL ISSUE"`). The JSON-parsing branch in
`leader_fn` no longer raises either — invalid JSON, markdown-fenced JSON
(stripped defensively, same trick as the official WizardOfCoin example),
or a non-dict payload all degrade to `{"verdict": NEEDS_MORE_EVIDENCE,
"confidence_bps": 0}` instead of raising. Confirmed via grep: zero `raise`
statements remain anywhere inside `_run_verdict_pass`. This means even if
the model misbehaves identically on both leader and validator, they now
independently compute the *same* fallback dict and agree cleanly — the
failure mode that broke consensus is now structurally an agreement case
instead.

**Also fixed an operational issue found in the same test run**: the
deadline-watcher's 20s background resync (run independently on both Fly
machines) was hammering StudioNet's shared RPC hard enough to hit its
`500 requests/hour` cap, crashing the API's own `/investigations/:id/sync`
call with a real 500. Backed off `DEADLINE_WATCHER_INTERVAL_MS` to 180000
(3 min) via `fly secrets set` — the eager per-actor sync (unaffected by
this) still gives instant freshness for whoever performed the action;
the periodic sweep is only a safety net for other viewers and doesn't need
20s tightness at the cost of rate-limit exhaustion.

`0x0D04E797bC40F62e631159663b5664186462D704` needs replacing too — fifth
cycle. Higher confidence than prior rounds because this fix directly
targets the exact error string observed in the actual failed votes, not a
hypothesized mechanism. Once redeployed: re-run
`node scripts/full_contract_test_suite.mjs` (update `CONTRACT_ADDRESS`).

## CRITICAL round 3: `0xa7eB55895Fe2C527Cf0882855001f97af7c2e267` — DynArray bug is GONE, but found a real consensus-disagreement bug (found 2026-08-25)

Round 2's fix worked: `submit_investigation` and `add_evidence` both
executed with `execution_result: SUCCESS` and no stderr, confirmed live
(`investigation_count` incremented to 1, `get_investigation` returned the
full real record). Good news first, because the next part is another real
bug — this is exactly why "run the real test, don't just trust the fix"
mattered.

**The bug**: `request_verdict` (the nondet leader/validator pass) finalized
with **`result_name: MAJORITY_DISAGREE`** — validators did not agree on the
verdict. `execution_result` was `SUCCESS` (no crash) but alongside a
telling runtime warning:
```
/py/libs/genlayer/gl/_internal/storage.py:21: UserWarning: Detected pickling storage class. Reading storage in nondet mode is not supported
```
**Root cause**: `_run_verdict_pass(inv, evidence_items)` was passed a live
`Investigation` dataclass and a list of live `Evidence` dataclasses —
both storage-backed objects — directly into the closure handed to
`gl.vm.run_nondet_unsafe`. `_render_verdict_prompt` (called from inside
`leader_fn`) then read fields off those objects (`inv.product_name`,
`ev.evidence_type`, etc.) *during* nondet execution. Reading a
storage-backed object's fields inside a nondet closure is explicitly
unsupported by GenVM — different validators re-running the same closure
can get inconsistent pickled/unpickled state, which plausibly explains why
they built different prompts and got different LLM verdicts. Only the URL
strings had been snapshotted into plain locals before this; the
product/evidence fields were not.

**Fix**: `_run_verdict_pass` now snapshots every single value the prompt
needs — `product_name`, `brand`, `model_number`, `serial_number`,
`category`, `hazard_class_int`, `description`, and a plain
`evidence_snapshot` list of plain dicts (`type`/`description`/`url`/`hash`)
— into ordinary Python primitives *before* `leader_fn` is defined.
`_render_verdict_prompt`'s signature changed to accept only these plain
values, never `Investigation`/`Evidence` objects. Confirmed by grepping
the whole file: `gl.vm.run_nondet_unsafe` has exactly one call site in the
entire contract (inside `_run_verdict_pass`, shared by both
`request_verdict` and `resolve_challenge`), so this single fix covers
every nondet path that exists.

Also fixed two false-positive bugs in `scripts/full_contract_test_suite.mjs`
itself while diagnosing this (not contract issues): (1) the write-receipt
decoder was reading the wrong field — the method's actual JSON return
value lives at `consensus_data.leader_receipt[<mode=leader>].result.payload.readable`
(double-JSON-encoded), not the top-level `receipt.result` (an unrelated
internal numeric code); (2) `consensus_data.leader_receipt` holds every
node's receipt for the round (leader *and* validators, keyed by `mode`),
and a validator showing `execution_result: ERROR` with
`"Validator execution cancelled after quorum"` is GenVM's own
short-circuit optimization once enough validators already agree — not a
failure. The test suite now checks the leader's result specifically, and
separately flags real consensus problems (`MAJORITY_DISAGREE`,
`DISAGREEMENT`, `TIMEOUT`, `UNDETERMINED`) as `consensusHealthy: false`.

`0xa7eB55895Fe2C527Cf0882855001f97af7c2e267` needs replacing too. This is
the fourth deploy cycle — each one has fixed a genuinely different bug
class (direct DynArray construction → inmem_allocate nested-value bug →
nondet storage-read consensus disagreement), each only findable by
actually executing the method live. No further `TreeMap`/`DynArray`
nested-value patterns or nondet-adjacent storage reads remain anywhere
in the contract (both swept exhaustively). Once redeployed, re-run
`node scripts/full_contract_test_suite.mjs` (update `CONTRACT_ADDRESS`).

## CRITICAL round 2: `0xC36e1D9E8F7b88DC632EBB7bf2F1f57eceE84dd3` is ALSO broken — same root cause, deeper layer (found 2026-08-25, during full method test suite)

The redeploy that fixed round 1's `DynArray[u32]()` direct-construction
error was itself still broken: replacing it with the docs-recommended
`gl.storage.inmem_allocate(DynArray[u32])` hit a **second, deeper runtime
bug** on this pinned GenVM runner, confirmed via an actual failed
`submit_investigation` transaction against `0xC36e...`:
```
File "/contract.py", line 558, in submit_investigation
  self.evidence_by_investigation[inv_id] = gl.storage.inmem_allocate(DynArray[u32])
File ".../genlayer/py/storage/__init__.py", line 50, in inmem_allocate
  init(instance, *init_args, **init_kwargs)
TypeError: _GenericAlias.__init__() missing 1 required positional argument: 'args'
```
`inmem_allocate` itself is broken for allocating a bare `DynArray[u32]`
value with zero constructor args on this pinned runner, at least when the
allocated value is meant to live as a value inside another TreeMap (the
docs' own worked example was for a *generic dataclass* with real
constructor args, e.g. `Gen[bytes]` with `b'Ada', datetime.now()` — not a
zero-arg built-in container).

**Real fix, not another incantation guess**: removed the nested
`evidence_by_investigation: TreeMap[u32, DynArray[u32]]` field entirely.
Replaced with a single flat top-level `evidence_ids: DynArray[u32]` (same
pattern as the already-proven-safe `investigation_ids`/`seller_bond_ids`
fields — confirmed safe because `investigation_ids.append(inv_id)`
executed successfully in both failed test runs, right before the crash),
plus a `_evidence_ids_for_investigation()` helper that linear-filters by
reading each `Evidence.investigation_id`. Every call site
(`add_evidence`, `request_verdict`, `resolve_challenge`,
`get_evidence_ids_for_investigation`) updated to use it. This avoids the
nested-generic-value allocation path entirely rather than fighting its
exact required incantation on this runner version.

**Full-contract sweep performed before asking for a third redeploy**:
grepped every remaining `TreeMap`/`DynArray` declaration in the file —
confirmed every one left is either a top-level auto-materialized field or
has a plain non-generic `@allow_storage @dataclass` value type
(`Investigation`, `Evidence`, `Challenge`, `SellerBond`, `ReputationScore`,
or a primitive `u256`) — never another nested generic container value.
Plain dataclass construction via ordinary `ClassName(...)` call syntax
(no generic brackets) is confirmed safe at runtime — every write method
that constructs one succeeded in both failed test runs; only bare
`DynArray[T]`/`TreeMap[K,V]` construction is the forbidden runtime path,
whether attempted directly or via `inmem_allocate` in this nested-value
shape. Attempted to also verify this locally via `genlayer up`/`genlayer
init` (local Docker-based simulator) before spending a third live
redeploy, but the CLI hung at 98% CPU for 5+ minutes with zero Docker
container activity (likely stuck on an interactive prompt `yes` piped
input couldn't satisfy) and was killed rather than burn more time on it —
confidence in this fix instead rests on the source-level reasoning above,
which is strong (reuses an already-empirically-proven-safe pattern from
the very same contract, in the very same transactions that surfaced both
prior bugs).

`0xC36e1D9E8F7b88DC632EBB7bf2F1f57eceE84dd3` needs replacing too — same
"Claude does not deploy" rule applies. Once redeployed, re-run
`node scripts/full_contract_test_suite.mjs` (edit `CONTRACT_ADDRESS` at
the top) — it exercises all 29 methods (17 write, 12 view) across three
funded test roles (hunter/challenger/seller), real Cloudinary uploads,
real nondet web-fetch+LLM verdict passes, and syncs every state change
into the live API so it's visible on recall-raid.vercel.app.

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
