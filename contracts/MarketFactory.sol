// SPDX-License-Identifier: BSD-3-Clause-Clear
pragma solidity ^0.8.24;

import "@fhevm/solidity/lib/FHE.sol";
import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";
import "./OpaqueMarket.sol";
import "./interfaces/IConfidentialERC20.sol";

/// @title MarketFactory - Factory for Creating Opaque V2 Prediction Markets
/// @notice Deploys new OpaqueMarket instances with mandatory resolution source.
///         V2: Matching is permissionless, no dedicated matcher needed.
contract MarketFactory is ZamaEthereumConfig {
    // ═══════════════════════════════════════
    // CUSTOM ERRORS
    // ═══════════════════════════════════════

    error OnlyOwner();
    error ZeroAddress();
    error ResolverRequired();
    error QuestionRequired();
    error SourceRequired();
    error SourceTypeRequired();
    error CriteriaRequired();
    error DeadlineTooSoon();
    error CreationCooldown();
    error NotPending();
    error InvalidConfig();

    address[] public markets;
    address public owner;
    address public pendingOwner;
    address public defaultResolver;
    address public feeCollector;
    IConfidentialERC20 public token;

    uint64 public immutable CREATION_FEE;
    bool public creationFeeEnabled;
    uint256 public immutable MIN_DURATION;
    uint256 public immutable CREATION_COOLDOWN;
    mapping(address => uint256) public lastCreationTime;

    event MarketCreated(
        address indexed market,
        address indexed creator,
        string question,
        uint256 deadline,
        string resolutionSource,
        string resolutionSourceType,
        string category,
        uint256 marketIndex
    );

    constructor(
        address _defaultResolver,
        address _feeCollector,
        address _token,
        uint64 _creationFee,
        uint256 _minDuration,
        uint256 _creationCooldown
    ) {
        // L-3 fix: Ensure minimum duration is at least 5 minutes
        if (_minDuration < 300) revert InvalidConfig();
        owner = msg.sender;
        defaultResolver = _defaultResolver;
        feeCollector = _feeCollector;
        token = IConfidentialERC20(_token);
        CREATION_FEE = _creationFee;
        MIN_DURATION = _minDuration;
        CREATION_COOLDOWN = _creationCooldown;
        creationFeeEnabled = false;
    }

    /// @notice Create a new prediction market with default resolver
    function createMarket(
        string memory _question,
        uint256 _deadline,
        string memory _resolutionSource,
        string memory _resolutionSourceType,
        string memory _resolutionCriteria,
        string memory _category
    ) external returns (address) {
        return
            _create(
                _question,
                _deadline,
                _resolutionSource,
                _resolutionSourceType,
                _resolutionCriteria,
                _category,
                defaultResolver
            );
    }

    /// @notice Create a market with a custom resolver
    function createMarketWithResolver(
        string memory _question,
        uint256 _deadline,
        string memory _resolutionSource,
        string memory _resolutionSourceType,
        string memory _resolutionCriteria,
        string memory _category,
        address _resolver
    ) external returns (address) {
        if (_resolver == address(0)) revert ResolverRequired();
        return
            _create(
                _question,
                _deadline,
                _resolutionSource,
                _resolutionSourceType,
                _resolutionCriteria,
                _category,
                _resolver
            );
    }

    function _create(
        string memory _question,
        uint256 _deadline,
        string memory _resolutionSource,
        string memory _resolutionSourceType,
        string memory _resolutionCriteria,
        string memory _category,
        address _resolver
    ) internal returns (address marketAddress) {
        if (bytes(_question).length == 0) revert QuestionRequired();
        if (bytes(_resolutionSource).length == 0) revert SourceRequired();
        if (bytes(_resolutionSourceType).length == 0) revert SourceTypeRequired();
        if (bytes(_resolutionCriteria).length == 0) revert CriteriaRequired();
        if (_deadline <= block.timestamp + MIN_DURATION) revert DeadlineTooSoon();
        if (block.timestamp < lastCreationTime[msg.sender] + CREATION_COOLDOWN) revert CreationCooldown();

        lastCreationTime[msg.sender] = block.timestamp;

        if (creationFeeEnabled && address(token) != address(0)) {
            // H-4 fix: Pre-check plaintext approval >= CREATION_FEE
            // This prevents free market creation when user hasn't approved
            require(token.allowancePlaintext(msg.sender, address(this)) >= CREATION_FEE, "Insufficient fee allowance");
            euint64 fee = FHE.asEuint64(CREATION_FEE);
            FHE.allowThis(fee);
            FHE.allow(fee, address(token));
            // Use transferFromChecked to ensure fee is actually paid (M-SC5 fix)
            // Note: encrypted return value cannot be conditionally reverted on (FHE limitation)
            token.transferFromChecked(msg.sender, feeCollector, fee);
        }

        // V2: No matcher param — matching is permissionless
        OpaqueMarket market = new OpaqueMarket(
            _question,
            _deadline,
            _resolutionSource,
            _resolutionSourceType,
            _resolutionCriteria,
            _category,
            _resolver,
            feeCollector,
            address(token),
            msg.sender
        );

        marketAddress = address(market);
        markets.push(marketAddress);

        emit MarketCreated(
            marketAddress,
            msg.sender,
            _question,
            _deadline,
            _resolutionSource,
            _resolutionSourceType,
            _category,
            markets.length - 1
        );
    }

    function getMarketCount() external view returns (uint256) {
        return markets.length;
    }

    function getAllMarkets() external view returns (address[] memory) {
        return markets;
    }

    function setDefaultResolver(address _resolver) external {
        if (msg.sender != owner) revert OnlyOwner();
        if (_resolver == address(0)) revert ZeroAddress();
        defaultResolver = _resolver;
    }

    function setFeeCollector(address _feeCollector) external {
        if (msg.sender != owner) revert OnlyOwner();
        if (_feeCollector == address(0)) revert ZeroAddress();
        feeCollector = _feeCollector;
    }

    function setCreationFeeEnabled(bool _enabled) external {
        if (msg.sender != owner) revert OnlyOwner();
        creationFeeEnabled = _enabled;
    }

    function transferOwnership(address _newOwner) external {
        if (msg.sender != owner) revert OnlyOwner();
        if (_newOwner == address(0)) revert ZeroAddress();
        pendingOwner = _newOwner;
    }

    function acceptOwnership() external {
        if (msg.sender != pendingOwner) revert NotPending();
        owner = pendingOwner;
        pendingOwner = address(0);
    }
}
