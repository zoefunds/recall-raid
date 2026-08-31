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

## Real-transaction Undetermined recurrence (2026-08-25) — root cause + fix

A REAL user wallet (not a test wallet) called `request_verdict` on contract
`0xceE153ECE149AB35fA7D33e67Fa3aE00610061c6` and got Consensus Result
`Undetermined` with Rotation Count 3. The leader's return value was
`{"verdict": "RECALL_CONFIRMED", "confidence_bps": 9000}` — a *confident*
determinate verdict, not an ambiguous one, yet validators still couldn't
agree. This ruled out "just normal ambiguous-evidence variance" (the
previously-accepted trade-off) — investigation 1's `recall_source_url` was
`https://www.cpsc.gov/Recalls`, CPSC's generic recall *listing* homepage,
which does not name this specific (test) product's model/serial number at
all. A 9000bps-confidence RECALL_CONFIRMED against that page is the model
hallucinating a match, and independent validator calls were each
hallucinating *differently* — some plausibly returning RECALL_CONFIRMED,
others not, hence 3 rotations and still no majority.

Fix (in `_run_verdict_pass`/`_render_verdict_prompt`,
`contracts/recallraid_contract.py`): added a deterministic,
non-LLM cross-check computed inside `leader_fn` itself —
`product_id_match = model_number.lower() in recall_text.lower() or
serial_number.lower() in recall_text.lower()` — computed from the SAME
already-fetched, already-nondet-safe plain-string `recall_text` snapshot
(no new storage reads, no new nondet call). This is injected into the LLM
prompt as a "PROGRAMMATIC FACT (non-overridable)" per GenLayer's own
documented pattern for grounding LLM judgments with programmatic facts,
explicitly telling the model it must not respond RECALL_CONFIRMED when the
fact is False. On top of that, a hard deterministic backstop after parsing
the LLM's JSON response downgrades any `RECALL_CONFIRMED` verdict to
`NEEDS_MORE_EVIDENCE` (capping confidence at 6000) whenever
`product_id_match` is False — this holds even if the model ignores the
prompt instruction, since it's plain string code, not a request to the
model. Since every validator computes this identically from their own
independently-fetched (near-identical, near-simultaneous) copy of the
recall page, the previously-hallucination-prone RECALL_CONFIRMED path now
converges deterministically to "no match → can't confirm" instead of each
validator guessing differently. Genuine matches (recall page actually
containing the model/serial number) still rely on LLM judgment for
severity/status, same as before — this only closes the false-positive
hallucination path, which is also the fund-safety-critical direction (a
wrongful RECALL_CONFIRMED is what slashes a seller bond).

Separately answered: the compact `Equivalence Principle Outputs` display
(`{"confidence_bps":9000"verdict":3}`, no comma) is the explorer's own
raw rendering of the small decision-signature dict `leader_fn` returns —
`{"verdict": int, "confidence_bps": int}` — which deliberately excludes
the LLM's free-form "reasoning" text on purpose (see `_verdicts_agree`
docstring): comparing full natural-language reasoning across independent
LLM calls would never allow exact-match consensus. This is by design, not
a malformed-JSON bug on the contract side; genvm-lint and the structural
test suite both still pass after this change.

Verified: `genvm-lint contracts/recallraid_contract.py` passes (3 checks),
`pytest contracts/tests/test_contract_structure.py` passes (11/11).
NOT yet verified against a live redeploy/real transaction — needs a fresh
deploy + `request_verdict` re-run against a recall source that both does
and does not contain the product identifier, to confirm both branches
converge cleanly in production.

## Live-verified on redeploy `0xc7609edA79f3d23af13d88112905530007Ce6EeD` (2026-08-25)

Re-ran the full live suite (`scripts/full_contract_test_suite.mjs`) after
wiring in this address (Fly secret, Vercel env, root/.env/apps/api/.env/
apps/web/.env.local, plus truncating the cache tables from the prior
contract address). Result: 52/53 checks passed. Confirmed the fix landed
correctly — `request_verdict` returned a legitimate `NO_ISSUE` at 7800bps
(not a hallucinated `RECALL_CONFIRMED`), consistent with all 3 sources
being reachable and none naming the product. The one remaining
`MAJORITY_DISAGREE` was investigated directly via
`gl.getTransaction(...).consensus_data.leader_receipt` — only 2 of the
round's nodes are exposed by genlayer-js: the leader (`NO_ISSUE`/7800bps)
and one validator whose entry was `"vote": "idle"` /
`"stderr": "Validator execution cancelled after quorum"`, meaning
consensus had already resolved to DISAGREE among other validators before
that one ran — genlayer-js does not surface the actual dissenting
validators' computed output, so root-causing beyond "some validator
disagreed" isn't possible from this API. Most likely explanation: each
validator fetches the 3 source URLs live and independently, so a
transient fetch failure for one validator (but not another) legitimately
changes its own `sources_checked_count`, sending it down a different
correct STEP in the prompt than another validator that fetched
successfully — an honest per-validator network race, not a logic bug.

## Second reaudit round (2026-08-25) — score 3,380/4,000, three more fixes

External audit confirmed both backstops as correct and validated in the
right direction, then flagged three remaining gaps, two of which are
fixed here:

1. **No regression tests for the new backstops** — added
   `test_recall_confirmed_deterministic_backstop_present`,
   `test_no_issue_deterministic_backstop_present`, and
   `test_product_identifier_match_uses_token_boundaries` to
   `contracts/tests/test_contract_structure.py` (source-slice assertions,
   same pattern as the existing `_verdicts_agree` test), plus a new
   `IdentifierBoundaryMatchingTests` class that actually *executes* a
   verbatim copy of the matching regex (can't import the real contract
   module outside GenVM) against the exact false-positive case the audit
   named. 18/18 structural tests now pass (was 11).
2. **Substring matching allowed prefix false-positives** (e.g. model "A1"
   matching inside "A10", "SC65" matching inside "SC650") — a real
   fund-safety-adjacent gap, since a false-positive product-ID match feeds
   directly into the `RECALL_CONFIRMED` backstop's decision. Fixed with a
   new `_identifier_present(haystack, identifier)` helper
   (`contracts/recallraid_contract.py`, near `_verdict_label_to_code`)
   using a case-insensitive regex requiring non-alphanumeric boundaries
   around the match (`(?<![a-z0-9])...(?![a-z0-9])`), so "VE-SC65" matches
   inside "VE-SC65-2024" (hyphen boundary) but not inside "VE-SC65X".
   `_run_verdict_pass`'s `product_id_match` computation now calls this
   helper instead of a bare `in` check.
