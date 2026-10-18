// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "../RecallRaidEscrow.sol";

interface Vm {
    function prank(address) external;
    function expectRevert() external;
    function warp(uint256) external;
    function sign(uint256, bytes32) external returns (uint8, bytes32, bytes32);
    function addr(uint256) external returns (address);
}

contract MockUSDC is IERC20 {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    function mint(address to, uint256 amount) external { balanceOf[to] += amount; }
    function approve(address spender, uint256 amount) external returns (bool) { allowance[msg.sender][spender] = amount; return true; }
    function transfer(address to, uint256 amount) external returns (bool) {
        require(balanceOf[msg.sender] >= amount, "balance");
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }
    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        require(balanceOf[from] >= amount && allowance[from][msg.sender] >= amount, "funds/allowance");
        allowance[from][msg.sender] -= amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        return true;
    }
}

contract RecallRaidEscrowTest {
    Vm private constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));
    uint256 private constant ATTESTOR_KEY = 0xA11CE;
    address private constant PAYER = address(0x1001);
    address private constant CHALLENGER = address(0x1002);
    address private constant HUNTER = address(0x1003);
    address private constant SELLER = address(0x1004);
    address private constant RELAYER = address(0x1005);
    address private constant GENLAYER_CONTRACT = address(0x2001);
    uint32 private constant INVESTIGATION_ID = 12;
    uint256 private constant BOUNTY = 100_000_000;
    uint256 private constant OVERTURN_BONUS = BOUNTY * 1_500 / 10_000;

    MockUSDC private token;
    RecallRaidEscrow private escrow;
    address private attestor;

    bytes32 private constant DOMAIN_TYPEHASH = keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");
    bytes32 private constant ADJUDICATION_TYPEHASH = keccak256("Adjudication(bytes32 caseId,address genlayerContract,uint32 investigationId,uint8 verdictCode,address hunter,uint32 challengeId,address challenger,bool challengeOverturned,bytes32 sellerBondId,uint256 sellerBondSlash,bytes32 decisionHash)");
    bytes32 private constant CANCELLATION_TYPEHASH = keccak256("Cancellation(bytes32 caseId,address genlayerContract,uint32 investigationId,bytes32 decisionHash)");
    bytes32 private constant REGISTRATION_TYPEHASH = keccak256("Registration(bytes32 caseId,address submitter,uint256 bounty,address genlayerContract,uint32 investigationId)");
    bytes32 private constant ORPHAN_RECOVERY_TYPEHASH = keccak256("OrphanRecovery(bytes32 caseId,address submitter,uint256 bounty)");

    function setUp() public {
        token = new MockUSDC();
        attestor = vm.addr(ATTESTOR_KEY);
        escrow = new RecallRaidEscrow(address(token), RELAYER, attestor);
        token.mint(PAYER, BOUNTY);
        token.mint(CHALLENGER, BOUNTY);
        token.mint(SELLER, BOUNTY);
        token.mint(address(0x999), BOUNTY);
        vm.prank(PAYER); token.approve(address(escrow), type(uint256).max);
        vm.prank(CHALLENGER); token.approve(address(escrow), type(uint256).max);
        vm.prank(address(0x999)); token.approve(address(escrow), type(uint256).max);
        vm.prank(SELLER); token.approve(address(escrow), type(uint256).max);
    }

    function testRejectsUnauthorizedAndDuplicateCaseRegistration() public {
        bytes32 id = keccak256("owner-bound-case");
        _fund(id);
        vm.prank(address(0x999));
        vm.expectRevert(); escrow.registerGenLayerCase(id, PAYER, BOUNTY, GENLAYER_CONTRACT, INVESTIGATION_ID, "");
        vm.prank(RELAYER);
        vm.expectRevert(); escrow.registerGenLayerCase(id, address(0x999), BOUNTY, GENLAYER_CONTRACT, INVESTIGATION_ID, "");
        vm.prank(RELAYER);
        vm.expectRevert(); escrow.registerGenLayerCase(id, PAYER, BOUNTY - 1, GENLAYER_CONTRACT, INVESTIGATION_ID, "");
        bytes memory registration = _signRegistration(id, PAYER, BOUNTY);
        vm.prank(RELAYER);
        vm.expectRevert(); escrow.registerGenLayerCase(id, PAYER, BOUNTY, GENLAYER_CONTRACT, INVESTIGATION_ID + 1, registration);
        vm.prank(RELAYER); escrow.registerGenLayerCase(id, PAYER, BOUNTY, GENLAYER_CONTRACT, INVESTIGATION_ID, registration);
        vm.prank(RELAYER);
        vm.expectRevert(); escrow.registerGenLayerCase(id, PAYER, BOUNTY, GENLAYER_CONTRACT, INVESTIGATION_ID, registration);
    }

    function testModifiedSettlementInstructionIsRejected() public {
        bytes32 id = keccak256("attested-case");
        _fund(id); _register(id);
        bytes32 decision = keccak256("final-genlayer-state");
        bytes memory auth = _signAdjudication(id, 2, HUNTER, 0, address(0), false, decision);
        vm.prank(address(0x999));
        vm.expectRevert(); escrow.relayAdjudication(id, GENLAYER_CONTRACT, INVESTIGATION_ID, 2, HUNTER, 0, address(0), false, bytes32(0), 0, decision, auth);
        vm.prank(RELAYER);
        vm.expectRevert(); escrow.relayAdjudication(id, GENLAYER_CONTRACT, INVESTIGATION_ID + 1, 2, HUNTER, 0, address(0), false, bytes32(0), 0, decision, auth);
        vm.prank(RELAYER);
        vm.expectRevert(); escrow.relayAdjudication(id, GENLAYER_CONTRACT, INVESTIGATION_ID, 3, HUNTER, 0, address(0), false, bytes32(0), 0, decision, auth);
        vm.prank(RELAYER);
        vm.expectRevert(); escrow.relayAdjudication(id, GENLAYER_CONTRACT, INVESTIGATION_ID, 2, address(0x7777), 0, address(0), false, bytes32(0), 0, decision, auth);
        vm.prank(RELAYER);
        vm.expectRevert(); escrow.relayAdjudication(id, GENLAYER_CONTRACT, INVESTIGATION_ID, 2, HUNTER, 0, address(0), true, bytes32(0), 0, decision, auth);
        vm.prank(RELAYER);
        vm.expectRevert(); escrow.relayAdjudication(id, GENLAYER_CONTRACT, INVESTIGATION_ID, 2, HUNTER, 0, address(0), false, keccak256("altered-bond"), 0, decision, auth);
        vm.prank(RELAYER);
        vm.expectRevert(); escrow.relayAdjudication(id, GENLAYER_CONTRACT, INVESTIGATION_ID, 2, HUNTER, 0, address(0), false, bytes32(0), 1, decision, auth);
        require(!escrow.getCase(id).finalized, "modified instruction finalized");
    }

    function testOverturnedChallengePaysBaseFundedChallengerStake() public {
        bytes32 id = keccak256("overturned-case");
        _fund(id); _register(id);
        vm.prank(address(0x999)); escrow.fundChallenge(id, BOUNTY / 5);
        vm.prank(CHALLENGER); escrow.fundChallenge(id, BOUNTY / 5);
        bytes32 decision = keccak256("overturned-genlayer-result");
        bytes memory auth = _signAdjudication(id, 2, HUNTER, 7, CHALLENGER, true, decision);
        vm.prank(RELAYER); vm.expectRevert(); escrow.relayAdjudication(id, GENLAYER_CONTRACT, INVESTIGATION_ID, 2, HUNTER, 8, CHALLENGER, true, bytes32(0), 0, decision, auth);
        vm.prank(RELAYER); vm.expectRevert(); escrow.relayAdjudication(id, GENLAYER_CONTRACT, INVESTIGATION_ID, 2, HUNTER, 7, address(0x999), true, bytes32(0), 0, decision, auth);
        vm.prank(RELAYER); vm.expectRevert(); escrow.relayAdjudication(id, GENLAYER_CONTRACT, INVESTIGATION_ID, 2, HUNTER, 7, CHALLENGER, false, bytes32(0), 0, decision, auth);
        vm.prank(RELAYER); escrow.relayAdjudication(id, GENLAYER_CONTRACT, INVESTIGATION_ID, 2, HUNTER, 7, CHALLENGER, true, bytes32(0), 0, decision, auth);
        require(escrow.claimable(CHALLENGER) == BOUNTY / 5 + OVERTURN_BONUS, "challenger stake and bonus misallocated");
        require(escrow.claimable(HUNTER) == BOUNTY - OVERTURN_BONUS, "net bounty misallocated");
        require(escrow.claimable(CHALLENGER) + escrow.claimable(HUNTER) == BOUNTY + BOUNTY / 5, "selected deposits not conserved");
        vm.prank(CHALLENGER); escrow.claim();
        vm.prank(HUNTER); escrow.claim();
        require(token.balanceOf(CHALLENGER) == BOUNTY + OVERTURN_BONUS, "challenger USDC balance missing bonus");
        require(token.balanceOf(HUNTER) == BOUNTY - OVERTURN_BONUS, "hunter net USDC bounty not transferred");
        require(escrow.getChallengeDeposit(id, address(0x999)).amount == BOUNTY / 5, "unrelated stake overwritten");
        // Deposits that do not match the attested GenLayer challenger remain
        // independently recoverable as soon as the case is finalized.
        vm.prank(address(0x999)); escrow.recoverUnmatchedChallengeDeposit(id);
        require(escrow.claimable(address(0x999)) == BOUNTY / 5, "unmatched deposit not recoverable");
        vm.prank(address(0x999)); escrow.claim();
        require(token.balanceOf(address(0x999)) == BOUNTY, "unmatched USDC recovery transfer missing");
        require(token.balanceOf(address(escrow)) == 0, "escrow retained deposited USDC");
    }

    function testRejectsWrongChallengeStakeAndOccupiedChallengeSlot() public {
        bytes32 id = keccak256("challenge-binding");
        _fund(id); _register(id);
        vm.prank(CHALLENGER); vm.expectRevert(); escrow.fundChallenge(id, 1);
        vm.prank(CHALLENGER); escrow.fundChallenge(id, BOUNTY / 5);
        vm.prank(CHALLENGER); vm.expectRevert(); escrow.fundChallenge(id, BOUNTY / 5);
        vm.prank(address(0x999)); escrow.fundChallenge(id, BOUNTY / 5);
    }

    function testOverturnBonusRoundingConservesEveryBaseUnit() public {
        bytes32 id = keccak256("rounding-case");
        uint256 bounty = 101;
        uint256 stake = bounty / 5;
        uint256 bonus = bounty * 1_500 / 10_000;
        vm.prank(PAYER); escrow.fundInvestigation(id, bounty);
        vm.prank(RELAYER); escrow.registerGenLayerCase(id, PAYER, bounty, GENLAYER_CONTRACT, INVESTIGATION_ID, _signRegistration(id, PAYER, bounty));
        vm.prank(CHALLENGER); escrow.fundChallenge(id, stake);
        bytes32 decision = keccak256("rounded-overturn");
        vm.prank(RELAYER); escrow.relayAdjudication(id, GENLAYER_CONTRACT, INVESTIGATION_ID, 2, HUNTER, 9, CHALLENGER, true, bytes32(0), 0, decision, _signAdjudication(id, 2, HUNTER, 9, CHALLENGER, true, decision));
        require(escrow.claimable(HUNTER) == bounty - bonus, "rounding remainder missing");
        require(escrow.claimable(CHALLENGER) == stake + bonus, "rounded challenger reward wrong");
        require(escrow.claimable(HUNTER) + escrow.claimable(CHALLENGER) == bounty + stake, "rounded deposits not conserved");
    }

    function testNoIssueRefundsSubmitterWithAttestedVerdict() public {
        bytes32 id = keccak256("no-issue-refund");
        _fund(id); _register(id);
        bytes32 decision = keccak256("no-issue");
        bytes memory auth = _signAdjudication(id, 1, address(0), 0, address(0), false, decision);
        vm.prank(RELAYER); escrow.relayAdjudication(id, GENLAYER_CONTRACT, INVESTIGATION_ID, 1, address(0), 0, address(0), false, bytes32(0), 0, decision, auth);
        require(escrow.claimable(PAYER) == BOUNTY, "submitter refund missing");
        vm.prank(PAYER); escrow.claim();
        require(token.balanceOf(PAYER) == BOUNTY, "refund transfer missing");
    }

    function testRecallConfirmedSlashesLinkedSellerBond() public {
        bytes32 id = keccak256("recall-bond-case");
        bytes32 bondId = keccak256("seller-bond");
        _fund(id); _register(id);
        vm.prank(SELLER); escrow.fundSellerBond(bondId, BOUNTY / 2);
        vm.prank(SELLER); escrow.linkSellerBond(id, bondId);
        bytes32 decision = keccak256("recall-confirmed");
        bytes memory auth = _signAdjudicationWithBond(id, 3, HUNTER, 0, address(0), false, bondId, BOUNTY / 2, decision);
        vm.prank(RELAYER); escrow.relayAdjudication(id, GENLAYER_CONTRACT, INVESTIGATION_ID, 3, HUNTER, 0, address(0), false, bondId, BOUNTY / 2, decision, auth);
        (, , , uint256 totalSlashed, , ) = escrow.sellerBonds(bondId);
        require(totalSlashed == BOUNTY / 2, "bond not slashed");
        require(escrow.claimable(HUNTER) == BOUNTY + BOUNTY / 2, "hunter slash payout missing");
        vm.prank(HUNTER); escrow.claim();
        require(token.balanceOf(HUNTER) == BOUNTY + BOUNTY / 2, "hunter USDC slash payout missing");
    }

    function testRejectsModifiedSellerBondSlashInstruction() public {
        bytes32 id = keccak256("modified-slash-case");
        bytes32 bondId = keccak256("modified-slash-bond");
        _fund(id); _register(id);
        vm.prank(SELLER); escrow.fundSellerBond(bondId, BOUNTY / 2);
        vm.prank(SELLER); escrow.linkSellerBond(id, bondId);
        bytes32 decision = keccak256("recall-confirmed-slash");
        bytes memory auth = _signAdjudicationWithBond(id, 3, HUNTER, 0, address(0), false, bondId, BOUNTY / 2, decision);
        vm.prank(RELAYER);
        vm.expectRevert();
        escrow.relayAdjudication(id, GENLAYER_CONTRACT, INVESTIGATION_ID, 3, HUNTER, 0, address(0), false, bondId, BOUNTY / 2 - 1, decision, auth);
        require(!escrow.getCase(id).finalized, "modified slash finalized");
        (, uint256 balance, , , , ) = escrow.sellerBonds(bondId);
        require(balance == BOUNTY / 2, "modified slash changed bond balance");
    }

    function testOrphanRecoveryAfterDeadlineAndNotAfterRegistration() public {
        bytes32 orphan = keccak256("orphan");
        _fund(orphan);
        vm.warp(block.timestamp + 7 days);
        bytes memory recovery = _signOrphanRecovery(orphan, PAYER, BOUNTY);
        vm.prank(address(0x999)); vm.expectRevert(); escrow.recoverOrphanDeposit(orphan, recovery);
        vm.prank(PAYER); escrow.recoverOrphanDeposit(orphan, recovery);
        require(escrow.claimable(PAYER) == BOUNTY, "orphan recovery missing");
        vm.prank(PAYER); escrow.claim();
        require(token.balanceOf(PAYER) == BOUNTY, "orphan USDC recovery transfer missing");

        bytes32 active = keccak256("active");
        token.mint(PAYER, BOUNTY);
        _fund(active); _register(active);
        vm.warp(block.timestamp + 8 days);
        vm.prank(PAYER); vm.expectRevert(); escrow.recoverOrphanDeposit(active, _signOrphanRecovery(active, PAYER, BOUNTY));
    }

    function testCancellationRequiresMatchingAttestationAndRelayer() public {
        bytes32 id = keccak256("cancel-case");
        _fund(id); _register(id);
        bytes32 decision = keccak256("terminal-genlayer-cancel");
        bytes32 structHash = keccak256(abi.encode(CANCELLATION_TYPEHASH, id, GENLAYER_CONTRACT, INVESTIGATION_ID, decision));
        bytes memory auth = _sign(_digest(structHash));
        vm.prank(address(0x999)); vm.expectRevert(); escrow.relayCancellation(id, GENLAYER_CONTRACT, INVESTIGATION_ID, decision, auth);
        vm.prank(RELAYER); vm.expectRevert(); escrow.relayCancellation(id, GENLAYER_CONTRACT, INVESTIGATION_ID, keccak256("modified"), auth);
        vm.prank(RELAYER); escrow.relayCancellation(id, GENLAYER_CONTRACT, INVESTIGATION_ID, decision, auth);
        require(escrow.claimable(PAYER) == BOUNTY, "cancellation refund missing");
        vm.prank(PAYER); escrow.claim();
        require(token.balanceOf(PAYER) == BOUNTY, "cancellation USDC refund missing");
    }

    function _fund(bytes32 id) private {
        vm.prank(PAYER); escrow.fundInvestigation(id, BOUNTY);
    }
    function _register(bytes32 id) private {
        vm.prank(RELAYER); escrow.registerGenLayerCase(id, PAYER, BOUNTY, GENLAYER_CONTRACT, INVESTIGATION_ID, _signRegistration(id, PAYER, BOUNTY));
    }
    function _signAdjudication(bytes32 id, uint8 verdict, address hunter, uint32 challengeId, address challenger, bool overturned, bytes32 decision) private returns (bytes memory) {
        return _signAdjudicationWithBond(id, verdict, hunter, challengeId, challenger, overturned, bytes32(0), 0, decision);
    }
    function _signAdjudicationWithBond(bytes32 id, uint8 verdict, address hunter, uint32 challengeId, address challenger, bool overturned, bytes32 bondId, uint256 bondSlash, bytes32 decision) private returns (bytes memory) {
        bytes32 structHash = keccak256(abi.encode(ADJUDICATION_TYPEHASH, id, GENLAYER_CONTRACT, INVESTIGATION_ID, verdict, hunter, challengeId, challenger, overturned, bondId, bondSlash, decision));
        return _sign(_digest(structHash));
    }
    function _sign(bytes32 digest) private returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(ATTESTOR_KEY, digest);
        return abi.encodePacked(r, s, v);
    }
    function _signRegistration(bytes32 id, address submitter, uint256 bounty) private returns (bytes memory) {
        bytes32 structHash = keccak256(abi.encode(REGISTRATION_TYPEHASH, id, submitter, bounty, GENLAYER_CONTRACT, INVESTIGATION_ID));
        return _sign(_digest(structHash));
    }
    function _signOrphanRecovery(bytes32 id, address submitter, uint256 bounty) private returns (bytes memory) {
        bytes32 structHash = keccak256(abi.encode(ORPHAN_RECOVERY_TYPEHASH, id, submitter, bounty));
        return _sign(_digest(structHash));
    }
    function _digest(bytes32 structHash) private view returns (bytes32) {
        bytes32 domain = keccak256(abi.encode(DOMAIN_TYPEHASH, keccak256("RecallRaidEscrow"), keccak256("1"), block.chainid, address(escrow)));
        return keccak256(abi.encodePacked("\x19\x01", domain, structHash));
    }
}
