// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

/// @title RecallRaidEscrow
/// @notice The complete payment, staking, and escrow layer for RecallRaid.
///         Product evidence is adjudicated on GenLayer. A trusted relayer
///         submits the finalized decision here exactly once, after which
///         users withdraw USDC with the pull-payment pattern.
contract RecallRaidEscrow {
    enum Verdict { None, NoIssue, PotentialIssue, RecallConfirmed, NeedsMoreEvidence }

    struct CaseEscrow {
        address submitter;
        address challenger;
        address hunter;
        bytes32 sellerBondId;
        uint256 bounty;
        uint256 challengeStake;
        Verdict verdict;
        bool finalized;
        bytes32 genlayerDecisionHash;
    }

    struct SellerBond {
        address seller;
        uint256 balance;
        uint256 totalDeposited;
        uint256 totalSlashed;
        uint256 linkedCases;
        bool withdrawn;
    }

    IERC20 public immutable usdc;
    address public owner;
    address public relayer;
    bool private locked;

    mapping(bytes32 => CaseEscrow) public cases;
    mapping(bytes32 => SellerBond) public sellerBonds;
    mapping(address => uint256) public claimable;

    event InvestigationFunded(bytes32 indexed caseId, address indexed submitter, uint256 amount);
    event ChallengeFunded(bytes32 indexed caseId, address indexed challenger, uint256 amount);
    event SellerBondFunded(bytes32 indexed bondId, address indexed seller, uint256 amount);
    event SellerBondLinked(bytes32 indexed caseId, bytes32 indexed bondId);
    event AdjudicationRelayed(bytes32 indexed caseId, uint8 verdict, address indexed hunter, bytes32 decisionHash);
    event SellerBondSlashed(bytes32 indexed bondId, bytes32 indexed caseId, uint256 amount);
    event Claimed(address indexed account, uint256 amount);
    event SellerBondWithdrawn(bytes32 indexed bondId, address indexed seller, uint256 amount);
    event RelayerUpdated(address indexed relayer);
    event OwnerUpdated(address indexed owner);

    modifier nonReentrant() {
        require(!locked, "RecallRaid: reentrant call");
        locked = true;
        _;
        locked = false;
    }

    modifier onlyOwner() {
        require(msg.sender == owner, "RecallRaid: not owner");
        _;
    }

    modifier onlyRelayer() {
        require(msg.sender == relayer, "RecallRaid: not relayer");
        _;
    }

    constructor(address usdcToken, address relayer_) {
        require(usdcToken != address(0) && relayer_ != address(0), "RecallRaid: zero address");
        usdc = IERC20(usdcToken);
        owner = msg.sender;
        relayer = relayer_;
    }

    function fundInvestigation(bytes32 caseId, uint256 amount) external nonReentrant {
        require(caseId != bytes32(0), "RecallRaid: empty case id");
        require(amount > 0, "RecallRaid: amount is zero");
        CaseEscrow storage item = cases[caseId];
        require(item.submitter == address(0), "RecallRaid: case already funded");
        require(usdc.transferFrom(msg.sender, address(this), amount), "RecallRaid: transferFrom failed");
        item.submitter = msg.sender;
        item.bounty = amount;
        emit InvestigationFunded(caseId, msg.sender, amount);
    }

    function fundChallenge(bytes32 caseId, uint256 amount) external nonReentrant {
        CaseEscrow storage item = cases[caseId];
        require(item.submitter != address(0), "RecallRaid: unknown case");
        require(!item.finalized && item.challenger == address(0), "RecallRaid: challenge unavailable");
        require(amount > 0, "RecallRaid: amount is zero");
        require(usdc.transferFrom(msg.sender, address(this), amount), "RecallRaid: transferFrom failed");
        item.challenger = msg.sender;
        item.challengeStake = amount;
        emit ChallengeFunded(caseId, msg.sender, amount);
    }

    function fundSellerBond(bytes32 bondId, uint256 amount) external nonReentrant {
        require(bondId != bytes32(0) && amount > 0, "RecallRaid: invalid bond funding");
        SellerBond storage bond = sellerBonds[bondId];
        require(!bond.withdrawn, "RecallRaid: bond withdrawn");
        if (bond.seller == address(0)) bond.seller = msg.sender;
        require(bond.seller == msg.sender, "RecallRaid: not bond seller");
        require(usdc.transferFrom(msg.sender, address(this), amount), "RecallRaid: transferFrom failed");
        bond.balance += amount;
        bond.totalDeposited += amount;
        emit SellerBondFunded(bondId, msg.sender, amount);
    }

    function linkSellerBond(bytes32 caseId, bytes32 bondId) external {
        CaseEscrow storage item = cases[caseId];
        SellerBond storage bond = sellerBonds[bondId];
        require(item.submitter != address(0) && !item.finalized, "RecallRaid: case unavailable");
        require(bond.seller == msg.sender && bond.balance > 0, "RecallRaid: invalid seller bond");
        require(item.sellerBondId == bytes32(0), "RecallRaid: bond already linked");
        item.sellerBondId = bondId;
        bond.linkedCases += 1;
        emit SellerBondLinked(caseId, bondId);
    }

    /// @param challengeOverturned True only when GenLayer overturned the
    ///        original verdict. It determines who receives the challenge stake.
    function relayAdjudication(
        bytes32 caseId,
        uint8 verdictCode,
        address hunter,
        bool challengeOverturned,
        bytes32 decisionHash
    ) external onlyRelayer {
        CaseEscrow storage item = cases[caseId];
        require(item.submitter != address(0), "RecallRaid: unknown case");
        require(!item.finalized, "RecallRaid: already finalized");
        require(verdictCode >= uint8(Verdict.NoIssue) && verdictCode <= uint8(Verdict.RecallConfirmed), "RecallRaid: non-final verdict");
        require(decisionHash != bytes32(0), "RecallRaid: empty decision hash");
        if (verdictCode != uint8(Verdict.NoIssue)) require(hunter != address(0), "RecallRaid: zero hunter");

        item.finalized = true;
        item.verdict = Verdict(verdictCode);
        item.hunter = hunter;
        item.genlayerDecisionHash = decisionHash;

        address bountyRecipient = verdictCode == uint8(Verdict.NoIssue) ? item.submitter : hunter;
        claimable[bountyRecipient] += item.bounty;

        if (item.challengeStake > 0) {
            address stakeRecipient = challengeOverturned ? item.challenger : bountyRecipient;
            claimable[stakeRecipient] += item.challengeStake;
        }

        if (verdictCode == uint8(Verdict.RecallConfirmed) && item.sellerBondId != bytes32(0)) {
            SellerBond storage bond = sellerBonds[item.sellerBondId];
            uint256 slash = bond.balance < item.bounty ? bond.balance : item.bounty;
            if (slash > 0) {
                bond.balance -= slash;
                bond.totalSlashed += slash;
                claimable[hunter] += slash;
                emit SellerBondSlashed(item.sellerBondId, caseId, slash);
            }
        }
        if (item.sellerBondId != bytes32(0)) {
            SellerBond storage linkedBond = sellerBonds[item.sellerBondId];
            if (linkedBond.linkedCases > 0) linkedBond.linkedCases -= 1;
        }

        emit AdjudicationRelayed(caseId, verdictCode, hunter, decisionHash);
    }

    /// @notice Releases Base escrow after GenLayer records a cancellation or
    ///         deadline timeout. The relayer must only call this for a
    ///         terminal non-verdict adjudication state.
    function relayCancellation(bytes32 caseId, bytes32 decisionHash) external onlyRelayer {
        CaseEscrow storage item = cases[caseId];
        require(item.submitter != address(0), "RecallRaid: unknown case");
        require(!item.finalized && decisionHash != bytes32(0), "RecallRaid: cancellation unavailable");
        item.finalized = true;
        item.genlayerDecisionHash = decisionHash;
        claimable[item.submitter] += item.bounty;
        if (item.challengeStake > 0) claimable[item.challenger] += item.challengeStake;
        if (item.sellerBondId != bytes32(0)) {
            SellerBond storage bond = sellerBonds[item.sellerBondId];
            if (bond.linkedCases > 0) bond.linkedCases -= 1;
        }
        emit AdjudicationRelayed(caseId, uint8(Verdict.None), address(0), decisionHash);
    }

    function claim() external nonReentrant {
        uint256 amount = claimable[msg.sender];
        require(amount > 0, "RecallRaid: nothing claimable");
        claimable[msg.sender] = 0;
        require(usdc.transfer(msg.sender, amount), "RecallRaid: transfer failed");
        emit Claimed(msg.sender, amount);
    }

    function withdrawSellerBond(bytes32 bondId) external nonReentrant {
        SellerBond storage bond = sellerBonds[bondId];
        require(bond.seller == msg.sender, "RecallRaid: not bond seller");
        require(!bond.withdrawn && bond.linkedCases == 0, "RecallRaid: bond locked");
        uint256 amount = bond.balance;
        require(amount > 0, "RecallRaid: empty bond");
        bond.balance = 0;
        bond.withdrawn = true;
        require(usdc.transfer(msg.sender, amount), "RecallRaid: transfer failed");
        emit SellerBondWithdrawn(bondId, msg.sender, amount);
    }

    function getCase(bytes32 caseId) external view returns (CaseEscrow memory) {
        return cases[caseId];
    }

    function getSellerBond(bytes32 bondId) external view returns (SellerBond memory) {
        return sellerBonds[bondId];
    }

    function setRelayer(address newRelayer) external onlyOwner {
        require(newRelayer != address(0), "RecallRaid: zero relayer");
        relayer = newRelayer;
        emit RelayerUpdated(newRelayer);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "RecallRaid: zero owner");
        owner = newOwner;
        emit OwnerUpdated(newOwner);
    }
}
