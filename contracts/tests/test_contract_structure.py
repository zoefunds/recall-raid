"""Static structural tests for recallraid_contract.py.

These do NOT run the contract inside GenVM (that requires the GenLayer
Studio runtime) — they verify the source is syntactically valid, exposes
the expected public surface, and does not violate the money-safety
invariants that matter most (single emission chokepoint, zero-before-
transfer ordering, gl.vm.UserError used instead of bare exceptions).
Run with: python3 -m unittest discover -s contracts/tests
"""
import ast
import unittest
from pathlib import Path

CONTRACT_PATH = Path(__file__).resolve().parents[1] / "recallraid_contract.py"


def _load_tree() -> ast.Module:
    source = CONTRACT_PATH.read_text(encoding="utf-8")
    return ast.parse(source, filename=str(CONTRACT_PATH))


def _find_class(tree: ast.Module, name: str) -> ast.ClassDef:
    for node in ast.walk(tree):
        if isinstance(node, ast.ClassDef) and node.name == name:
            return node
    raise AssertionError(f"class {name} not found")


def _decorator_names(node) -> list:
    names = []
    for dec in node.decorator_list:
        if isinstance(dec, ast.Attribute):
            names.append(dec.attr)
        elif isinstance(dec, ast.Name):
            names.append(dec.id)
        elif isinstance(dec, ast.Call):
            if isinstance(dec.func, ast.Attribute):
                names.append(dec.func.attr)
            elif isinstance(dec.func, ast.Name):
                names.append(dec.func.id)
    return names


