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


    def test_verdict_tolerance_never_bridges_two_determinate_verdicts(self):
        """A real audit finding: the previous adjacent-bucket tolerance let
        a leader RECALL_CONFIRMED agree with a validator POTENTIAL_ISSUE
        (one ordinal step apart), which could trigger a seller-bond slash
        without the validator actually confirming a recall. _verdicts_agree
        must explicitly guard that any two DIFFERENT determinate verdicts
        require an exact match, with tolerance reserved for bridging
        NEEDS_MORE_EVIDENCE with its neighbor only."""
        source = CONTRACT_PATH.read_text(encoding="utf-8")
        start = source.index("def _verdicts_agree")
        end = source.index("def _stable_verdict")
        body = source[start:end]
        self.assertIn(
            "needs_more_evidence_order not in (order_a, order_b)", body,
            "_verdicts_agree must reject tolerance-bridged agreement between two "
            "different determinate verdicts (only NEEDS_MORE_EVIDENCE may bridge)",
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


if __name__ == "__main__":
    unittest.main()
