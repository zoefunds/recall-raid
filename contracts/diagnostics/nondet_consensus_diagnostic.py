# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }
#
# Minimal diagnostic contract for isolating whether gl.vm.run_nondet_unsafe
# consensus itself works on a given GenLayer network/runtime, independent
# of anything RecallRaid-specific.
#
# WHY THIS EXISTS: RecallRaid's own live testing showed BOTH of its
# gl.vm.run_nondet_unsafe usages (request_verdict's LLM-based verdict pass,
# verify_seller_bond_listing's web-fetch ownership proof) with a 0%
# observed MAJORITY_AGREE rate across 15+ independent on-chain attempts,
# spanning many different code fixes to each method (including a
# leader_result subscript bug fix, a dict->scalar return-type change, and
# a hosting-platform change for the fetched page). A 0% rate on two
# structurally unrelated nondet operations (one an LLM call, one a plain
# HTTP fetch) is much better explained by a platform/environment issue
# with nondet consensus itself than by chance variance in either method's
# own logic — but that hypothesis needs a controlled test to confirm,
# per an external audit's recommendation. This contract is that control:
# three deliberately trivial writes, each wrapping the same
# leader_fn/validator_fn -> gl.vm.run_nondet_unsafe pattern RecallRaid
# uses, but stripped of every RecallRaid-specific concern (no storage
# reads inside the nondet closure, no complex prompts, no multi-field
# dicts — see RecallRaid's own memory.md for why each of those was
# suspected and ruled out as a contributing factor there).
#
# HOW TO USE: deploy this contract (same GenLayer Studio deploy flow as
# RecallRaid) to whichever network you want to test — StudioNet, local
# `gltest` Studio mode, Testnet Asimov, etc. Call each of the three write
# methods below and record the resulting consensus_data.result_name for
# each (AGREE / MAJORITY_AGREE / MAJORITY_DISAGREE / etc), along with the
# full consensus_data (every node's receipt) if it disagrees. If
# check_constant (the simplest possible nondet round-trip, no I/O at all)
# also fails to reach agreement, that is very strong evidence the issue is
# structural to this environment's nondet consensus mechanism itself, not
# to web-fetch or LLM calls specifically. If check_constant reliably
# agrees but check_web_fetch and/or check_llm_classification do not, that
# narrows the issue to I/O-dependent nondeterminism specifically.
#
# ROOT CAUSE FOUND (first diagnostic run, before this fix): EVERY validator
# crashed with `TypeError: int() argument must be ... not 'Return'` on
# `int(leader_result)` — confirmed against GenLayer's own docs
# (docs.genlayer.com/developers/intelligent-contracts/equivalence-principle):
# `validator_fn`'s `leader_result` parameter is a wrapped `gl.vm.Result`
# object, NOT a plain value — it must be type-checked
# (`isinstance(leader_result, gl.vm.Return)`) and unwrapped via
# `.calldata` before use. Every previous access pattern tried across this
# whole project (`.get()`, bare subscript, `int(...)`) was wrong for the
# same underlying reason: none of them go through `.calldata`. See
# `_unwrap_leader_result` below.

from genlayer import *
from dataclasses import dataclass  # `from genlayer import *` does not re-export this on the pinned runner — see RecallRaid's own contract for the same note.


def _unwrap_leader_result(leader_result):
    """The correct way to read a nondet leader's proposed value inside
    `validator_fn`, per GenLayer's own docs. `leader_result` arrives as a
    `gl.vm.Result` — `gl.vm.Return` on a successful leader execution
    (unwrap via `.calldata`), or `gl.vm.UserError`/`gl.vm.VMError` if the
    leader itself failed/errored (never seen as a leader failure in this
    project's own testing, but handled here for correctness). Returns
    `None` for a non-Return result, which safely never matches a
    real value."""
    if isinstance(leader_result, gl.vm.Return):
        return leader_result.calldata
    return None