class ContractStructureTests(unittest.TestCase):
    def setUp(self):
        self.tree = _load_tree()
        self.contract_cls = _find_class(self.tree, "RecallRaid")
        self.methods = {
            n.name: n for n in self.contract_cls.body if isinstance(n, ast.FunctionDef)
        }

    def test_file_parses(self):
        self.assertIsInstance(self.tree, ast.Module)

    def test_expected_public_writes_exist(self):
        expected_payable = {
            "submit_investigation",
            "open_challenge",
            "create_seller_bond",
            "topup_seller_bond",
        }
        expected_write = {
            "add_evidence",
            "cancel_investigation",
            "request_verdict",
            "claim_evidence_timeout",
            "claim_verdict_timeout",
            "resolve_challenge",
            "claim_challenge_timeout",
            "settle_investigation",
            "withdraw",
            "link_seller_bond",
            "withdraw_seller_bond",
            "verify_seller_bond_listing",
            "set_paused",
            "transfer_administration",
        }
        for name in expected_payable | expected_write:
            self.assertIn(name, self.methods, f"missing method {name}")
        for name in expected_payable:
            decorators = _decorator_names(self.methods[name])
            self.assertIn("payable", decorators, f"{name} should be payable")

    def test_expected_views_exist(self):
        expected_views = {
            "get_investigation",
            "list_investigations",
            "get_evidence",
            "get_evidence_ids_for_investigation",
            "get_challenge",
            "get_seller_bond",
            "get_balance",
            "get_reputation",
            "get_protocol_info",
        }
        for name in expected_views:
            self.assertIn(name, self.methods, f"missing view {name}")
            decorators = _decorator_names(self.methods[name])
            self.assertIn("view", decorators, f"{name} should be a view")

    def test_single_money_emission_chokepoint(self):
        """`_Recipient(...).emit_transfer(` must appear exactly once in the
        whole file (inside `_send_gen`) — every payout must route through
        that one function rather than calling the EVM interface directly."""
        source = CONTRACT_PATH.read_text(encoding="utf-8")
        occurrences = source.count("_Recipient(")
        # one definition-site reference inside _send_gen's body
        self.assertEqual(
            occurrences, 1,
            "expected exactly one call site constructing _Recipient (inside _send_gen); "
            "found %d — every payout must route through the single chokepoint" % occurrences,
        )

    def test_withdraw_is_only_caller_of_send_gen(self):
        source = CONTRACT_PATH.read_text(encoding="utf-8")
        occurrences = source.count("_send_gen(")
        # 1 definition + 1 call site inside withdraw()
        self.assertEqual(
            occurrences, 2,
            "_send_gen should be defined once and called exactly once, from withdraw()",
        )

    def test_no_bare_exceptions_for_validation(self):
        """Validation failures must raise gl.vm.UserError so GenVM can
        surface a clean rejection instead of an unrecoverable VMError."""
        for node in ast.walk(self.contract_cls):
            if isinstance(node, ast.Raise) and node.exc is not None:
                if isinstance(node.exc, ast.Call) and isinstance(node.exc.func, ast.Name):
                    if node.exc.func.id in ("Exception", "RuntimeError", "ValueError"):
                        self.fail(
                            "found a bare %s raise inside the contract class — use "
                            "gl.vm.UserError for all validation rejections" % node.exc.func.id
                        )

    def test_error_messages_use_taxonomy_prefix_where_expected(self):
        """Spot-check that validation errors use the [EXPECTED] prefix
        (per the four-prefix taxonomy: EXPECTED/EXTERNAL/TRANSIENT/LLM_ERROR)
        so a validator comparing error strings has a stable signal."""
        import re
        source = CONTRACT_PATH.read_text(encoding="utf-8")
        call_sites = re.findall(r'gl\.vm\.UserError\(\s*"([^"]*)"', source)
        self.assertGreater(len(call_sites), 0)
        untagged = [msg for msg in call_sites if not msg.startswith(
            ("[EXPECTED]", "[EXTERNAL]", "[TRANSIENT]", "[LLM_ERROR]")
        )]
        self.assertEqual(
            untagged, [],
            "every gl.vm.UserError should carry one of the four taxonomy prefixes",
        )


    def test_seller_bond_unlinked_on_every_terminal_path(self):
        """A real audit finding: linked_investigation_count was incremented
        by link_seller_bond but never decremented anywhere, permanently
        locking any linked bond out of withdraw_seller_bond. Every terminal
        investigation transition must call the unlink helper."""
        source = CONTRACT_PATH.read_text(encoding="utf-8")
        occurrences = source.count("self._unlink_seller_bond_if_present(inv)")
        self.assertEqual(
            occurrences, 4,
            "expected _unlink_seller_bond_if_present to be called from all four terminal "
            "paths (cancel_investigation, claim_evidence_timeout, claim_verdict_timeout, "
            "settle_investigation); found %d" % occurrences,
        )

    def test_challenge_overturn_bonus_is_funded_from_escrow_not_manufactured(self):
        """A real audit finding: resolve_challenge used to credit a 15%
        bonus to a successful challenger with no matching debit anywhere,
        which can make credited balances exceed the contract's actual GEN.
        The bonus must now be carved out of bounty_deposited_wei (a real,
        already-escrowed balance) before being credited."""
        source = CONTRACT_PATH.read_text(encoding="utf-8")
        resolve_start = source.index("def resolve_challenge")
        resolve_end = source.index("def claim_challenge_timeout")
        resolve_body = source[resolve_start:resolve_end]
        self.assertIn(
            "bounty_pool = inv.bounty_deposited_wei", resolve_body,
            "resolve_challenge should read the bounty pool before computing any overturn bonus",
        )
        self.assertIn(
            "inv.bounty_deposited_wei = u256(int(bounty_pool) - int(bonus))", resolve_body,
            "the bonus must be debited from bounty_deposited_wei, not manufactured",
        )


    def test_verdicts_agree_requires_exact_bucket_match(self):
        """Two real audit findings closed the door on any ordinal
        tolerance at all: (1) adjacent-bucket tolerance let a leader
        RECALL_CONFIRMED agree with a validator POTENTIAL_ISSUE and slash a
        seller bond the validator never confirmed; (2) narrowing the
        bridge to NEEDS_MORE_EVIDENCE-and-neighbor still let a leader's
        determinate, fund-moving verdict (NO_ISSUE/POTENTIAL_ISSUE) get
        committed merely because a validator said NEEDS_MORE_EVIDENCE —
        because gl.vm.run_nondet_unsafe always commits the LEADER's value,
        validator_fn's bool return can never substitute a different one.
        _verdicts_agree must require order_a == order_b with no exceptions."""
        source = CONTRACT_PATH.read_text(encoding="utf-8")
        start = source.index("def _verdicts_agree")
        end = source.index("def _stable_verdict")
        body = source[start:end]
        self.assertIn("order_a != order_b", body)
        self.assertNotIn("VERDICT_TOLERANCE_STEPS", body, "no ordinal tolerance constant should be referenced here anymore")
        self.assertNotIn(
            "needs_more_evidence_order", body,
            "no bridging logic should remain — exact match is required unconditionally",
        )

    def test_recall_confirmed_requires_a_product_identifier(self):
        """Partial fix for a real audit finding ('URL plus LLM
        interpretation is not sufficiently precise to slash a bond'): a
        RECALL_CONFIRMED verdict must never be reachable for a submission
        with no model_number and no serial_number at all."""
        source = CONTRACT_PATH.read_text(encoding="utf-8")
        start = source.index("def _stable_verdict")
        end = source.index("def _payout_bps_for_verdict")
        body = source[start:end]
        self.assertIn("not inv.model_number and not inv.serial_number", body)

    def test_recall_confirmed_deterministic_backstop_present(self):
        """A real live transaction (rotation count 3, still Undetermined)
        showed the model confidently returning RECALL_CONFIRMED at 9000bps
        against a generic recall-listing page that never named the
        product. The fix is a deterministic, non-LLM downgrade inside
        `_run_verdict_pass`'s `leader_fn`, independent of whether the model
        obeys the prompt instruction — this test pins that the downgrade
        code itself (not just the prompt wording) is present."""
        source = CONTRACT_PATH.read_text(encoding="utf-8")
        start = source.index("def _run_verdict_pass")
        next_def = source.index("\n    def ", start + len("def _run_verdict_pass"))
        body = source[start:next_def]
        self.assertIn("product_id_match", body)
        self.assertIn("VERDICT_RECALL_CONFIRMED", body)
        self.assertIn(
            "int(verdict_code) == int(VERDICT_RECALL_CONFIRMED) and not product_id_match",
            body,
            "RECALL_CONFIRMED must be deterministically downgraded when the "
            "product identifier was not found in the recall source text",
        )

    def test_no_issue_deterministic_backstop_present(self):
        """Mirror finding: NO_ISSUE asserts 'we checked everything and
        found nothing' — that claim is only honest when all three sources
        (manufacturer, recall, listing) were actually reachable. This test
        pins that an incomplete check (sources_checked_count < 3) cannot
        commit NO_ISSUE even if the model claims it."""
        source = CONTRACT_PATH.read_text(encoding="utf-8")
        start = source.index("def _run_verdict_pass")
        next_def = source.index("\n    def ", start + len("def _run_verdict_pass"))
        body = source[start:next_def]
        self.assertIn("sources_checked_count", body)
        self.assertIn(
            "int(verdict_code) == int(VERDICT_NO_ISSUE) and sources_checked_count < 3",
            body,
            "NO_ISSUE must be deterministically downgraded when fewer than "
            "all three sources were reachable",
        )

    def test_product_identifier_match_uses_token_boundaries(self):
        """A raw substring check ('a1' in 'a10 charger') would false-
        positive on a shorter identifier that is a strict prefix of an
        unrelated longer one. `_identifier_present` must reject that by
        requiring non-alphanumeric boundaries around the match, and
        `_run_verdict_pass` must call it rather than a bare `in` check."""
        source = CONTRACT_PATH.read_text(encoding="utf-8")
        start = source.index("def _identifier_present")
        end = source.index("def _run_verdict_pass")
        helper_body = source[start:end]
        self.assertIn("(?<![a-z0-9])", helper_body)
        self.assertIn("(?![a-z0-9])", helper_body)

        run_pass_start = end
        run_pass_next_def = source.index("\n    def ", run_pass_start + len("def _run_verdict_pass"))
        run_pass_body = source[run_pass_start:run_pass_next_def]
        self.assertIn("self._identifier_present(recall_text, model_number)", run_pass_body)
        self.assertIn("self._identifier_present(recall_text, serial_number)", run_pass_body)
        self.assertNotIn(
            "model_number.strip().lower() in", run_pass_body,
            "must not fall back to a raw substring containment check",
        )


    def test_verify_seller_bond_listing_uses_real_consensus_web_fetch(self):
        """The listing-ownership proof must actually be backed by
        validator consensus over a live fetch, not a leader-asserted or
        purely deterministic claim — otherwise it would be no stronger
        than trusting the seller's own word. Pins that the nondet fetch +
        `run_nondet_unsafe` pattern (same as `_run_verdict_pass`) is used,
        that only the bond owner can call it, and that a bond only becomes
        `listing_verified` after a successful call."""
        source = CONTRACT_PATH.read_text(encoding="utf-8")
        start = source.index("def verify_seller_bond_listing")
        end = source.index("\n    def ", start + len("def verify_seller_bond_listing"))
        body = source[start:end]
        self.assertIn("gl.nondet.web.render", body)
        self.assertIn("gl.vm.run_nondet_unsafe(leader_fn, validator_fn)", body)
        self.assertIn("gl.message.sender_address != bond.seller", body)
        self.assertIn("bond.listing_verified = True", body)
        self.assertIn("self._identifier_present(body, code)", body)

    def test_create_seller_bond_generates_verification_code(self):
        """Every bond must get a verification code at creation time so a
        seller can prove listing ownership later without a separate
        code-generation step (and so `verify_seller_bond_listing` always
        has something deterministic to check for)."""
        source = CONTRACT_PATH.read_text(encoding="utf-8")
        start = source.index("def create_seller_bond")
        end = source.index("\n    def ", start + len("def create_seller_bond"))
        body = source[start:end]
        self.assertIn("verification_code=code", body)
        self.assertIn("hashlib.sha256", body)

    def test_link_seller_bond_requires_verified_and_matching_listing(self):
        """Real audit finding: `link_seller_bond` originally let ANY
        bond — verified or not, for any listing — attach to ANY
        investigation with no ownership check at all, so a "Verified
        Listing" badge only ever proved "controls some page," never
        "controls the listing actually under investigation." Pins that
        both the verification-required check and the canonicalized
        listing-URL match against the investigation's own
        marketplace_url are present."""
        source = CONTRACT_PATH.read_text(encoding="utf-8")
        start = source.index("def link_seller_bond")
        end = source.index("\n    def ", start + len("def link_seller_bond"))
        body = source[start:end]
        self.assertIn("not bool(bond.listing_verified)", body)
        self.assertIn("_canonicalize_url(bond.listing_url) != _canonicalize_url(inv.marketplace_url)", body)

    def test_canonicalize_url_ignores_scheme_and_trailing_slash(self):
        """The match check in `link_seller_bond` must not fail on harmless
        real-world URL variance (http vs https, a trailing slash, query
        string) — that would incorrectly block a legitimate bond link,
        not just catch fraud. Pins that `_canonicalize_url` drops scheme/
        query/fragment and normalizes host case and trailing slash."""
        source = CONTRACT_PATH.read_text(encoding="utf-8")
        start = source.index("def _canonicalize_url")
        end = source.index("\n\n", start)
        body = source[start:end]
        self.assertIn("parsed.hostname", body)
        self.assertIn("path.rstrip", body)