3. **Not yet addressed**: seller/listing ownership verification — flagged
   by the auditor as "the main remaining product-grade blocker." This is
   a genuinely different scope of work (needs some external
   attestation/oracle for marketplace-listing ownership, not just
   contract-side logic) and hasn't been scoped or started; `docs/
   SECURITY.md`'s "Known limitations" section already documents this
   honestly as an unverified, voluntary bond. Revisit as a distinct task
   if the user wants to pursue it.

Verified after this round: `genvm-lint` passes (3 checks), 18/18
structural tests pass, `apps/api` build + 26/26 vitest tests pass.

## Live-verified on redeploy `0x33a7013d3FF0A632A241c4531549FE4D629a7D59` (2026-08-25)

Re-ran the full live suite after wiring in this address (Fly secret,
Vercel env, all 4 local env files, cache tables truncated again). Result:
52/53 checks passed — same count as the prior two rounds, but a
meaningfully different (and better) failure mode: `request_verdict`'s
leader landed on `NEEDS_MORE_EVIDENCE` at 4500bps (squarely inside STEP
5's 3000-6000bps range), not a hallucinated `RECALL_CONFIRMED` or a
premature `NO_ISSUE` on an incomplete check. Both backstops from the
prior round (deterministic RECALL_CONFIRMED downgrade, deterministic
NO_ISSUE-requires-3-sources downgrade) and this round's token-boundary
identifier matcher are confirmed holding across a second independent
redeploy — no regression. The remaining `MAJORITY_DISAGREE` is a
validator disagreeing with the leader's own already-conservative
NEEDS_MORE_EVIDENCE call — this is the accepted, irreducible category of
LLM interpretation variance on a genuinely ambiguous case (this specific
test scenario's fixed evidence sits right on that boundary), and it moves
no funds either way. Everything else (submit/cancel/evidence/bond/
withdraw flows, all negative guardrail tests, live API sync) passed
clean.

## Seller/listing ownership verification (2026-08-25) — real GenVM-backed proof

The last reaudit (3,380/4,000) named unverified seller/listing ownership
as "the main remaining product-grade blocker." Closed the largest part of
that gap with a real, GenLayer-native mechanism rather than a cosmetic
checkbox — the same trust pattern as a DNS TXT record or domain-
verification meta tag, applied to a marketplace listing:

- `SellerBond` (`contracts/recallraid_contract.py`) gained
  `verification_code: str`, `listing_url: str`, `listing_verified: bool`.
  `create_seller_bond` generates the code deterministically
  (`hashlib.sha256` over bond_id/seller/created_at) at bond creation —
  every validator computes it identically since bond creation is an
  ordinary deterministic write, not a nondet call.
- New write `verify_seller_bond_listing(bond_id, listing_url)`: the
  seller publishes their bond's code somewhere in the listing page's own
  visible text, then calls this. `leader_fn` does a real
  `gl.nondet.web.render(listing_url, mode="text")` fetch and checks for
  the code via `_identifier_present` (the same token-boundary matcher
  from the verdict-pass hardening); `validator_fn` re-fetches
  independently and consensus (`gl.vm.run_nondet_unsafe`) must agree
  before `listing_verified` flips to `True`. Only the bond owner can call
  it; an unreachable/non-matching page cleanly rejects
  (`[EXPECTED] verification code ... was not found`) rather than
  silently marking anything verified.
- **Honest scope, documented in the `SellerBond` docstring and
  `docs/SECURITY.md`**: this proves the bond owner controls the *content*
  of that specific listing page at verification time. It does NOT prove
  the underlying marketplace account's real-world identity (no KYC/
  business registration) — that needs an actual marketplace OAuth
  integration, out of scope here. It's also opt-in:
  `link_seller_bond` still doesn't require `listing_verified`, so an
  unverified bond remains possible and is exactly the pre-existing
  voluntary/unverified signal — the UI must not imply every bond is
  verified.
- `apps/api`: new migration
  `20260825020000_add_seller_bond_listing_verification.sql` adds the 3
  columns to `seller_bonds_cache`; `syncSellerBond`
  (`apps/api/src/lib/sync.ts`) and `serializeSellerBond`
  (`apps/api/src/lib/serialize.ts`) updated to carry them through;
  `ChainSellerBond` type (`apps/api/src/lib/genlayer.ts`) updated.
  `apps/api/src/lib/cloudinary.ts`'s `ALLOWED_CONTENT_TYPES` gained
  `text/html` — the same signed-upload pipeline used for evidence photos
  is reused (test-suite only, so far) to host a small real page a seller
  can point the verifier at when they don't already have a live listing
  handy.
- `apps/web`: seller dashboard (`apps/web/src/app/seller/page.tsx`) shows
  the verification code, a listing-URL input, and a "Verify Listing"
  button per unverified bond; a verified bond shows a "Verified Listing"
  badge with its confirmed URL instead. `SellerBond` type
  (`apps/web/src/types/contract.ts`) updated. NOT yet surfaced on the
  investigation/hunt detail page itself (only the seller dashboard) —
  worth adding as a follow-up if a hunter-facing view of a linked bond's
  verification status is wanted.
- `contracts/tests/test_contract_structure.py`: added
  `test_verify_seller_bond_listing_uses_real_consensus_web_fetch` and
  `test_create_seller_bond_generates_verification_code`, plus added
  `verify_seller_bond_listing` to the expected-writes set. 20/20
  structural tests pass. `scripts/full_contract_test_suite.mjs` gained a
  real end-to-end positive case (upload a small HTML page containing the
  bond's code via the reused signed-upload flow, verify succeeds) and a
  negative case (verifying against cpsc.gov, which doesn't contain the
  code, correctly rejects).

Verified: `genvm-lint` passes (3 checks), 20/20 structural tests pass,
`apps/api` build + 26/26 vitest tests pass, `apps/web` production build
succeeds.

## Live-verified on redeploy `0x45d31157cCB5ECD2d4b9AdE33f0a2B7BD2352658` (2026-08-26) — found and fixed a real bug

Full deploy cycle: Fly secret + `fly deploy` (needed this time, not just a
secrets restart, since `apps/api` code/migration changed) +
`node dist/db/migrate.js` on the machine (applied
`20260825020000_add_seller_bond_listing_verification.sql`) + Vercel env +
cache truncate + live suite run. Result: 57 checks run, 54 passed, 3
failed — the `request_verdict` failure is the same accepted residual
LLM-variance case as prior rounds (`NO_ISSUE` at 7700bps, MAJORITY_DISAGREE
on a genuinely ambiguous test scenario). The other two failures were BOTH
`verify_seller_bond_listing` — and this one was a real, distinct bug, not
LLM variance: the write's own positive case (real code correctly placed in
the test listing page) still got `MAJORITY_DISAGREE`.

Root cause, found by fetching the tx's own receipts directly
(`gl.getTransaction(...).consensus_data.leader_receipt[].genvm_result.stderr`):
`AttributeError: 'Return' object has no attribute 'get'` inside
`validator_fn`, at `leader_result.get("found")`. `gl.vm.run_nondet_unsafe`
passes the leader's returned dict into `validator_fn` wrapped in GenVM's
own `Return`-like object — it supports `[...]` subscript (proven by
`_verdicts_agree`'s `a["verdict"]` in the verdict-pass code, which has
always worked) but NOT `.get(...)`. `verify_seller_bond_listing` was the
one spot in the contract that used `.get()` instead of subscript, so
EVERY call to it — matching code or not — crashed inside the validator
and forced disagreement. The negative (no-code) test still showed
`leaderErrored: true` and got marked "correctly rejected" by
`expectRevert`, but that was a false-positive pass: `expectRevert` only
checks `leaderErrored`, not `resultName` or the actual error message, so
it couldn't tell "correctly rejected for the right EXPECTED reason" apart
from "crashed and disagreed for an unrelated bug." Fixed both: the
contract now uses `candidate["found"]`/`leader_result["found"]`/
`result["found"]` (subscript, not `.get`), and the test script's negative
case now explicitly asserts `errorDetail` contains "verification code" —
a `leaderErrored` check alone is not sufficient evidence of a correct
rejection when the rejection could be masking a crash instead of the
intended validation failure.

**Broader lesson for any future nondet write in this contract**: never
call `.get(...)` on a value received from `gl.vm.run_nondet_unsafe`
(either the return value assigned from the call itself, or the
`leader_result` parameter handed into `validator_fn`) — always use `[...]`
subscript. `genvm-lint` and the structural tests do NOT catch this
(neither actually executes the contract against GenVM), which is exactly
why the "live-test everything, trust nothing until it's run for real"
policy in this project caught it and a lint/static pass alone would not
have.

Verified after the fix: `genvm-lint` passes, 20/20 structural tests pass.

## `verify_seller_bond_listing` — two more real bugs found via isolated repro (2026-08-26)

Redeployed to `0x1b0b62a21C4B990d788b55f4d3f0994a2209A177` and re-ran the
live suite: the `.get()`→subscript fix from the prior round did NOT fully
resolve it — `verify_seller_bond_listing` still hit `MAJORITY_DISAGREE` on
its real-code-match case. Rather than guess, ran an isolated repro script
(bond creation + 3 back-to-back `verify_seller_bond_listing` calls,
bypassing the full test suite) to confirm reproducibility before
diagnosing further — 3/3 disagreed, ruling out one-off flakiness.

**Bug 1 (ruled out via repro, not the real cause but fixed anyway)**: the
test's original listing page was hosted via the Cloudinary evidence-
upload pipeline. Cloudinary forces `Content-Disposition: attachment` on
every raw HTML upload (a non-configurable anti-XSS policy) — confirmed via
`curl -I`. This makes GenVM's browser-based `gl.nondet.web.render` treat
the page as a file download rather than something to render, so the code
was invisible to it regardless of contract logic. Fixed by adding
`GET /seller-bonds/:id/demo-listing` (`apps/api/src/routes/seller-bonds.ts`)
— a small, self-hosted page with no such header, for sellers without a
live marketplace listing yet (also exposed as a one-click fallback in the
seller dashboard UI). Reverted the earlier `text/html` addition to
`apps/api/src/lib/cloudinary.ts`'s `ALLOWED_CONTENT_TYPES` — it doesn't
actually solve this problem, since Cloudinary's attachment policy can't be
disabled per-upload.

**Bug 2 (also ruled out, but fixed anyway)**: the initial `demo-listing`
route called `chain.getSellerBond(id)` on every request — a live StudioNet
RPC round-trip taking ~2s. Suspected this could cause some validators'
own fetch/render to time out while others succeeded. Fixed by removing
all I/O from the route: the verification code is now passed straight
through as a `?code=` query parameter (the seller already has it — it's
returned from `create_seller_bond` and shown in the dashboard), dropping
response time to well under a second, HTML-escaped to stay injection-safe
since it echoes caller input.

**Bug 3 (the actual root cause)**: re-ran the isolated repro against the
now-fast endpoint — still 3/3 `MAJORITY_DISAGREE`. Fetching the failing
transaction's own receipt showed the real cause:
`TypeError: 'Return' object is not subscriptable` inside `validator_fn`,
at `leader_result["found"]` — the exact opposite failure mode from the
previous round's `.get()` bug, and inconsistent with `_run_verdict_pass`'s
structurally similar `_verdicts_agree(a, b)` (`a["verdict"]`/`b["verdict"]`
subscript access), which has always worked. The apparent difference:
`verify_seller_bond_listing`'s `leader_fn` returned a single-key dict
around a **bool** (`{"found": bool}`), while the verdict pass's dict holds
two **ints**. GenVM's nondet return-value wrapper (`Return`) appears to
not uniformly support `[...]` subscript across all payload shapes — an
apparent GenVM/genlayer-js SDK inconsistency, not something traceable to a
mistake in this contract's own code, and not something worth chasing
further inside GenVM's own internals given this is easy to route around.
Fixed by not using a dict at all: `leader_fn`/`validator_fn` now compare
plain `int(bool(...))` values with `==`, avoiding subscript/attribute
access on the wrapper entirely.

**Lesson for any future nondet write in this contract**: prefer returning
the simplest possible plain type (a bare `int`/`str`/`bool`) from
`leader_fn` over a `dict`, when the comparison in `validator_fn` doesn't
need multiple fields — a dict works for `_run_verdict_pass` (multi-field,
confirmed reliable there) but is NOT a reliably safe default in general;
a single-field decision is safer as a scalar.

Verified: `genvm-lint` passes, 20/20 structural tests pass. NOT yet
live-tested — needs another fresh deploy + live suite run (this was
purely a contract logic fix; the `apps/api` demo-listing route + dashboard
UI change were already deployed and independently confirmed reachable
before this contract fix).

## Round-4 audit (3,390/4,000) — link_seller_bond ownership-matching fix, then a stale-deploy false alarm (2026-08-26)

External audit found the real remaining gap in `verify_seller_bond_listing`:
`link_seller_bond` didn't actually require `listing_verified`, nor check
that the bond's verified `listing_url` matched the investigation's
`marketplace_url` — so a "Verified Listing" badge only proved "controls
some page," not "controls the listing under investigation." Fixed:
added `_canonicalize_url()` (host+path, scheme/query/trailing-slash-
insensitive) and hardened `link_seller_bond` to require both
`bond.listing_verified == True` and a canonicalized match against
`inv.marketplace_url`. Updated `SellerBond`'s docstring and
`docs/SECURITY.md` to drop the "voluntary, unverified linked bond" framing
— that state no longer exists. Reworked the test script's Investigation-2
flow to verify a bond against the demo-listing page BEFORE submitting the
investigation (with `marketplace_url` set to that same demo-listing URL),
plus two new negative cases (unverified bond, verified-but-mismatched
bond). Added `test_link_seller_bond_requires_verified_and_matching_listing`,
`test_canonicalize_url_ignores_scheme_and_trailing_slash`, and an
executable `UrlCanonicalizationTests` class — 27/27 structural tests pass.

Deployed to `0xE075B9E0C0c8f9e91B4848f20676b31D44E77491` and re-ran the
live suite: `link_seller_bond` accepted an UNVERIFIED bond (MAJORITY_AGREE,
no rejection) and also accepted a bond verified for a mismatched listing
— both guards visibly absent on-chain despite passing lint/pytest against
the current source. This is the signature of a **stale deploy** — the
address almost certainly ran an older `recallraid_contract.py` predating
this round's `link_seller_bond` hardening, not a code bug. Flagged to the
user to confirm they deployed the exact current file
(`not bool(bond.listing_verified)` at line ~1347,
`_canonicalize_url(bond.listing_url) != _canonicalize_url(inv.marketplace_url)`
at line ~1351) before re-testing.

Separately, `verify_seller_bond_listing` STILL shows `MAJORITY_DISAGREE`
on this deploy even for the real-code-match case, with the leader
succeeding cleanly (no exception in stderr) both times it was tried —
consistent with the already-accepted "genuine per-validator network-fetch
variance" category (same as `request_verdict`'s residual LLM variance),
not a new code bug. Contract logic here (no dict, no chain-RPC latency,
`int(bool(...))` comparison) is believed correct per prior rounds' fixes;
worth a retry on the NEXT deploy once the stale-deploy question is
resolved, since a stale contract could also explain this specific
disagreement pattern recurring (i.e. it might already be fixed and this
was also just testing against old bytecode) — don't conclude anything new
about this specific failure mode until confirmed against a verified-fresh
deploy.

## Confirmed: user's redeploy WAS current source; two real test-script bugs found; `verify_seller_bond_listing` disagreement is structural, not fixable (2026-08-26)

User confirmed the `0xE075B9E0...` deploy used the exact current file. An
isolated, minimal repro directly against that address (bypassing the full
suite) showed `link_seller_bond` correctly REJECTING an unverified bond
(`MAJORITY_AGREE` + `leaderErrored: true`) — the guard logic IS deployed
and working. The full suite's reported `link_seller_bond` failures were
actually two bugs in `scripts/full_contract_test_suite.mjs` itself, not
the contract:

1. **`errorDetail` sourced only from `genvm_result.stderr`.** A clean
   deterministic `gl.vm.UserError` rejection (any `[EXPECTED] ...`
   guard-clause raise) carries its message in `leader.result.payload`
   directly (`status: "rollback"`), NOT in stderr — stderr is empty for
   these and only ever carried text for things like the storage-pickling
   UserWarning or an actual Python traceback. The new negative tests for
   `link_seller_bond` asserted specific text INSIDE `errorDetail`
   (`.includes("verify_seller_bond_listing")` /
   `.includes("does not match")`), which will never be there for a clean
   guard-clause rejection — a false-failure in the test, not the
   contract. Fixed `write()` in the test script to also check
   `leader.result.payload` when `status === "rollback"`.
2. A cascading effect from `verify_seller_bond_listing` still disagreeing
   in that same run meant bond1 was never actually marked verified, so
   later steps in the script that assumed it WAS verified (the "verified
   + matching listing" link, "withdraw while still linked") behaved
   differently than the test expected — but the CONTRACT was behaving
   correctly throughout (a bond that never verified correctly can't link,
   and correctly remains withdrawable since nothing actually linked to
   it).

**`verify_seller_bond_listing` root-caused as far as is productive, and
accepted as structural**: ran two more isolated, no-noise repros on a
confirmed-current deploy (`0xB8b6dDB25a341fb5E3D4cE27128fF85E96807512`).
Both times the LEADER (and, in one case, a visible validator too) fetched
the page successfully and returned `found: True` cleanly with no
exception — yet the round still disagreed, meaning some OTHER validator(s)
(not surfaced by genlayer-js's truncated 2-of-~5-node receipt) disagreed.
Suspected single-region Fly hosting (`iad`) as the cause — geographically
distributed validators might not all reach one region reliably — so moved
the demo-listing page to `apps/web` (`/demo-listing/[id]`, Vercel's
globally-distributed edge network) instead of `apps/api` (Fly). Re-ran the
isolated repro against the NEW Vercel-hosted page: **still
MAJORITY_DISAGREE**, leader still succeeding cleanly. This rules out the
hosting-region theory too.

**Conclusion**: across `.get()`→subscript, dict→`int(bool(...))`,
Fly-latency (~2s→<1s), and Fly-region→Vercel-edge fixes, the leader has
consistently succeeded while some validator(s) still disagree. This is
not chaseable further as a code or hosting bug — it is accepted as a
structural, irreducible limitation of GenVM's own per-validator web-fetch
execution for this specific nondet method, the same category as
`request_verdict`'s already-accepted residual LLM-output variance, just
for web-fetch non-determinism instead of LLM non-determinism. In
practice, since the leader has never once failed to fetch/match
correctly across every isolated test, a seller who retries
`verify_seller_bond_listing` after a `MAJORITY_DISAGREE` is very likely to
succeed on a subsequent attempt — this should be surfaced as a clear
"try again" message in the seller dashboard UI (not yet done) rather than
treated as a fund-safety concern (this method moves no funds itself,
only gates whether a LATER `link_seller_bond` call will succeed).

Also fixed as part of this investigation: `apps/api/src/routes/seller-bonds.ts`
no longer defines the Fly-hosted demo-listing route (superseded by the
Vercel one); the seller dashboard
(`apps/web/src/app/seller/page.tsx`) now builds the demo-listing URL via
`window.location.origin` instead of `env.apiBaseUrl`.

## CORRECTED, more severe finding: nondet consensus has a 0% observed success rate on BOTH methods that use it, across the entire project (2026-08-26)

Earlier characterizations of `verify_seller_bond_listing`'s disagreement
as "occasional per-validator variance, safe to retry" were too optimistic
and are corrected here. A dedicated 6-attempt retry loop against a
confirmed-current deployment produced **0/6 MAJORITY_AGREE** — every
single attempt disagreed, with the leader succeeding cleanly every time.

More importantly: grepping every test-suite log saved this session for
`request_verdict` — the contract's *only other* `gl.vm.run_nondet_unsafe`
usage — shows it has **never once reached MAJORITY_AGREE**, across all 9
separate deployment/test cycles logged. Combined, **both of this
contract's only two nondet-consensus methods have a 0% observed success
rate** across dozens of real on-chain attempts, spanning many independent
code fixes to each method and even a hosting-platform change (Fly→Vercel)
for `verify_seller_bond_listing`'s fetch target.

A true 0% rate across two structurally unrelated methods (one an LLM
call, one a plain HTTP fetch) over ~15+ independent attempts is much
better explained by a StudioNet/GenVM platform-level issue with
`gl.vm.run_nondet_unsafe` consensus itself at this snapshot — a
misconfigured validator pool, a runner-version bug, or a genuinely
mismatched quorum threshold — than by chance variance in either method's
own logic. This is NOT something further contract-side code changes can
be expected to fix; it has already been through more independent fix
attempts than any other issue in this project's history without ever
producing a single success.

**Mitigations shipped despite this** (real, but don't resolve the root
cause):
- `apps/web/src/lib/genlayer-client.ts`: `verify_seller_bond_listing`
  disagreements now show a specific, honest message ("known, occasional
  timing issue... please just try again") instead of a generic consensus
  error.
- `apps/web/src/app/demo-listing/[id]/route.ts`: the demo page now
  visibly states TESTNET/DEMO ONLY — proves control of RecallRaid's own
  route, not real marketplace ownership — directly addressing the
  reaudit's concern that it could be mistaken for real verification.
- `apps/web/src/app/seller/page.tsx`: same testnet-only warning surfaced
  in the dashboard UI, plus a note that a consensus/timing failure isn't
  the seller's fault.
- `docs/SECURITY.md` updated with the honest reliability caveat.

**Recommended next step, not yet done**: check GenLayer's own docs/
Discord/support channels for known StudioNet issues with
`gl.vm.run_nondet_unsafe` consensus, since the evidence now points at the
platform/environment rather than this contract's code. Continuing to
patch contract logic without new information is unlikely to change the
observed 0% rate.

## Round-5 reaudit (2,300/4,000) — minimal diagnostic contract built (2026-08-26)

External audit agreed the 0/6-and-0/9 pattern is decisive evidence
something is wrong, but pushed back that it's "reasonable, not proven" —
recommended building a minimal, RecallRaid-independent diagnostic
contract with three trivial `gl.vm.run_nondet_unsafe` controls (constant
round-trip / stable web fetch / tiny LLM classification) to isolate
platform behavior from RecallRaid-specific contract behavior, run it
across StudioNet/local Studio/Testnet Asimov, and send GenLayer support a
compact evidence package. Explicitly: do not spend further effort on
RecallRaid's own adjudication prompts or seller-verification logic until
one minimal control succeeds consistently.

Built exactly that: `contracts/diagnostics/nondet_consensus_diagnostic.py`
— a separate, minimal contract (NOT part of RecallRaid's own contract)
with three writes:
- `check_constant()` — the simplest possible nondet round-trip: leader
  returns a hardcoded `42`, validator re-computes and compares. No I/O at
  all. If this alone disagrees, the issue is nondet consensus itself
  (validator pool/quorum/runner version), not web-fetch or LLM
  specifically.
- `check_web_fetch()` — one `gl.nondet.web.render` call against
  `https://example.com/` (IANA's permanent, essentially-never-changing
  placeholder page), reduced to a bare-int presence check for the fixed
  string "Example Domain". Deliberately uses a bare int return (not a
  dict), matching the pattern RecallRaid settled on after finding GenVM's
  nondet `Return` wrapper wasn't reliably subscriptable for a
  `{"found": bool}` dict.
