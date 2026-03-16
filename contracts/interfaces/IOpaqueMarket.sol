// SPDX-License-Identifier: BSD-3-Clause-Clear
pragma solidity ^0.8.24;

import "@fhevm/solidity/lib/FHE.sol";

interface IOpaqueMarket {
    // ═══════════════════════════════════════
    // EVENTS
    // ═══════════════════════════════════════

    event SharesMinted(address indexed user, uint256 timestamp);
    event SharesBurned(address indexed user, uint256 timestamp);
    /// @notice Order placed — side and amount are NOT in the event (encrypted)
    event OrderPlaced(
        uint256 indexed orderId,
        address indexed owner,
        uint32 price,
        bool isBid,
        uint256 sequence,
        uint256 timestamp
    );
    event OrderCancelled(uint256 indexed orderId, address indexed owner, uint256 timestamp);
    /// @notice Match attempted — intentionally reveals NOTHING about success/failure
    event MatchAttempted(uint256 indexed bidId, uint256 indexed askId, address indexed caller, uint256 timestamp);
    event MarketResolved(bool outcome, uint256 timestamp);
    event RedemptionRequested(address indexed user, uint256 timestamp);
    event RedemptionFinalized(address indexed user, uint256 payout, uint256 timestamp);

    // ═══════════════════════════════════════
    // MINT / BURN
    // ═══════════════════════════════════════

    function mintShares(externalEuint64 encryptedAmount, bytes calldata inputProof) external;
    function burnShares(externalEuint64 encryptedAmount, bytes calldata inputProof) external;

    // ═══════════════════════════════════════
    // ORDER PLACEMENT (UNIFIED)
    // ═══════════════════════════════════════

    function placeOrder(
        externalEuint8 encSide,
        uint32 price,
        bool isBid,
        externalEuint64 encAmount,
        bytes calldata sideProof,
        bytes calldata amountProof
    ) external;

    // ═══════════════════════════════════════
    // CANCEL ORDERS
    // ═══════════════════════════════════════

    function cancelOrder(uint256 orderId) external;
    function cancelOrders(uint256[] calldata orderIdsToCancel) external;

    // ═══════════════════════════════════════
    // TRUSTLESS MATCHING
    // ═══════════════════════════════════════

    function attemptMatch(uint256 bidId, uint256 askId) external;

    // ═══════════════════════════════════════
    // RESOLUTION
    // ═══════════════════════════════════════

    function resolve(bool _outcome) external;

    // ═══════════════════════════════════════
    // REDEMPTION
    // ═══════════════════════════════════════

    function requestRedemption() external;
    function finalizeRedemption(uint64 winningShares, bytes memory decryptionProof) external;

    // ═══════════════════════════════════════
    // EMERGENCY
    // ═══════════════════════════════════════

    function emergencyWithdraw() external;
    function finalizeEmergencyWithdraw(uint64 yesAmount, uint64 noAmount, bytes memory decryptionProof) external;
    function emergencyRefundAfterResolution() external;

    // ═══════════════════════════════════════
    // MARKET CANCELLATION
    // ═══════════════════════════════════════

    function cancelMarket() external;

    // ═══════════════════════════════════════
    // VIEW FUNCTIONS
    // ═══════════════════════════════════════

    function getCurrentPrice() external view returns (uint32 yesPrice, uint32 noPrice);
    function getMyShares() external view returns (euint64 yes, euint64 no);
    function getOrder(
        uint256 orderId
    )
        external
        view
        returns (address owner, uint32 price, bool isBid, bool isActive, uint256 sequence, uint256 createdAt);
    function getOrderEncrypted(
        uint256 orderId
    ) external view returns (euint8 encSide, euint64 size, euint64 filled, euint64 escrow);
    function getUserOrders(address user) external view returns (uint256[] memory);
    function getPriceLevel(uint32 price) external view returns (uint256 bidCount, uint256 askCount);
    function getBestPrices() external view returns (uint32 _bestBid, uint32 _bestAsk);
    function getMarketInfo()
        external
        view
        returns (
            string memory _question,
            uint256 _deadline,
            bool _resolved,
            bool _outcome,
            uint256 _totalSharesMinted,
            uint256 _activeOrderCount,
            string memory _resolutionSource,
            string memory _resolutionSourceType,
            string memory _resolutionCriteria,
            string memory _category
        );
    function hasUserShares(address user) external view returns (bool);

    // ═══════════════════════════════════════
    // ADMIN
    // ═══════════════════════════════════════

    function setResolver(address _resolver) external;
    function setFeeCollector(address _feeCollector) external;
    function withdrawFees() external;
    function withdrawTradeFees() external;
    function pause() external;
    function unpause() external;
}