class NondetConsensusDiagnostic(gl.Contract):
    last_constant_result: u32
    last_web_fetch_result: u32
    last_llm_result: u32

    def __init__(self):
        self.last_constant_result = u32(0)
        self.last_web_fetch_result = u32(0)
        self.last_llm_result = u32(0)

    # ----------------------------------------------------------------
    # Control 1: the absolute minimum nondet round-trip. No web access,
    # no LLM call — the leader and every validator independently compute
    # a hardcoded constant and must agree it equals itself. If THIS
    # disagrees, the problem is not web-fetch or LLM variance at all; it
    # is nondet consensus itself (validator pool config, runner version,
    # quorum threshold, etc) on this network/runtime.
    # ----------------------------------------------------------------
    @gl.public.write
    def check_constant(self) -> None:
        def leader_fn():
            return 42

        def validator_fn(leader_result):
            candidate = leader_fn()
            return candidate == _unwrap_leader_result(leader_result)

        result = gl.vm.run_nondet_unsafe(leader_fn, validator_fn)
        self.last_constant_result = u32(int(result))

    # ----------------------------------------------------------------
    # Control 2: one real gl.nondet.web.render call against a stable,
    # well-known public page, reduced to the simplest possible scalar
    # check (does the fetched text contain a fixed, extremely stable
    # substring). Deliberately returns a bare int (0/1), not a dict —
    # RecallRaid found a real GenVM inconsistency where a
    # `{"found": bool}` dict was NOT reliably subscriptable inside
    # validator_fn (a `{"verdict": int, "confidence_bps": int}` dict was
    # always fine), so this control uses the same bare-int pattern
    # RecallRaid settled on to avoid conflating that already-diagnosed
    # issue with a new one.
    # ----------------------------------------------------------------
    @gl.public.write
    def check_web_fetch(self) -> None:
        def leader_fn():
            try:
                body = gl.nondet.web.render("https://example.com/", mode="text")
                if isinstance(body, (bytes, bytearray)):
                    body = body.decode("utf-8", errors="replace")
                body = str(body)
            except Exception:  # noqa: BLE001 — an unreachable page just fails the check, never aborts the call
                body = ""
            # "Example Domain" is the stable, unchanging heading text on
            # example.com — chosen specifically because this page is
            # maintained by IANA as a permanent placeholder for
            # documentation/testing and essentially never changes.
            return int("Example Domain" in body)

        def validator_fn(leader_result):
            candidate = leader_fn()
            return candidate == _unwrap_leader_result(leader_result)

        result = gl.vm.run_nondet_unsafe(leader_fn, validator_fn)
        self.last_web_fetch_result = u32(int(result))

    # ----------------------------------------------------------------
    # Control 3: one real gl.nondet.exec_prompt call with the smallest,
    # least ambiguous possible classification task, reduced to a bare
    # int comparison. If independent LLM calls can't even agree on
    # "is 2+2 four", that is strong evidence of an LLM-call consensus
    # problem independent of RecallRaid's own (necessarily more
    # subjective) verdict-adjudication prompt.
    # ----------------------------------------------------------------
    @gl.public.write
    def check_llm_classification(self) -> None:
        def leader_fn():
            prompt = (
                'Respond with ONLY a JSON object with exactly one key: '
                '{"answer": integer}. Question: what is 2 + 2? '
                'Respond only with the JSON object, nothing else.'
            )
            try:
                raw = gl.nondet.exec_prompt(prompt, response_format="json")
                if isinstance(raw, (bytes, bytearray)):
                    raw = raw.decode("utf-8", errors="replace")
                if isinstance(raw, str):
                    cleaned = raw.strip()
                    backticks = "``" + "`"
                    if cleaned.startswith(backticks):
                        cleaned = cleaned.replace(backticks + "json", "").replace(backticks, "").strip()
                    parsed = json.loads(cleaned)
                else:
                    parsed = raw
                answer = int(parsed.get("answer", -1)) if isinstance(parsed, dict) else -1
            except Exception:  # noqa: BLE001 — a malformed LLM response just fails the check, never aborts the call
                answer = -1
            return int(answer)

        def validator_fn(leader_result):
            candidate = leader_fn()
            return candidate == _unwrap_leader_result(leader_result)

        result = gl.vm.run_nondet_unsafe(leader_fn, validator_fn)
        self.last_llm_result = u32(int(result) if int(result) >= 0 else 0)

    # ----------------------------------------------------------------
    # Views — read back the last recorded result of each check. Cross-
    # reference against the actual transaction's consensus_data.result_name
    # (AGREE/MAJORITY_AGREE means consensus succeeded and this value is
    # trustworthy; MAJORITY_DISAGREE/etc means no value was actually
    # agreed and the write's own effect never should have committed).
    # ----------------------------------------------------------------
    @gl.public.view
    def get_last_constant_result(self) -> int:
        return int(self.last_constant_result)

    @gl.public.view
    def get_last_web_fetch_result(self) -> int:
        return int(self.last_web_fetch_result)

    @gl.public.view
    def get_last_llm_result(self) -> int:
        return int(self.last_llm_result)