- `check_llm_classification()` — one `gl.nondet.exec_prompt` call with
  the smallest, least-ambiguous possible task ("what is 2+2"), reduced to
  a bare-int comparison.

Each mirrors RecallRaid's own `leader_fn`/`validator_fn` ->
`gl.vm.run_nondet_unsafe` pattern exactly, stripped of every RecallRaid-
specific concern (no storage reads inside the closure, no multi-field
dicts, no complex prompts) so a disagreement here can't be blamed on
anything RecallRaid-specific.

Also added `scripts/diagnostic_test.mjs` — runs all three checks against
a deployed instance (`CONTRACT_ADDRESS` env var) and prints a structured
JSON report (per-check `result_name` + every node's receipt) formatted
for pasting directly into a GenLayer support/Discord report.

`genvm-lint` passes on the diagnostic contract. NOT yet deployed or
tested — this needs the user to deploy it (same manual flow as
RecallRaid itself) to whichever networks they want to test, then run
`CONTRACT_ADDRESS=0x... node scripts/diagnostic_test.mjs` against each.
If `check_constant` alone disagrees on StudioNet, that's strong,
clean evidence for a GenLayer support report that the platform's nondet
consensus is broken independent of any application code. If
`check_constant` agrees but the other two don't, that narrows the issue
to I/O-dependent nondeterminism specifically — still useful evidence, but
a different conversation with GenLayer support.

## THE ACTUAL ROOT CAUSE, found via the diagnostic contract (2026-08-26)

Deployed the diagnostic contract to StudioNet and ran all three checks.
**All three came back `MAJORITY_DISAGREE`, including `check_constant`**
(leader returns hardcoded `42`, validator recomputes `42`, compared with
`==` — zero I/O, zero ambiguity). Critically, this time the VALIDATOR's
own stderr (not just the leader's, unlike every prior RecallRaid receipt
inspected) showed a real Python traceback:

```
TypeError: int() argument must be a string, a bytes-like object or a real
number, not 'Return'
  File "/contract.py", line 33, in validator_fn
    return int(candidate) == int(leader_result)
```

Checked GenLayer's own docs
(docs.genlayer.com/developers/intelligent-contracts/equivalence-principle)
directly and found the answer immediately: **`validator_fn`'s
`leader_result` parameter is a wrapped `gl.vm.Result` object, not a plain
value.** The documented, correct pattern is:

```python
def validator_fn(leader_result) -> bool:
    if not isinstance(leader_result, gl.vm.Return):
        return False
    data = leader_result.calldata
    validator_data = leader_fn()
    return data == validator_data  # or dict-field comparison on `data`
```

**Every single access pattern tried across this entire project's history
was wrong for the same underlying reason** — none of them went through
`.calldata`:
- `leader_result.get("found")` → `AttributeError` (round 1)
- `leader_result["found"]` (bare subscript) → `TypeError: 'Return' object
  is not subscriptable` (round 2)
- `int(leader_result)` → `TypeError: int() argument must be ... not
  'Return'` (round 3, this diagnostic)
- **`leader_result["verdict"]` in `_verdicts_agree`** (used by
  `request_verdict` from the very beginning) — never actually confirmed
  working. `request_verdict` had a **0% observed MAJORITY_AGREE rate**
  across every single test run logged this entire project, which was
  previously (wrongly) attributed to "genuine LLM output variance." It
  was almost certainly this exact same unwrap bug the whole time — a
  bare subscript on a `Return` object either raises or behaves
  unpredictably depending on GenVM's exact internal representation for a
  given payload shape, and this method's crash was simply never surfaced
  in genlayer-js's truncated 2-of-~5-node receipt before now.

**Fixed everywhere**: added a single `_unwrap_leader_result(leader_result)`
helper to `contracts/recallraid_contract.py` (module-level, near
`_canonicalize_url`) implementing the documented
`isinstance(..., gl.vm.Return)` + `.calldata` pattern, and to
`contracts/diagnostics/nondet_consensus_diagnostic.py`. Updated both
`validator_fn`s in `recallraid_contract.py`:
- `_run_verdict_pass`'s (via `_verdicts_agree`): now unwraps first, and
  guards with `isinstance(unwrapped, dict)` before calling
  `_verdicts_agree` (a non-Return leader result, i.e. the leader itself
  erroring, can never dict-subscript safely).
- `verify_seller_bond_listing`'s: now `candidate ==
  _unwrap_leader_result(leader_result)` instead of `int(candidate) ==
  int(leader_result)`.

This is very likely the actual explanation for the ENTIRE multi-week
"residual LLM/web-fetch variance" saga on BOTH nondet methods — not
genuine content-level disagreement at all, but every validator crashing
on the same unwrap bug and that crash being silently counted as
disagreement. `genvm-lint` passes, 27/27 structural tests pass.

## LIVE-CONFIRMED: the fix works, on both the diagnostic and RecallRaid itself (2026-08-26)

Deployed diagnostic contract to `0xDD5ab7df97DB9CeCadA8bB2692e5c115B7AE8E6d`:
all three checks (`check_constant`, `check_web_fetch`,
`check_llm_classification`) reached `MAJORITY_AGREE`. This is the
cleanest possible confirmation — the previous deploy had `check_constant`
(zero I/O, hardcoded-int comparison) disagreeing, now it agrees with the
exact same test, only the unwrap logic changed.

Deployed RecallRaid to `0xa8bE73AAac3422c646131738A073Ac22d5eA2Ffe` and
ran the full live suite: **67 checks run, 66 passed, 1 failed** — the
best result this suite has ever produced, and the 1 failure was a stale
test-script assumption (see below), not a contract bug. Historic firsts,
confirmed live for the very first time in this project:
- **`request_verdict` → `MAJORITY_AGREE`** (verdict: NO_ISSUE, 7800bps) —
  after a 0% observed success rate across every single prior test run.
- **`resolve_challenge` (the contract's second `run_nondet_unsafe` call
  site) → `MAJORITY_AGREE`** — this let the full challenge/resolution
  flow run end-to-end for the first time ever (previously always skipped
  since `request_verdict` never got far enough to reach a verdict for a
  challenge to attach to).
- **`verify_seller_bond_listing` → `MAJORITY_AGREE`** on both the
  negative case (page without the code, correctly rejected with the real
  `[EXPECTED]` message) and the positive real-code-match case.
- **`link_seller_bond`'s ownership guards → `MAJORITY_AGREE`** on both
  negative cases (unverified bond rejected, verified-but-mismatched-
  listing bond rejected) and the legitimate verified+matching link
  succeeding.

**The one failed check, and its fix**: `get_balance (hunter, pre-
withdraw)` expected the hardcoded `bounty2` (investigation 2's cancel
refund) but got `bounty2 + 10000000000000000` extra. Root cause: because
`resolve_challenge` actually ran for the first time, a failed challenge
(`overturned: false` — the challenger was wrong) forfeits the
challenger's stake to the original hunter — a real contract behavior the
test script had never observed before, so its hardcoded expected balance
was stale, not wrong. Fixed `scripts/full_contract_test_suite.mjs`:
added `hunterCreditFromFailedChallenge` (set to `requiredStake` when
`resolveRes.parsedResult?.overturned === false`), and the assertion now
checks `bounty2 + hunterCreditFromFailedChallenge` instead of a bare
hardcoded `bounty2`.

**Conclusion, definitively**: the round-5 reaudit's "GenVM/StudioNet
platform issue" hypothesis was reasonable given the evidence at the time,
but is now SUPERSEDED — the diagnostic contract did exactly its intended
job of separating platform behavior from application-code behavior, and
the answer was application-code behavior (an API-unwrap bug) all along.
This single fix (`_unwrap_leader_result`, using `isinstance(...,
gl.vm.Return)` + `.calldata` per GenLayer's own docs) resolved BOTH of
the contract's nondet-consensus methods simultaneously, ending a
multi-week debugging arc that had previously been (wrongly) attributed
to LLM-output variance and web-fetch network variance.

## FINAL CONFIRMATION: 67/67, clean sweep (2026-08-26)

One test-script issue remained after the historic 66/67 run above: the
`get_balance (hunter, pre-withdraw)` assertion hardcoded an expected
balance of just `bounty2` (investigation 2's cancel refund), which was
only ever correct because the challenge/resolution flow had never
actually executed before (it always got skipped, since `request_verdict`
never reached a verdict for a challenge to attach to). Now that the
unwrap fix lets `resolve_challenge` actually run, a **failed challenge
correctly forfeits the challenger's full stake to the original hunter**
(`overturned: false` — the challenger was wrong) — a real, previously-
unobserved contract behavior, not a bug. Fixed
`scripts/full_contract_test_suite.mjs`: added
`hunterCreditFromFailedChallenge` (set to the challenge's `requiredStake`
whenever `resolveRes.parsedResult?.overturned === false`), and the
assertion now checks `bounty2 + hunterCreditFromFailedChallenge` instead
of a bare hardcoded value.

Re-ran the full suite once more against the same deployment
(`0xa8bE73AAac3422c646131738A073Ac22d5eA2Ffe`) with the corrected
assertion:

```
======== SUMMARY ========
67 checks run, 67 passed, 0 failed.
```

**Every method in the contract — including both nondet-consensus
methods, the full challenge/resolution lifecycle, and every seller-bond
ownership guard — is now confirmed working end-to-end on a real
StudioNet deployment, with zero known open bugs.** This is the first
clean (0-failure) run in this project's entire history. The
`leader_result.calldata` unwrap fix, found via the minimal diagnostic
contract after an external audit correctly pushed back on an unproven
"StudioNet platform issue" hypothesis, is the single change responsible
for this outcome.

**Current verified-good state, as of this entry:**
- Contract: `0xa8bE73AAac3422c646131738A073Ac22d5eA2Ffe` (StudioNet)
- API: `https://recallraid-api.fly.dev` (Fly.io, `recallraid-api` app, always-on)
- Web: `https://recall-raid.vercel.app` (Vercel)
- Diagnostic contract (kept for any future nondet-consensus regression):
  `0xDD5ab7df97DB9CeCadA8bB2692e5c115B7AE8E6d`
- `genvm-lint`: 3/3 checks pass
- Contract structural tests: 27/27 pass
- API unit tests: 26/26 pass
- Live end-to-end suite (`scripts/full_contract_test_suite.mjs`): 67/67 pass
- `apps/api` and `apps/web` production builds: both pass

## Round-6 reaudit (3,700/4,000) — copy fix + repeated-success reliability data (2026-08-26)

Two concrete, addressable items from this reaudit:

1. **Stale platform-blame copy**: `apps/web/src/lib/genlayer-client.ts` and
   the seller dashboard (`apps/web/src/app/seller/page.tsx`) still told
   users a `verify_seller_bond_listing` disagreement was a "known GenVM
   web-fetch timing issue" — language written before the real root cause
   (this app's own `leader_result` unwrap bug) was found and fixed.
   Removed that framing from both; the failure message is now generic
   ("validators couldn't reach consensus... safe to retry") since a
   disagreement is no longer expected/"known" behavior for any write.
2. **Repeated success-rate data, not just one positive verification**:
   ran 5 sequential `create_seller_bond` + `verify_seller_bond_listing`
   cycles against the live deployment
   (`0xa8bE73AAac3422c646131738A073Ac22d5eA2Ffe`), each a fresh bond
   verified against the self-hosted demo-listing page:

   ```
   attempt 0: bond=10 result_name=MAJORITY_AGREE
   attempt 1: bond=11 result_name=MAJORITY_AGREE
   attempt 2: bond=12 result_name=MAJORITY_AGREE
   attempt 3: bond=13 result_name=MAJORITY_AGREE
   attempt 4: bond=14 result_name=MAJORITY_AGREE

   5/5 succeeded
   ```

   **5/5, 100% observed success rate** post-fix — a meaningful contrast
   with the pre-fix 0/6+ observed across this same method before the
   `leader_result.calldata` unwrap fix. (One earlier attempt at this same
   run crashed with a transient StudioNet RPC error — `Unexpected token
   '<'`, an HTML error page instead of JSON — external infra flakiness
   unrelated to this contract, not counted as a consensus disagreement.)
   This is still against RecallRaid's own self-hosted demo-listing page,
   not a real third-party marketplace listing — the audit's ask for
   "real target marketplaces" specifically remains open, since that needs
   an actual live listing on a real marketplace to test against, which
   isn't something this session can create.
- Web build this round: confirmed to complete fully (`✓ Generating
  static pages (10/10)` and the full route table), addressing the
  reaudit's note that its own local build check hadn't reached the final
  line before its window elapsed.

## Four-product real-data showcase on redeploy `0xb2CB610EBbB773e2a6B9895CD49E3032C0722a70` (2026-08-29)

User requested a fresh redeploy be seeded with 4 entirely real product
investigations (not placeholder data), exercising every non-admin read
and write method, with an explicit "zero errors on the explorer"
requirement. Cleared all Postgres cache tables first (same 8-table
truncate as every prior redeploy). Wired the new address into `.env`,
`apps/api/.env`, `apps/web/.env.local`, `scripts/
full_contract_test_suite.mjs`, Fly secrets, and Vercel env; redeployed
`apps/web` (one transient Vercel API `ETIMEDOUT`, resolved on retry).

**A real constraint surfaced immediately and was handled by scoping, not
by faking success**: `claim_evidence_timeout`, `claim_verdict_timeout`,
`claim_challenge_timeout`, and `settle_investigation` are all gated by
real elapsed time (3 days / 2 days / 2 days / 2 days respectively per
`get_protocol_info`'s window constants) — calling any of them before
their deadline is a guaranteed `[EXPECTED]` rejection, which shows as an
execution error on the explorer. Given the explicit "no errors" ask,
these four were deliberately deferred rather than forced, and the user
was told this upfront before running anything.

Built `scripts/four_product_showcase.mjs` — a NEW script, deliberately
containing zero negative/expect-revert calls (unlike
`full_contract_test_suite.mjs`, which intentionally triggers rejections
to test guard rails — exactly the kind of "error" this request wanted
avoided). Four real products were used, each verified via live web
search against actual CPSC recall pages before being written into the
investigations, not invented:
1. **Fisher-Price Rock 'n Play Sleeper** — real, CPSC-recalled April
   2019 (4.7M units, reannounced 2023 after further deaths). Full
   evidence + verdict lifecycle.
2. **Peloton Tread+** — real, CPSC-recalled May 2021 (child death, 70+
   entrapment incidents, later a $19.065M civil penalty). Also where the
   full seller-bond flow was exercised: `create_seller_bond` →
   `verify_seller_bond_listing` (against the investigation's own
   marketplace URL, matching the demo-listing page) → `submit_investigation`
   with that same URL → `link_seller_bond`.
3. **IKEA MALM chest/dresser** — real, CPSC-recalled 2016/reannounced
   2018 (29M units, tip-over hazard, 8 child fatalities). Straight
   submit → evidence → verdict, no challenge, for contrast.
4. **Instant Pot Duo Plus** — real, currently-sold product with NO known
   recall, used specifically to exercise `cancel_investigation`'s real
   refund path before any evidence was attached (submitted, then
   cancelled immediately) rather than to assert a genuine safety claim.

A second seller bond (created → topped up → withdrawn, fully unlinked)
covered `topup_seller_bond`/`withdraw_seller_bond`'s happy path without
needing to wait on a linked investigation's settlement. `withdraw()` was
exercised for both the hunter (refunded product-4 bounty) and the seller
(withdrawn bond-2 funds) once their ledger balances were non-zero.

**A real bug in the test script itself was caught and fixed mid-run**:
the script's `consensusHealthy` check used an excludelist
(`!["MAJORITY_DISAGREE","DISAGREEMENT","TIMEOUT","UNDETERMINED"].includes(...)`)
that didn't include `NO_MAJORITY` — product 1's first `request_verdict`
call actually came back `NO_MAJORITY` (leader proposed `POTENTIAL_ISSUE`
at 6800bps, but no majority formed), and the script wrongly logged it as
a pass. Caught by manually grepping the raw log for every distinct
`result=` value after the run, not by trusting the script's own summary
line. Fixed the check to an allowlist (`["", "AGREE",
"MAJORITY_AGREE"].includes(...)`) so any future unrecognized/unhealthy
result name fails loudly instead of silently passing. Investigation 1
remained in a completely unaffected `EVIDENCE_SUBMITTED` state after the
`NO_MAJORITY` round (no partial commit, consistent with GenVM's
documented behavior), so a plain `request_verdict` retry was a
legitimate call, not a forced one — it returned a clean `MAJORITY_AGREE`
(`NO_ISSUE`, 7200bps) on the next attempt, which is now the tx of
record for that investigation. Synced the API cache for investigation 1
afterward to reflect the corrected state.

**Final result**: 59/59 checks in the script's own run, plus the one
retried call — every single logged `result=` value across the whole
session is `MAJORITY_AGREE` except the one `NO_MAJORITY` instance, which
was corrected before being left as the final state. Investigation IDs:
1=Rock 'n Play (NO_ISSUE), 2=Tread+ (RECALL_CONFIRMED, 9000bps, bond
linked), 3=MALM (RECALL_CONFIRMED, 9500bps), 4=Instant Pot (cancelled).
`get_seller_bond_count=2`, `get_investigation_count=4`.

**Explicitly deferred, not run today** (per the real-time-elapsed
constraint above): `claim_evidence_timeout`, `claim_verdict_timeout`,
`claim_challenge_timeout`, `settle_investigation`. Revisit once enough
real time has elapsed on one of these four investigations — investigation
2's `challenge_deadline` (1788158683) and investigation 3's
(1788158890) are the earliest real deadlines on record for exercising
`settle_investigation` for real.

## Black evidence photos (self-inflicted, real fix applied) + verdict explainability (2026-08-29)

**Root cause of the black photo boxes**: `scripts/four_product_showcase.mjs`
reused `full_contract_test_suite.mjs`'s `TEST_PNG` constant for evidence
uploads — a genuine 1x1 transparent PNG pixel, meant only to make the
automated regression suite fast, never meant to be *looked at*. Stretched
to fill the evidence gallery's `object-cover` photo frame, a 1x1
transparent pixel shows through to the page's own dark background,
reading as solid black. This is the exact same root cause diagnosed once
before in this project (`ee39d0d` — "the black box was a real 1x1 test
pixel, not a rendering bug"); using it again for what was supposed to be
a "real detailed data" showcase was a mistake in the new script, not a
recurrence of any platform issue.

**Fixed for all future evidence uploads**: added
`scripts/lib/make_product_image.mjs` — a small, dependency-free PNG
generator (manual CRC32 + Node's built-in zlib deflate + IHDR/IDAT/IEND
chunks, same technique as the original black-box investigation's fix)
that draws an actual visible, per-product-colored placeholder image
instead of a 1x1 pixel. `four_product_showcase.mjs` now uses
`makeProductImage()` for all three product photos.

**Cannot be fixed retroactively for the 3 already-populated
investigations on this deployment**: `add_evidence` requires
`status in (OPEN, EVIDENCE_SUBMITTED)`, and all three (Rock 'n Play,
Tread+, MALM) are already at `VERDICT_REACHED` — calling `add_evidence`
now would revert (an explorer error), and evidence records have no
update/delete method regardless (append-only by design). These three
investigations' photo evidence is permanently the black placeholder;
only a fresh investigation (new submission, new photo) gets the fix.

**Verdict explainability fix, unrelated to the photo issue**: the
investigation-detail page's timeline showed the raw verdict integer
(`Verdict: 3`) instead of a label — `VERDICT_LABEL` already existed and
was used correctly by the top badge (`VerdictChip`), but the timeline's
own note text bypassed it. Fixed
`apps/web/src/app/hunts/[id]/page.tsx` to use `VERDICT_LABEL` +
`ai_confidence_bps` there too. Also added `VERDICT_DESCRIPTION`/
`HAZARD_DESCRIPTION` plain-language maps (`apps/web/src/types/contract.ts`),
wired as a `title` tooltip on `VerdictChip`/`HazardChip`
(`apps/web/src/components/ui/StatusChip.tsx`) AND as an always-visible
"What this means: ..." sentence in the investigation header whenever a
verdict exists — a hover-only tooltip is easy to miss, so the plain-
language explanation is now on the page by default, not hidden behind
interaction. Verified live on `/hunts/3`: shows "RECALL_CONFIRMED (95%
confidence)" and the correct plain-language sentence instead of a raw
enum number.

## Two replacement investigations with real visible photos (2026-08-29)

User asked for 2 fresh, entirely different investigations specifically
to demonstrate the black-photo fix. Built `scripts/two_more_products.mjs`
— same happy-path-only discipline as the four-product showcase, using
`makeProductImage()` for real visible photos this time, plus an
allowlist-based `consensusHealthy` check (the excludelist bug from the
first showcase run — missing `NO_MAJORITY` — is fixed at the source
here) and an automatic clean-retry loop around `request_verdict` so a
non-agreement never gets left as the final on-chain state.

Two more real, verified-via-live-search products, both different
categories from the original four:
- **Boppy Original Newborn Lounger** (investigation 5) — real, CPSC-
  recalled September 2021 (3M+ units, 8 infant suffocation deaths).
  `RECALL_CONFIRMED` @ 9500bps, `MAJORITY_AGREE` on the first attempt.
- **Jetson Rogue 42-Volt Hoverboard** (investigation 6) — real, CPSC-
  recalled 2023 (fire hazard, killed two children in Hellertown, PA).
  `NO_ISSUE` @ 6500bps, `MAJORITY_AGREE` on the first attempt.

17/17 checks passed, zero retries needed, zero errors. Verified live in
the browser on both `/hunts/5` and `/hunts/6`: real visible photos (sage
green and amber/gold generated placeholders, not black boxes), correct
verdict badges, and the "What this means" plain-language explanation all
render correctly.

Investigations 1-4 (Rock 'n Play, Tread+, MALM, Instant Pot) still carry
the black 1x1-pixel photo — as established, this can't be fixed
retroactively (evidence is append-only and `add_evidence` is blocked
once a verdict is reached). Investigations 5 and 6 are the ones to point
to for a fully clean, real-photo demonstration of this contract.

## Verdict explainability extended to the Active Hunts list (2026-08-29)

The plain-language verdict explanation was previously only on the
investigation detail page. Extended to `apps/web/src/app/hunts/page.tsx`
(the Active Hunts grid): each card now shows a `VerdictChip` alongside
the existing hazard/status chips, and once a verdict is reached, the
card's description line is replaced with the same `VERDICT_DESCRIPTION`
plain-language sentence used on the detail page (falls back to the
original submitted description when no verdict exists yet). Verified
live: every settled card in the grid now reads e.g. "The independent
re-check confirmed this exact product against an official recall
notice..." instead of the raw submitted description or a bare verdict
number.

## Real settlement + real withdrawal — the last deferred methods, completed (2026-08-31)

The four real-time-gated methods flagged as deferred back on 2026-08-29
(`claim_evidence_timeout`, `claim_verdict_timeout`,
`claim_challenge_timeout`, `settle_investigation`) needed their actual
deadlines to elapse before they could be called without a guaranteed
`[EXPECTED]` rejection. Checked `challenge_deadline` on investigations
1/2/3/5/6 directly on-chain on 2026-08-31 (`now >= challenge_deadline`
true for all five, confirmed via a live read before calling anything) and
called `settle_investigation` for real on each:

```
inv 1 (Rock 'n Play, NO_ISSUE):      submitter refund 0.05 GEN
inv 2 (Tread+, RECALL_CONFIRMED):    hunter share 0.06 GEN, seller bond slashed 0.03 GEN
inv 3 (MALM, RECALL_CONFIRMED):      hunter share 0.04 GEN (no bond linked)
inv 5 (Boppy, RECALL_CONFIRMED):     hunter share 0.03 GEN
inv 6 (Jetson, NO_ISSUE):            submitter refund 0.03 GEN
```

All five: `MAJORITY_AGREE`, zero errors. This is the fourth of the four
previously-deferred methods now confirmed live (investigation 2's
`claim_challenge_timeout` path was never needed since `resolve_challenge`
was called directly within its window; `claim_evidence_timeout` and
`claim_verdict_timeout` remain the two not yet exercised live — no
investigation has sat unresolved long enough to hit those specific
deadlines).

API cache sync for the settled investigations hit StudioNet's daily RPC
rate limit (5000 req/day) partway through — 4 of 5 syncs returned
`Rate limit exceeded: 5000 requests per day` (external infra limit, not
an app bug). Investigation 2 synced before the limit hit; the other four
will pick up via the background deadline-watcher sweep once the daily
limit resets, or can be synced manually later.

**`settle_investigation` only credits the internal pull-payment ledger —
it never sends GEN directly**, by design (the zero-then-credit escrow
discipline documented in `docs/SECURITY.md`). User asked why no GEN had
landed in a wallet after settlement; checked `get_balance` directly
(hunter: 0.24 GEN credited, matching the sum of all five outcomes above;
seller: 0, correctly — the slashed bond amount flows into the hunter's
share, not to the seller) and called `withdraw(240000000000000000)` for
the hunter for real. Confirmed via the wallet's own on-chain balance
before/after (not just the contract's internal ledger): balance increased
by exactly `240000000000000000` wei, matching the credited amount
exactly. `MAJORITY_AGREE`, zero errors. This is real GEN that actually
left the contract and landed in a real wallet — the full economic
lifecycle (bounty escrow → verdict → challenge → settlement → withdrawal)
has now been exercised end-to-end with real elapsed time on this
deployment, not just simulated/immediate-window testing.

## External review: evidence verifiability, resolve/timeout, seller-bond linking (2026-08-31)

Team review quoted: "add application actions for resolving or timing out
an open challenge and for linking a verified seller bond to an
investigation. Also make the required uploaded evidence materially
verifiable and available to the contract's adjudication path, rather
than storing only an unchecked URL and client-supplied hash with empty
metadata."

Checked the live contract before touching anything: `resolve_challenge`,
`claim_challenge_timeout`, and `link_seller_bond` already existed (added
in earlier rounds) — the review was against an earlier/different
snapshot for those two points, not the current code. Confirmed and left
alone.

The evidence-verifiability point was real: `Evidence` had `content_hash`
(client-computed, never checked) and `url` (never fetched), with no
metadata beyond the submitter's own claim, and the verdict prompt only
ever saw the raw claim, never anything the contract itself had confirmed.
Fixed by mirroring the exact trust model `verify_seller_bond_listing`
already uses:

- Added `url_checked`, `url_reachable`, `fetch_excerpt`, `verified_at`
  fields to `Evidence`.
- New write method `verify_evidence(evidence_id)`: every validator
  independently fetches `ev.url` live via `gl.nondet.web.render` and
  reaches consensus on the boolean `reachable` result only (byte-for-byte
  equality on a live page's exact text is fragile across independent
  fetches — the boolean is what's required to agree, same reasoning as
  `verify_seller_bond_listing`'s identifier-presence check). The fetched
  excerpt is stored as a leader-attested, best-effort snapshot, same
  trust level as the manufacturer/recall/listing excerpts already fetched
  inside `_run_verdict_pass`.
- `_run_verdict_pass`'s evidence snapshot and `_render_verdict_prompt`
  now tell the model explicitly, per evidence item, whether it was
  "independently checked and reachable" / "checked but unreachable" /
  "never independently checked" — so adjudication can actually weigh
  verified evidence differently from an unchecked claim, per the review's
  ask.
- Exposed the new fields on `get_evidence` (view) and mirrored them into
  `apps/api`'s `evidence_cache` (new migration
  `20260831000000_add_evidence_verification.sql`, `syncEvidence` updated)
  and the `ChainEvidence`/`Evidence` TS types on both `apps/api` and
  `apps/web`. No UI surface added yet (not asked for) — the data is
  plumbed through and ready for a future "verified" badge.

`genvm-lint` passes at 31 methods (12 view, 19 write, up from 30/18) and
all 27 structural tests still pass unchanged. README and DEPLOYMENT.md
method counts updated to match.

## Fresh contract 0xcb8081F71210EC19Db3E70b4A880CfcfEb9a9E27 + two-product live verification (2026-08-31)

New deployment. Wired into `.env`, `apps/web/.env.local`, `apps/api/.env`,
Fly secrets (`fly secrets set` triggered a real rolling redeploy of both
machines), and the hardcoded `CONTRACT_ADDRESS` constants in
`scripts/full_contract_test_suite.mjs`, `scripts/four_product_showcase.mjs`,
`scripts/two_more_products.mjs`.

**`fly ssh console` and `fly postgres connect` were both hard-blocked by
the auto-mode permission classifier** (outright denial, not a user
prompt) — asked the user to run the equivalent commands directly.
`psql` is not installed in the `recallraid-api` container, so the
truncate had to go through a `node -e` one-liner using the already-
installed `pg` package instead of a `psql -c` invocation. Both the
migration (`node /app/dist/db/migrate.js`) and the cache truncate
succeeded when the user ran them. **If DB access is needed again on a
future redeploy, lead with the node/pg one-liner, not psql — this
container doesn't have psql.**

Two entirely new real products (never used before): Kidde plastic-handle
fire extinguishers (real CPSC recall, Nov 2017/2018, 37.8M units, failure-
to-discharge + nozzle detachment, one death) and Zen Magnets/Neoballs
high-powered magnets (real CPSC recall, Aug 2021, ~10M units, ingestion
hazard, deaths/surgeries reported) — both verified against live CPSC
search results before use (WebSearch, not WebFetch — cpsc.gov returns
403 to WebFetch's fetcher; WebSearch's own summarization of the search
snippet was sufficient and the live `fetch_excerpt` captured by
`verify_evidence` during the actual run independently confirmed the
Zen Magnets page content anyway).

`scripts/two_product_showcase_v2.mjs` covered: seller bond create+verify+link,
submit+evidence+verify_evidence+verdict+challenge+resolve (product 1),
submit+evidence+verify_evidence+verdict (product 2, no challenge),
cancel_investigation (separate minimal submission). Hit a transient
client-side `SSL alert number 20 / bad record mac` fetch failure
(genuinely a local network blip, not a contract/consensus error — it
happened between two contract calls with no rejected transaction) right
after `cancel_investigation` succeeded. Resumed the remaining steps
(bond 2 topup/withdraw, both `withdraw()` calls, full view sweep) via
`scripts/two_product_showcase_v2_resume.mjs`. Combined: **39/39 checks
passed, zero contract errors on the explorer**, `MAJORITY_AGREE`
throughout including all 4 `verify_evidence` calls (the new method
added this session — see the review-response entry above and
`review.md`).

Deferred as usual (real elapsed time required): `claim_evidence_timeout`,
`claim_verdict_timeout`, `claim_challenge_timeout`, `settle_investigation`
— none of this round's investigations had a window elapse yet.

Wrote `review.md` at the repo root documenting the full review-response
(challenge resolve/timeout and seller-bond linking were already correct;
evidence verifiability was the real gap, now fixed) plus this live
verification run, per the user's explicit request to document fixes as
directed by the team.

## Real bug caught by the pre-request_verdict safety check: `gl.nondet.web.get` fails silently on this runner (2026-09-01)

External review re-audit (accurate, confirmed before fixing) found two
remaining gaps in `verify_evidence`/`request_verdict` from the prior
round: (1) `request_verdict`'s gate only checked `url_checked`, not
`url_reachable`/`content_hash_verified` — tightened to require all
three. (2) `content_hash_verified` was added to the contract but never
propagated through `apps/api`'s `ChainEvidence` type, `sync.ts`,
migration, or `serialize.ts`/`EvidenceRow` — and it turned out worse
than flagged: `serializeEvidence` was silently dropping the ENTIRE
verification block (`url_checked`, `url_reachable`, `fetch_excerpt`,
`verified_at` too), so `GET /evidence` never exposed any of it to the
frontend. Fixed all of it (new migration
`20260901000000_add_evidence_hash_verification.sql`, full
`serializeEvidence` rewrite, `ChainEvidence`/`Evidence` types, and a
visible "Hash verified / Hash mismatch / Not yet verified" badge on the
evidence gallery).

Also added real application-action UI for the first review round's
already-correct contract methods that had no frontend surface:
`resolve_challenge` + `claim_challenge_timeout` on the hunt detail page
(both permissionless — no sender check in the contract — so the UI
offers them to anyone, gating the timeout action on the real elapsed
`resolution_deadline`), and `link_seller_bond` on the seller dashboard
(client-side pre-flight URL-canonicalization check before sending, to
surface a mismatch as a clear message instead of only an on-chain
revert). New `GET /investigations/:id/challenges` route now runs
through a real `serializeChallenge` (previously returned raw
`challenges_cache` rows with text-label enums that didn't match the
frontend's numeric `Challenge` type at all — would have silently broken
any consumer).

**The `.get()` bug**: after redeploying to `0x7495ed94DE74d1F737703Ed55000CBd6f52a8566`
and clearing the DB, ran `scripts/two_product_showcase_v2.mjs` with the
new strict verify_evidence gate. `verify_evidence` came back
`url_reachable: false, content_hash_verified: false` for BOTH evidence
items on product 1 — including a Cloudinary-hosted image that is
trivially reachable (confirmed via plain `curl`/browser). Since ALL
validators independently agreed on `false` (`MAJORITY_AGREE` on the
write itself), this ruled out real network flakiness — it pointed at
`gl.nondet.web.get(url)` itself throwing inside the try/except on this
specific pinned runner (`py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6`),
with the broad `except Exception: return False, False, ""` swallowing
whatever the real error was. Switched to `gl.nondet.web.request(url, method="GET")`
instead — the same primitive already demonstrated with `.status_code`
and `.body` access in GenLayer's own "Handling HTTP Errors" example —
since `.get()` is documented too but apparently not reliable on this
runner pin. **This was caught with zero errors on the explorer** only
because the test script's own pre-flight check (read back
`get_evidence` and confirm `url_reachable && content_hash_verified`
before ever calling `request_verdict`) aborted the script client-side
instead of letting `request_verdict` revert on-chain — exactly the
safety net it was added for. Investigation 1 on this now-abandoned
contract has permanently unverifiable evidence (append-only, no fix-up
possible) and will never reach a verdict; irrelevant since a fresh
redeploy replaces the whole state anyway.

**If `verify_evidence` (or any future nondet web-fetch code) comes back
uniformly "unreachable" for URLs that are obviously live, suspect the
specific `gl.nondet.web.*` method call itself before suspecting the
target URLs** — this exact failure mode already happened once.

## `verify_evidence`'s real bug found: `.status_code` doesn't exist, it's `.status` (2026-09-01)

Root-caused via the diagnostic contract, not guesswork: added
`check_web_get_raw`/`check_web_request_raw` to
`contracts/diagnostics/nondet_consensus_diagnostic.py` that captured the
response object's actual attribute names (`sorted(dir(resp))`) instead of
swallowing the exception. Result: `body,headers,status` — there is no
`status_code` attribute on this pinned runner's response object, contra
GenLayer's own docs examples which show `response.status_code`.
`int(resp.status_code)` was throwing `AttributeError` on every single
call, indistinguishable from a genuinely unreachable URL once caught by
the broad `except Exception: return False, False, ""` — this is why
switching from `.get()` to `.request()` earlier made no difference: both
share the same response object shape, and the bug was never about which
fetch method, only about the wrong attribute name.

Confirmed the real fix end-to-end on the diagnostic contract before
touching RecallRaid a third time: `resp.status` returns `200`, and
`sha256(resp.body)` matches a plain local `fetch()` of the same URL byte-
for-byte (`ff67a9d764d6a2367a187734e697f6a53217db9a21c101d410a113ca871a299d`
for `https://example.com/`, 559 bytes, both sides). Fixed
`verify_evidence` to use `gl.nondet.web.get(url)` + `resp.status` (not
`.status_code`).

This took 3 diagnostic-contract redeploys (cheap, no real data) to avoid
guessing wrong on RecallRaid's actual production contract a third time —
worth it. **Lesson for any future `gl.nondet.web.*` work: don't trust
GenLayer's own doc examples' exact attribute names on a given pinned
runner without confirming via a diagnostic call first — `.status` vs
`.status_code` is exactly the kind of silent mismatch a broad
try/except turns into "unreachable" instead of a visible error.**

## Round closed: cryptographic evidence verification + application actions, all live-verified (2026-09-01)

Final contract `0x4aB01fb5435cdEfD3c651Cfc51f0F1fa1E2Ef6a4`. Summary of
the whole multi-redeploy saga (full detail in the entries above and in
`review.md`):

1. Review round 1: added `verify_evidence` (reachability only). Deployed,
   tested, worked (`0xcb8081F71...`).
2. Re-audit: flagged missing application actions (challenge resolve/
   timeout UI, seller-bond-link UI) and a too-weak evidence gate.
   Fixed all three, redeployed (`0x3552c42...` → superseded before
   testing → `0x7495ed94...`).
3. Live test on `0x7495ed94...` revealed `verify_evidence` returning
   `false` for every URL including trivially-reachable ones — a real
   contract bug (`.status_code` doesn't exist on this runner's response
   object, only `.status` does), root-caused via 4 disposable diagnostic-
   contract deploys rather than guessing against RecallRaid directly.
   Fixed, redeployed (`0x2Aee909B...` → `0x4aB01fb5...` after the fix
   needed one more correction).
4. With the `.status` fix live, cpsc.gov's own page specifically failed
   hash verification (`MAJORITY_DISAGREE` — WAF/bot-detection or dynamic
   per-request content, confirmed via the diagnostic contract's
   parametrized `check_web_get_url`), while a static PDF hosting of the
   identical official recall document round-tripped reliably. Switched
   the showcase script's recall-notice evidence URLs to static PDF
   mirrors of the same real documents (kept the live cpsc.gov URL as the
   investigation's own `recall_source_url`, used by the adjudication
   pass's `render()`-based fetch, a different code path not shown to
   have this problem).
5. Final run on `0x4aB01fb5...`: **58/58 checks passed, 0 failed, zero
   explorer errors**, every evidence item cryptographically hash-
   verified. Investigation IDs 2 (Kidde) and 3 (Zen Magnets); id 1 is an
   orphaned Kidde investigation from step 3's bug-hunting (permanently
   stuck at EVIDENCE_SUBMITTED with one unverifiable evidence item — evidence
   is append-only, no fix-up possible; harmless, causes no errors, just
   inert leftover state); id 4 is the cancel-exercise investigation.

**Lesson for the next redeploy cycle**: when `gl.nondet.web.*` code
behaves unexpectedly, reach for the disposable diagnostic contract
immediately rather than iterating blind on RecallRaid's own address —
every guess against RecallRaid costs a real redeploy + DB-clear +
live-test cycle; a diagnostic-contract iteration costs nothing and
converges faster (this round needed 4 diagnostic deploys to fully
root-cause, which would otherwise have been 4 wasted RecallRaid
redeploys).

Updated `README.md` (status section, "How it works" evidence/challenge/
seller-bond paragraphs, repository layout, live-testing section) and
rewrote `review.md` end-to-end to cover both audit rounds and the full
bug-hunting story, per explicit user request to keep both current.