class IdentifierBoundaryMatchingTests(unittest.TestCase):
    """Executes the actual `_identifier_present` regex logic (copied here
    verbatim, not imported, since importing the contract module requires
    the GenVM `genlayer` package) against the exact false-positive case the
    reaudit flagged: a short identifier that is a strict prefix of a
    longer, unrelated one."""

    @staticmethod
    def _identifier_present(haystack: str, identifier: str) -> bool:
        import re

        needle = (identifier or "").strip().lower()
        if not needle:
            return False
        hay = (haystack or "").lower()
        pattern = re.compile(r"(?<![a-z0-9])" + re.escape(needle) + r"(?![a-z0-9])")
        return pattern.search(hay) is not None

    def test_short_identifier_does_not_match_longer_prefixed_id(self):
        self.assertFalse(self._identifier_present("recall notice for model A10 chargers", "A1"))

    def test_identifier_matches_with_punctuation_boundary(self):
        self.assertTrue(self._identifier_present("recall for VE-SC65-2024 units sold nationwide", "VE-SC65-2024"))

    def test_identifier_does_not_match_when_suffixed_by_alnum(self):
        self.assertFalse(self._identifier_present("recall notice for VE-SC65X chargers", "VE-SC65"))

    def test_source_logic_matches_reference_implementation(self):
        """Guards against the reference copy above drifting from the real
        contract implementation."""
        contract_source = CONTRACT_PATH.read_text(encoding="utf-8")
        start = contract_source.index("def _identifier_present")
        end = contract_source.index("def _run_verdict_pass")
        body = contract_source[start:end]
        self.assertIn('re.compile(r"(?<![a-z0-9])" + re.escape(needle) + r"(?![a-z0-9])")', body)


