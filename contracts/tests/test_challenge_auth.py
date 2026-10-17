"""Direct GenVM tests for the challenge-opening authority boundary."""

import json


def test_unrelated_wallet_cannot_occupy_challenge_slot(direct_vm, direct_deploy, direct_bob):
    contract = direct_deploy("contracts/recallraid_contract.py")
    fake_base_tx_hash = "0x" + "ab" * 32

    # The contract checks the deployment admin before looking up an
    # investigation, so an unrelated wallet cannot create or squat on a slot
    # even with a plausible case id, challenger address, stake, and tx hash.
    with direct_vm.prank(direct_bob):
        with direct_vm.expect_revert("caller is not the protocol admin"):
            contract.open_challenge(1, str(direct_bob), "fabricated funding", 1, fake_base_tx_hash)

    assert contract.get_investigation_count() == 0
    assert int(contract.next_challenge_id) == 1


def test_admin_relay_records_the_funded_challenger_not_the_admin(direct_vm, direct_deploy, direct_owner, direct_bob):
    contract = direct_deploy("contracts/recallraid_contract.py")
    case_id = "0x" + "12" * 32
    with direct_vm.prank(direct_owner):
        contract.submit_investigation(
            case_id,
            100_000,
            "Recall test product",
            "Test brand",
            "MODEL-1",
            "SERIAL-1",
            "Test marketplace",
            "https://market.example/item",
            "https://manufacturer.example/product",
            "",
            "Direct-mode challenge authorization fixture",
            "consumer products",
            2,
        )

    # Direct mode has no Base chain. Prepare the adjudicator state to exercise
    # the explicit-challenger argument and slot mutation; Base receipt binding
    # is separately enforced and tested by the authenticated API/escrow tests.
    investigation = contract.investigations[1]
    investigation.status = 3
    investigation.verdict = 1
    investigation.challenge_deadline = 4_000_000_000
    contract.investigations[1] = investigation
    challenger = "0x" + direct_bob.hex()

    with direct_vm.prank(direct_owner):
        contract.open_challenge(1, challenger, "verified Base stake", 20_000, "0x" + "cd" * 32)

    recorded = json.loads(contract.get_challenge(1))
    updated = json.loads(contract.get_investigation(1))
    assert recorded["challenger"].lower() == challenger.lower()
    assert recorded["challenger"].lower() != "0x" + direct_owner.hex()
    assert updated["open_challenge_id"] == 1
    assert updated["last_challenge_id"] == 0
    assert int(contract.next_challenge_id) == 2
