// SPDX-License-Identifier: BSD-3-Clause-Clear
pragma solidity ^0.8.24;

import "./interfaces/IOpaqueMarket.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title OracleResolver - Multi-Tier Oracle Resolution for Opaque Markets
/// @notice Supports Chainlink price feeds (Tier 1), on-chain verifiable (Tier 2),
///         and manual multi-sig resolution (Tier 3).
/// @dev Source-mandatory design: every market MUST specify a verifiable resolution source.
///      This eliminates ~90% of oracle problems by making outcomes deterministically verifiable.
contract OracleResolver is ReentrancyGuard {
    // ═══════════════════════════════════════
    // CUSTOM ERRORS
    // ═══════════════════════════════════════

    error OnlyOwner();
    error ZeroAddress();
    error FeedRequired();
    error SignersRequired();
    error InvalidSigCount();
    error TargetRequired();
    error CalldataRequired();
    error NotConfigured();
    error WrongType();
    error NoFeed();
    error ChainlinkCallFailed();
    error StalePriceData();
    error NoTarget();
    error OnchainCallFailed();
    error AlreadySigned();
    error NotASigner();
    error NotPending();
    error DeadlineNotPassed();
    error ResetCooldown();
    error InvalidConfig();

    enum SourceType {
        CHAINLINK,
        ONCHAIN,
        API,
        AI_CONSENSUS,
        MANUAL
    }

    struct ResolutionConfig {
        SourceType sourceType;
        address chainlinkFeed; // For Chainlink (Tier 1)
        int256 threshold; // For numeric comparisons
        bool thresholdAbove; // true = "above threshold", false = "below"
        address[] multisigSigners; // For manual resolution (Tier 3)
        uint256 requiredSignatures; // For manual resolution
        bool isConfigured;
        // Tier 2: On-chain verifiable
        address onchainTarget; // Target contract address
        bytes onchainCalldata; // Function selector + encoded args
        // M4: Configurable staleness for Chainlink
        uint256 maxStaleness; // Max age of price data in seconds (0 = use default 3600)
    }

    // Market address => resolution config
    mapping(address => ResolutionConfig) public configs;

    // H3 fix: Majority voting (separate YES/NO counts)
    mapping(address => mapping(address => bool)) public hasSignedManual;
    mapping(address => uint256) public yesVoteCount;
    mapping(address => uint256) public noVoteCount;

    // M-SC6: Reset abuse protection (1-day cooldown between resets)
    mapping(address => uint256) public lastResetTime;
    uint256 public constant RESET_COOLDOWN = 1 days;

    address public owner;
    address public pendingOwner;

    event ConfigSet(address indexed market, SourceType sourceType);
    event MarketResolvedViaChainlink(address indexed market, int256 price, bool result);
    event MarketResolvedManually(address indexed market, bool result, uint256 signatures);
    event ManualVoteSubmitted(address indexed market, address indexed signer, bool vote);
    event MarketResolvedOnchain(address indexed market, int256 value, bool result);
    event ManualVotingReset(address indexed market);
    event OpeningPriceRecorded(address indexed market, int256 openingPrice);

    modifier onlyOwner() {
        if (msg.sender != owner) revert OnlyOwner();
        _;
    }

    constructor() {
        owner = msg.sender;
    }

    // ═══════════════════════════════════════
    // CONFIGURATION
    // ═══════════════════════════════════════

    /// @notice Configure Chainlink resolution for a market
    /// @param maxStaleness Max age of price data in seconds (0 = default 3600s)
    function configureChainlink(
        address market,
        address feedAddress,
        int256 threshold,
        bool thresholdAbove,
        uint256 maxStaleness
    ) external onlyOwner {
        if (feedAddress == address(0)) revert FeedRequired();
        // L-2 fix: Validate maxStaleness is not zero (prevents accepting arbitrarily old data)
        if (maxStaleness == 0) revert InvalidConfig();

        configs[market] = ResolutionConfig({
            sourceType: SourceType.CHAINLINK,
            chainlinkFeed: feedAddress,
            threshold: threshold,
            thresholdAbove: thresholdAbove,
            multisigSigners: new address[](0),
            requiredSignatures: 0,
            isConfigured: true,
            onchainTarget: address(0),
            onchainCalldata: "",
            maxStaleness: maxStaleness
        });

        emit ConfigSet(market, SourceType.CHAINLINK);
    }

    /// @notice Configure manual multi-sig resolution for a market
    function configureManual(address market, address[] calldata signers, uint256 requiredSigs) external onlyOwner {
        if (signers.length == 0) revert SignersRequired();
        if (requiredSigs == 0 || requiredSigs > signers.length) revert InvalidSigCount();

        configs[market] = ResolutionConfig({
            sourceType: SourceType.MANUAL,
            chainlinkFeed: address(0),
            threshold: 0,
            thresholdAbove: false,
            multisigSigners: signers,
            requiredSignatures: requiredSigs,
            isConfigured: true,
            onchainTarget: address(0),
            onchainCalldata: "",
            maxStaleness: 0
        });

        emit ConfigSet(market, SourceType.MANUAL);
    }

    /// @notice Configure on-chain verifiable resolution for a market (Tier 2)
    function configureOnchain(
        address market,
        address target,
        bytes calldata callData,
        int256 threshold,
        bool thresholdAbove
    ) external onlyOwner {
        if (target == address(0)) revert TargetRequired();
        if (callData.length < 4) revert CalldataRequired();

        configs[market] = ResolutionConfig({
            sourceType: SourceType.ONCHAIN,
            chainlinkFeed: address(0),
            threshold: threshold,
            thresholdAbove: thresholdAbove,
            multisigSigners: new address[](0),
            requiredSignatures: 0,
            isConfigured: true,
            onchainTarget: target,
            onchainCalldata: callData,
            maxStaleness: 0
        });

        emit ConfigSet(market, SourceType.ONCHAIN);
    }

    /// @notice Configure Chainlink resolution using the CURRENT price as threshold.
    ///         Ideal for 5-minute BTC/USD markets: records opening price at creation time.
    /// @param market Market address to configure
    /// @param feedAddress Chainlink price feed address (e.g., BTC/USD on Sepolia)
    /// @param thresholdAbove true = resolve YES if price >= opening price at deadline
    /// @param maxStaleness Max age of price data in seconds (0 = default 3600s)
    function configureChainlinkAutoThreshold(
        address market,
        address feedAddress,
        bool thresholdAbove,
        uint256 maxStaleness
    ) external onlyOwner {
        if (feedAddress == address(0)) revert FeedRequired();

        // Read current price from Chainlink feed
        (bool success, bytes memory data) = feedAddress.staticcall(abi.encodeWithSignature("latestRoundData()"));
        if (!success) revert ChainlinkCallFailed();

        (, int256 currentPrice, , uint256 updatedAt, ) = abi.decode(data, (uint80, int256, uint256, uint256, uint80));

        uint256 staleness = maxStaleness > 0 ? maxStaleness : 3600;
        if (block.timestamp - updatedAt > staleness) revert StalePriceData();

        configs[market] = ResolutionConfig({
            sourceType: SourceType.CHAINLINK,
            chainlinkFeed: feedAddress,
            threshold: currentPrice,
            thresholdAbove: thresholdAbove,
            multisigSigners: new address[](0),
            requiredSignatures: 0,
            isConfigured: true,
            onchainTarget: address(0),
            onchainCalldata: "",
            maxStaleness: maxStaleness
        });

        emit ConfigSet(market, SourceType.CHAINLINK);
        emit OpeningPriceRecorded(market, currentPrice);
    }

    // ═══════════════════════════════════════
    // TIER 1: CHAINLINK RESOLUTION
    // ═══════════════════════════════════════

    /// @notice Resolve a market using Chainlink price feed
    function resolveChainlink(address market) external nonReentrant {
        ResolutionConfig memory config = configs[market];
        if (!config.isConfigured) revert NotConfigured();
        if (config.sourceType != SourceType.CHAINLINK) revert WrongType();
        if (config.chainlinkFeed == address(0)) revert NoFeed();

        (bool success, bytes memory data) = config.chainlinkFeed.staticcall(
            abi.encodeWithSignature("latestRoundData()")
        );
        if (!success) revert ChainlinkCallFailed();

        (, int256 price, , uint256 updatedAt, ) = abi.decode(data, (uint80, int256, uint256, uint256, uint80));

        // M4: Configurable staleness (default 3600s if not set)
        uint256 staleness = config.maxStaleness > 0 ? config.maxStaleness : 3600;
        if (block.timestamp - updatedAt > staleness) revert StalePriceData();

        bool result = config.thresholdAbove ? price >= config.threshold : price <= config.threshold;

        IOpaqueMarket(market).resolve(result);

        emit MarketResolvedViaChainlink(market, price, result);
    }

    // ═══════════════════════════════════════
    // TIER 2: ON-CHAIN VERIFIABLE RESOLUTION
    // ═══════════════════════════════════════

    /// @notice Resolve a market using on-chain verifiable data
    function resolveOnchain(address market) external nonReentrant {
        ResolutionConfig memory config = configs[market];
        if (!config.isConfigured) revert NotConfigured();
        if (config.sourceType != SourceType.ONCHAIN) revert WrongType();
        if (config.onchainTarget == address(0)) revert NoTarget();

        (bool success, bytes memory data) = config.onchainTarget.staticcall(config.onchainCalldata);
        if (!success) revert OnchainCallFailed();

        int256 value = abi.decode(data, (int256));

        bool result = config.thresholdAbove ? value >= config.threshold : value <= config.threshold;

        IOpaqueMarket(market).resolve(result);

        emit MarketResolvedOnchain(market, value, result);
    }

    // ═══════════════════════════════════════
    // TIER 3: MANUAL MULTI-SIG RESOLUTION
    // (H3 fix: true majority voting)
    // ═══════════════════════════════════════

    /// @notice Submit a manual resolution vote. YES and NO votes are counted separately.
    ///         First side to reach requiredSignatures wins.
    function submitManualVote(address market, bool result) external nonReentrant {
        ResolutionConfig storage config = configs[market];
        if (!config.isConfigured) revert NotConfigured();
        if (config.sourceType != SourceType.MANUAL) revert WrongType();
        if (hasSignedManual[market][msg.sender]) revert AlreadySigned();

        // Verify signer is in the multisig list
        bool isValidSigner = false;
        for (uint256 i = 0; i < config.multisigSigners.length; i++) {
            if (config.multisigSigners[i] == msg.sender) {
                isValidSigner = true;
                break;
            }
        }
        if (!isValidSigner) revert NotASigner();

        hasSignedManual[market][msg.sender] = true;

        // Count votes separately (H3 fix: no more first-voter bias)
        if (result) {
            yesVoteCount[market]++;
        } else {
            noVoteCount[market]++;
        }

        emit ManualVoteSubmitted(market, msg.sender, result);

        // First side to reach threshold resolves the market
        if (yesVoteCount[market] >= config.requiredSignatures) {
            IOpaqueMarket(market).resolve(true);
            emit MarketResolvedManually(market, true, yesVoteCount[market]);
        } else if (noVoteCount[market] >= config.requiredSignatures) {
            IOpaqueMarket(market).resolve(false);
            emit MarketResolvedManually(market, false, noVoteCount[market]);
        }
    }

    // ═══════════════════════════════════════
    // M6: MANUAL VOTING RESET
    // ═══════════════════════════════════════

    /// @notice Reset manual voting for a market (e.g., if wrong votes were cast)
    /// @dev M-SC6: 1-day cooldown between resets to prevent abuse
    function resetManualVoting(address market) external onlyOwner {
        ResolutionConfig storage config = configs[market];
        if (!config.isConfigured) revert NotConfigured();
        if (config.sourceType != SourceType.MANUAL) revert WrongType();
        if (block.timestamp < lastResetTime[market] + RESET_COOLDOWN) revert ResetCooldown();

        lastResetTime[market] = block.timestamp;

        // Reset all signer states
        for (uint256 i = 0; i < config.multisigSigners.length; i++) {
            hasSignedManual[market][config.multisigSigners[i]] = false;
        }
        yesVoteCount[market] = 0;
        noVoteCount[market] = 0;

        emit ManualVotingReset(market);
    }

    // ═══════════════════════════════════════
    // DIRECT RESOLUTION (Owner bypass for testing)
    // ═══════════════════════════════════════

    /// @notice Direct resolution by owner — only allowed after market deadline (M-SC2 fix)
    function resolveDirectly(address market, bool result) external onlyOwner nonReentrant {
        // Prevent unilateral resolution of active markets
        // Read deadline directly from OpaqueMarket's public state variable
        (bool ok, bytes memory data) = market.staticcall(abi.encodeWithSignature("deadline()"));
        require(ok, "deadline call failed");
        uint256 marketDeadline = abi.decode(data, (uint256));
        if (block.timestamp < marketDeadline) revert DeadlineNotPassed();
        IOpaqueMarket(market).resolve(result);
    }

    // ═══════════════════════════════════════
    // VIEW FUNCTIONS
    // ═══════════════════════════════════════

    function getConfig(
        address market
    )
        external
        view
        returns (
            SourceType sourceType,
            address chainlinkFeed,
            int256 threshold,
            bool thresholdAbove,
            uint256 requiredSignatures,
            bool isConfigured
        )
    {
        ResolutionConfig memory config = configs[market];
        return (
            config.sourceType,
            config.chainlinkFeed,
            config.threshold,
            config.thresholdAbove,
            config.requiredSignatures,
            config.isConfigured
        );
    }

    /// @notice Get the configured threshold (opening price for auto-threshold markets)
    function getOpeningPrice(address market) external view returns (int256) {
        return configs[market].threshold;
    }

    function getMultisigSigners(address market) external view returns (address[] memory) {
        return configs[market].multisigSigners;
    }

    /// @notice Get current vote counts for a manual resolution
    function getVoteCounts(address market) external view returns (uint256 yesVotes, uint256 noVotes) {
        return (yesVoteCount[market], noVoteCount[market]);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert ZeroAddress();
        pendingOwner = newOwner;
    }

    function acceptOwnership() external {
        if (msg.sender != pendingOwner) revert NotPending();
        owner = pendingOwner;
        pendingOwner = address(0);
    }
}