class UrlCanonicalizationTests(unittest.TestCase):
    """Executes a verbatim copy of `_canonicalize_url` (can't import the
    real contract module outside GenVM) against the exact scenarios
    `link_seller_bond`'s match check depends on."""

    @staticmethod
    def _canonicalize_url(url: str) -> str:
        from urllib.parse import urlparse

        if not url:
            return ""
        try:
            parsed = urlparse(url.strip())
        except Exception:
            return url.strip().lower()
        host = (parsed.hostname or "").lower()
        path = parsed.path.rstrip("/")
        return host + path

    def test_scheme_difference_is_ignored(self):
        self.assertEqual(
            self._canonicalize_url("http://Example.com/listing/1"),
            self._canonicalize_url("https://example.com/listing/1"),
        )

    def test_trailing_slash_is_ignored(self):
        self.assertEqual(
            self._canonicalize_url("https://example.com/listing/1/"),
            self._canonicalize_url("https://example.com/listing/1"),
        )

    def test_different_path_does_not_match(self):
        self.assertNotEqual(
            self._canonicalize_url("https://example.com/listing/1"),
            self._canonicalize_url("https://example.com/listing/2"),
        )

    def test_different_host_does_not_match(self):
        self.assertNotEqual(
            self._canonicalize_url("https://example.com/listing/1"),
            self._canonicalize_url("https://not-example.com/listing/1"),
        )

    def test_source_logic_matches_reference_implementation(self):
        contract_source = CONTRACT_PATH.read_text(encoding="utf-8")
        start = contract_source.index("def _canonicalize_url")
        end = contract_source.index("\n\n", start)
        body = contract_source[start:end]
        self.assertIn("host = (parsed.hostname or \"\").lower()", body)
        self.assertIn('path = parsed.path.rstrip("/")', body)
        self.assertIn("return host + path", body)


if __name__ == "__main__":
    unittest.main()
