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
        uint64 fundedAt;
        bool registered;
        address genlayerContract;
        uint32 genlayerInvestigationId;
    }

    struct SellerBond {
        address seller;
        uint256 balance;
        uint256 totalDeposited;
        uint256 totalSlashed;
        uint256 linkedCases;
        bool withdrawn;
    }

    struct ChallengeDeposit {
        uint256 amount;
        uint64 fundedAt;
    }

    IERC20 public immutable usdc;
    address public owner;
    address public relayer;
    address public decisionSigner;
    bool private locked;

    mapping(bytes32 => CaseEscrow) public cases;
    mapping(bytes32 => mapping(address => ChallengeDeposit)) public challengeDeposits;
    mapping(bytes32 => address[]) private caseChallengers;
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
    event DecisionSignerUpdated(address indexed signer);
    event CaseRegistered(bytes32 indexed caseId, address indexed submitter, uint256 bounty, address genlayerContract, uint32 investigationId);
    event OrphanRecovered(bytes32 indexed caseId, address indexed submitter, uint256 amount);

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

    bytes32 private constant EIP712_DOMAIN_TYPEHASH = keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");
    bytes32 private constant ADJUDICATION_TYPEHASH = keccak256("Adjudication(bytes32 caseId,address genlayerContract,uint32 investigationId,uint8 verdictCode,address hunter,uint32 challengeId,address challenger,bool challengeOverturned,bytes32 sellerBondId,uint256 sellerBondSlash,bytes32 decisionHash)");
    bytes32 private constant CANCELLATION_TYPEHASH = keccak256("Cancellation(bytes32 caseId,address genlayerContract,uint32 investigationId,bytes32 decisionHash)");
    bytes32 private constant REGISTRATION_TYPEHASH = keccak256("Registration(bytes32 caseId,address submitter,uint256 bounty,address genlayerContract,uint32 investigationId)");
    bytes32 private constant ORPHAN_RECOVERY_TYPEHASH = keccak256("OrphanRecovery(bytes32 caseId,address submitter,uint256 bounty)");
    uint256 private constant SECP256K1_HALF_ORDER = 0x7fffffffffffffffffffffffffffffff5d576e7357a4501ddfe92f46681b20a0;

    constructor(address usdcToken, address relayer_, address decisionSigner_) {
        require(usdcToken != address(0) && relayer_ != address(0) && decisionSigner_ != address(0), "RecallRaid: zero address");
        usdc = IERC20(usdcToken);
        owner = msg.sender;
        relayer = relayer_;
        decisionSigner = decisionSigner_;
    }

    function fundInvestigation(bytes32 caseId, uint256 amount) external nonReentrant {
        require(caseId != bytes32(0), "RecallRaid: empty case id");
        require(amount > 0, "RecallRaid: amount is zero");
        CaseEscrow storage item = cases[caseId];
        require(item.submitter == address(0), "RecallRaid: case already funded");
        require(usdc.transferFrom(msg.sender, address(this), amount), "RecallRaid: transferFrom failed");
        item.submitter = msg.sender;
        item.bounty = amount;
        item.fundedAt = uint64(block.timestamp);
        emit InvestigationFunded(caseId, msg.sender, amount);
    }

    /// @notice Relayer records the one GenLayer registration associated with this deposit.
    /// The relayer is trusted financial infrastructure until a consensus-proof bridge exists.
    function registerGenLayerCase(bytes32 caseId, address submitter, uint256 bounty, address genlayerContract, uint32 investigationId, bytes calldata authorization) external onlyRelayer {
        CaseEscrow storage item = cases[caseId];
        require(item.submitter != address(0) && !item.finalized && !item.registered, "RecallRaid: registration unavailable");
        require(item.submitter == submitter && item.bounty == bounty, "RecallRaid: registration mismatch");
        require(genlayerContract != address(0) && investigationId != 0, "RecallRaid: invalid GenLayer reference");
        bytes32 instruction = keccak256(abi.encode(REGISTRATION_TYPEHASH, caseId, submitter, bounty, genlayerContract, investigationId));
        require(_isAuthorized(instruction, authorization), "RecallRaid: invalid registration authorization");
        item.registered = true;
        item.genlayerContract = genlayerContract;
        item.genlayerInvestigationId = investigationId;
        emit CaseRegistered(caseId, submitter, bounty, genlayerContract, investigationId);
    }

    function recoverOrphanDeposit(bytes32 caseId, bytes calldata authorization) external nonReentrant {
        CaseEscrow storage item = cases[caseId];
        require(item.submitter == msg.sender && !item.registered && !item.finalized, "RecallRaid: recovery unavailable");
        require(block.timestamp >= uint256(item.fundedAt) + 7 days, "RecallRaid: recovery delay active");
        bytes32 instruction = keccak256(abi.encode(ORPHAN_RECOVERY_TYPEHASH, caseId, msg.sender, item.bounty));
        require(_isAuthorized(instruction, authorization), "RecallRaid: invalid recovery authorization");
        item.finalized = true;
        uint256 amount = item.bounty;
        claimable[msg.sender] += amount;
        emit OrphanRecovered(caseId, msg.sender, amount);
    }

    function fundChallenge(bytes32 caseId, uint256 amount) external nonReentrant {
        CaseEscrow storage item = cases[caseId];
        require(item.submitter != address(0), "RecallRaid: unknown case");
        require(item.registered && !item.finalized, "RecallRaid: challenge unavailable");
        require(amount > 0, "RecallRaid: amount is zero");
        ChallengeDeposit storage deposit = challengeDeposits[caseId][msg.sender];
        require(deposit.amount == 0, "RecallRaid: challenger already funded");
        uint256 requiredStake = item.bounty / 5;
        if (requiredStake == 0) requiredStake = 1;
        require(amount == requiredStake, "RecallRaid: incorrect challenge stake");
        require(usdc.transferFrom(msg.sender, address(this), amount), "RecallRaid: transferFrom failed");
        deposit.amount = amount;
        deposit.fundedAt = uint64(block.timestamp);
        caseChallengers[caseId].push(msg.sender);
        // Preserve the legacy getter as a latest-funder hint. Settlement
        // uses the per-wallet deposit mapping, never this shared slot.
        item.challenger = msg.sender;
        item.challengeStake += amount;
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
        address genlayerContract,
        uint32 investigationId,
        uint8 verdictCode,
        address hunter,
        uint32 challengeId,
        address challenger,
        bool challengeOverturned,
        bytes32 sellerBondId,
        uint256 sellerBondSlash,
        bytes32 decisionHash,
        bytes calldata authorization
    ) external onlyRelayer {
        CaseEscrow storage item = cases[caseId];
        require(item.submitter != address(0), "RecallRaid: unknown case");
        require(!item.finalized, "RecallRaid: already finalized");
        require(item.registered, "RecallRaid: GenLayer case not registered");
        require(verdictCode >= uint8(Verdict.NoIssue) && verdictCode <= uint8(Verdict.RecallConfirmed), "RecallRaid: non-final verdict");
        require(decisionHash != bytes32(0), "RecallRaid: empty decision hash");
        require(item.genlayerContract == genlayerContract && item.genlayerInvestigationId == investigationId, "RecallRaid: GenLayer reference mismatch");
        uint256 expectedBondSlash;
        if (verdictCode == uint8(Verdict.RecallConfirmed) && item.sellerBondId != bytes32(0)) {
            SellerBond storage linkedBond = sellerBonds[item.sellerBondId];
            expectedBondSlash = linkedBond.balance < item.bounty ? linkedBond.balance : item.bounty;
        }
        require(sellerBondId == item.sellerBondId && sellerBondSlash == expectedBondSlash, "RecallRaid: seller bond instruction mismatch");
        bytes32 instruction = keccak256(abi.encode(ADJUDICATION_TYPEHASH, caseId, genlayerContract, investigationId, verdictCode, hunter, challengeId, challenger, challengeOverturned, sellerBondId, sellerBondSlash, decisionHash));
        require(_isAuthorized(instruction, authorization), "RecallRaid: invalid adjudication authorization");
        uint256 challengerStake;
        if (challengeId != 0) {
            require(challenger != address(0), "RecallRaid: missing challenger");
            challengerStake = challengeDeposits[caseId][challenger].amount;
            require(challengerStake > 0, "RecallRaid: challenger stake not funded");
            challengeDeposits[caseId][challenger].amount = 0;
        } else {
            require(challenger == address(0) && !challengeOverturned, "RecallRaid: unexpected challenge result");
        }
        if (verdictCode != uint8(Verdict.NoIssue)) require(hunter != address(0), "RecallRaid: zero hunter");

        item.finalized = true;
        item.verdict = Verdict(verdictCode);
        item.hunter = hunter;
        item.genlayerDecisionHash = decisionHash;

        address bountyRecipient = verdictCode == uint8(Verdict.NoIssue) ? item.submitter : hunter;
        claimable[bountyRecipient] += item.bounty;

        if (challengerStake > 0) {
            address stakeRecipient = challengeOverturned ? challenger : bountyRecipient;
            claimable[stakeRecipient] += challengerStake;
            item.challengeStake -= challengerStake;
        }

        if (sellerBondSlash > 0) {
            SellerBond storage bond = sellerBonds[sellerBondId];
            bond.balance -= sellerBondSlash;
            bond.totalSlashed += sellerBondSlash;
            claimable[hunter] += sellerBondSlash;
            emit SellerBondSlashed(sellerBondId, caseId, sellerBondSlash);
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
    function relayCancellation(bytes32 caseId, address genlayerContract, uint32 investigationId, bytes32 decisionHash, bytes calldata authorization) external onlyRelayer {
        CaseEscrow storage item = cases[caseId];
        require(item.submitter != address(0), "RecallRaid: unknown case");
        require(item.registered && !item.finalized && decisionHash != bytes32(0), "RecallRaid: cancellation unavailable");
        require(item.genlayerContract == genlayerContract && item.genlayerInvestigationId == investigationId, "RecallRaid: GenLayer reference mismatch");
        bytes32 instruction = keccak256(abi.encode(CANCELLATION_TYPEHASH, caseId, genlayerContract, investigationId, decisionHash));
        require(_isAuthorized(instruction, authorization), "RecallRaid: invalid cancellation authorization");
        item.finalized = true;
        item.genlayerDecisionHash = decisionHash;
        claimable[item.submitter] += item.bounty;
        address[] storage challengers = caseChallengers[caseId];
        for (uint256 i = 0; i < challengers.length; i++) {
            address challenger = challengers[i];
            uint256 challengerStake = challengeDeposits[caseId][challenger].amount;
            if (challengerStake > 0) {
                challengeDeposits[caseId][challenger].amount = 0;
                claimable[challenger] += challengerStake;
            }
        }
        item.challengeStake = 0;
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

    function getChallengeDeposit(bytes32 caseId, address challenger) external view returns (ChallengeDeposit memory) {
        return challengeDeposits[caseId][challenger];
    }

    function recoverUnmatchedChallengeDeposit(bytes32 caseId) external nonReentrant {
        CaseEscrow storage item = cases[caseId];
        ChallengeDeposit storage deposit = challengeDeposits[caseId][msg.sender];
        require(deposit.amount > 0 && (item.finalized || (!item.registered && block.timestamp >= uint256(deposit.fundedAt) + 7 days)), "RecallRaid: challenge recovery unavailable");
        uint256 amount = deposit.amount;
        deposit.amount = 0;
        item.challengeStake -= amount;
        claimable[msg.sender] += amount;
    }

    function getSellerBond(bytes32 bondId) external view returns (SellerBond memory) {
        return sellerBonds[bondId];
    }

    function setRelayer(address newRelayer) external onlyOwner {
        require(newRelayer != address(0), "RecallRaid: zero relayer");
        relayer = newRelayer;
        emit RelayerUpdated(newRelayer);
    }

    function setDecisionSigner(address newSigner) external onlyOwner {
        require(newSigner != address(0), "RecallRaid: zero decision signer");
        decisionSigner = newSigner;
        emit DecisionSignerUpdated(newSigner);
    }

    function _isAuthorized(bytes32 structHash, bytes calldata signature) private view returns (bool) {
        bytes32 domain = keccak256(abi.encode(
            EIP712_DOMAIN_TYPEHASH,
            keccak256(bytes("RecallRaidEscrow")),
            keccak256(bytes("1")),
            block.chainid,
            address(this)
        ));
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", domain, structHash));
        return _recover(digest, signature) == decisionSigner;
    }

    function _recover(bytes32 digest, bytes calldata signature) private pure returns (address signer) {
        require(signature.length == 65, "RecallRaid: invalid signature length");
        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly {
            r := calldataload(signature.offset)
            s := calldataload(add(signature.offset, 32))
            v := byte(0, calldataload(add(signature.offset, 64)))
        }
        require(v == 27 || v == 28, "RecallRaid: invalid signature v");
        require(uint256(s) <= SECP256K1_HALF_ORDER, "RecallRaid: invalid signature s");
        signer = ecrecover(digest, v, r, s);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "RecallRaid: zero owner");
        owner = newOwner;
        emit OwnerUpdated(newOwner);
    }
}
