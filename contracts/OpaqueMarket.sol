// SPDX-License-Identifier: BSD-3-Clause-Clear
pragma solidity ^0.8.24;

import "@fhevm/solidity/lib/FHE.sol";
import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "./interfaces/IOpaqueMarket.sol";
import "./interfaces/IConfidentialERC20.sol";

/// @title OpaqueMarket V2 - Trustless FHE Order Book Prediction Market
/// @notice Both the SIDE (YES/NO) and AMOUNT of every order are encrypted using FHE.
///         Matching is fully trustless — no matcher, operator, or third party ever sees
///         which side a user is betting on. Failed matches look identical to successful ones.
///         Price range: 100-9900 ($0.01-$0.99). 1 share = $1.00 = 1_000_000 micro-cUSDT.
contract OpaqueMarket is ZamaEthereumConfig, ReentrancyGuard, Pausable, IOpaqueMarket {
    // ═══════════════════════════════════════
    // CUSTOM ERRORS
    // ═══════════════════════════════════════

    error BadDeadline();
    error NoSource();
    error NoResolver();
    error NoCreator();
    error Resolved();
    error Closed();
    error BadPrice();
    error OrderLimit();
    error NoShares();
    error NotOwner();
    error NotActive();
    error NoSelfMatch();
    error BidNotActive();
    error AskNotActive();
    error NotBid();
    error NotAsk();
    error BidLessThanAsk();
    error OnlyResolver();
    error NotEnded();
    error WindowExpired();
    error NotResolved();
    error Redeemed();
    error EmrgRefunded();
    error Requested();
    error NotRequested();
    error Finalized();
    error Overflow();
    error GraceActive();
    error TimeoutActive();
    error HasParticipants();
    error OnlyCreator();
    error ZeroAddress();
    error NoFees();
    error HasMints();
    error NotPending();
    error OnlyCollector();

    // ═══════════════════════════════════════
    // CONSTANTS
    // ═══════════════════════════════════════

    uint8 public constant SIDE_YES = 0;
    uint8 public constant SIDE_NO = 1;

    // ═══════════════════════════════════════
    // STRUCTS
    // ═══════════════════════════════════════

    struct Order {
        uint256 id;
        address owner;
        euint8 encSide; // ENCRYPTED: 0=YES, 1=NO — nobody sees which side
        uint32 price; // PUBLIC: 100-9900 ($0.01-$0.99)
        euint64 size; // ENCRYPTED: share count
        euint64 filledSize; // ENCRYPTED: filled amount
        euint64 escrowRemaining; // ENCRYPTED: locked USDT
        bool isBid; // PUBLIC: buy or sell
        bool isActive;
        uint256 sequence; // FIFO ordering
        uint256 createdAt;
    }

    struct PriceLevel {
        uint256 bidCount;
        uint256 askCount;
    }

    // ═══════════════════════════════════════
    // PUBLIC STATE
    // ═══════════════════════════════════════

    string public question;
    uint256 public deadline;
    bool public resolved;
    bool public outcome;

    // Resolution source
    string public resolutionSource;
    string public resolutionSourceType;
    string public resolutionCriteria;
    string public category;

    // Market creator & resolver
    address public creator;
    address public pendingCreator;
    address public resolver;

    // Fees
    uint256 public constant FEE_BPS = 50; // Redemption fee: 0.5%
    uint256 public constant TRADE_FEE_BPS = 5; // Trading fee: 0.05%
    uint256 public constant BPS = 10000;
    uint256 public constant WITHDRAW_FEE = 1_000_000; // Flat $1.00 withdrawal fee
    address public feeCollector;
    uint256 public collectedFees;

    // Constants
    uint256 public constant GRACE_PERIOD = 7 days;
    uint256 public constant DECRYPT_TIMEOUT = 7 days;
    uint256 public constant MAX_ACTIVE_ORDERS = 200;
    uint64 public constant SHARE_UNIT = 1_000_000; // 1 share = 1_000_000 micro-cUSDT
    uint64 public constant PRICE_TO_USDT = 100; // SHARE_UNIT / BPS

    uint256 public resolvedAt;

    // Token
    IConfidentialERC20 public token;

    // Share balances (ENCRYPTED) — outcome tokens from matching
    mapping(address => euint64) private yesBalances;
    mapping(address => euint64) private noBalances;
    mapping(address => bool) private hasShares;
    /// @notice Net count of mint minus burn operations (not actual share amounts, which are encrypted)
    uint256 public totalSharesMinted;

    // Order book
    mapping(uint256 => Order) private orders;
    uint256 public nextOrderId;
    uint256 public nextSequence;
    uint256 public activeOrderCount;
    mapping(bytes32 => PriceLevel) public priceLevels;
    mapping(address => uint256[]) private userOrderIds;
    mapping(address => uint256) private userActiveOrderCount;

    // Best prices (PUBLIC — for UI, unified book)
    uint32 public bestBid;
    uint32 public bestAsk;

    // Redemption
    mapping(address => bool) private redemptionRequested;
    mapping(address => bool) private redemptionFinalized;

    // Emergency
    mapping(address => bool) private emergencyRequested;
    mapping(address => bool) private emergencyFinalized;

    // Encrypted trade fee accumulator
    euint64 private encryptedTradeFees;

    // Cache
    euint64 private ZERO;
    euint8 private ZERO8;

    // ═══════════════════════════════════════
    // EVENTS (additional — OrderPlaced, OrderCancelled, MatchAttempted,
    //         MarketResolved, RedemptionRequested, RedemptionFinalized,
    //         SharesMinted, SharesBurned inherited from IOpaqueMarket)
    // ═══════════════════════════════════════

    event ResolverChanged(address indexed oldResolver, address indexed newResolver);
    event FeeCollectorChanged(address indexed oldCollector, address indexed newCollector);
    event EmergencyWithdrawal(address indexed user, uint256 timestamp);
    event MarketCancelled(address indexed market);

    // ═══════════════════════════════════════
    // CONSTRUCTOR
    // ═══════════════════════════════════════

    constructor(
        string memory _question,
        uint256 _deadline,
        string memory _resolutionSource,
        string memory _resolutionSourceType,
        string memory _resolutionCriteria,
        string memory _category,
        address _resolver,
        address _feeCollector,
        address _token,
        address _creator
    ) {
        if (_deadline <= block.timestamp) revert BadDeadline();
        if (bytes(_resolutionSource).length == 0) revert NoSource();
        if (_resolver == address(0)) revert NoResolver();
        if (_creator == address(0)) revert NoCreator();

        question = _question;
        deadline = _deadline;
        resolutionSource = _resolutionSource;
        resolutionSourceType = _resolutionSourceType;
        resolutionCriteria = _resolutionCriteria;
        category = _category;
        creator = _creator;
        resolver = _resolver;
        feeCollector = _feeCollector != address(0) ? _feeCollector : _creator;
        token = IConfidentialERC20(_token);

        // Cache encrypted zero
        ZERO = FHE.asEuint64(0);
        FHE.allowThis(ZERO);
        ZERO8 = FHE.asEuint8(0);
        FHE.allowThis(ZERO8);

        // Init encrypted trade fee accumulator
        encryptedTradeFees = ZERO;
        FHE.allowThis(encryptedTradeFees);
    }

    // ═══════════════════════════════════════
    // MINT / BURN SHARES
    // ═══════════════════════════════════════

    /// @notice Deposit N cUSDT -> receive N YES + N NO shares.
    ///         1 share = 1_000_000 micro-cUSDT at resolution.
    function mintShares(
        externalEuint64 encryptedAmount,
        bytes calldata inputProof
    ) external nonReentrant whenNotPaused {
        if (resolved) revert Resolved();
        if (block.timestamp >= deadline) revert Closed();

        euint64 amount = FHE.fromExternal(encryptedAmount, inputProof);

        // Ensure amount > 0
        ebool amountIsPositive = FHE.gt(amount, ZERO);
        euint64 validAmount = FHE.select(amountIsPositive, amount, ZERO);

        // Transfer cUSDT from user to this contract
        FHE.allowThis(validAmount);
        FHE.allow(validAmount, address(token));
        euint64 actualAmount = token.transferFromChecked(msg.sender, address(this), validAmount);
        FHE.allowThis(actualAmount);

        // Initialize balances if first time (H-2 fix: fresh encrypted zeros per user)
        if (!hasShares[msg.sender]) {
            yesBalances[msg.sender] = FHE.asEuint64(0);
            FHE.allowThis(yesBalances[msg.sender]);
            noBalances[msg.sender] = FHE.asEuint64(0);
            FHE.allowThis(noBalances[msg.sender]);
            hasShares[msg.sender] = true;
        }

        // Credit N YES + N NO shares
        yesBalances[msg.sender] = FHE.add(yesBalances[msg.sender], actualAmount);
        FHE.allowThis(yesBalances[msg.sender]);
        FHE.allow(yesBalances[msg.sender], msg.sender);

        noBalances[msg.sender] = FHE.add(noBalances[msg.sender], actualAmount);
        FHE.allowThis(noBalances[msg.sender]);
        FHE.allow(noBalances[msg.sender], msg.sender);

        totalSharesMinted++;

        emit SharesMinted(msg.sender, block.timestamp);
    }

    /// @notice Return N YES + N NO shares -> receive N cUSDT back.
    function burnShares(
        externalEuint64 encryptedAmount,
        bytes calldata inputProof
    ) external nonReentrant whenNotPaused {
        if (resolved) revert Resolved();
        if (!hasShares[msg.sender]) revert NoShares();

        euint64 amount = FHE.fromExternal(encryptedAmount, inputProof);

        // Check user has enough of BOTH share types
        ebool hasEnoughYes = FHE.le(amount, yesBalances[msg.sender]);
        ebool hasEnoughNo = FHE.le(amount, noBalances[msg.sender]);
        ebool canBurn = FHE.and(hasEnoughYes, hasEnoughNo);
        euint64 burnAmount = FHE.select(canBurn, amount, ZERO);

        // Deduct shares
        yesBalances[msg.sender] = FHE.sub(yesBalances[msg.sender], burnAmount);
        FHE.allowThis(yesBalances[msg.sender]);
        FHE.allow(yesBalances[msg.sender], msg.sender);

        noBalances[msg.sender] = FHE.sub(noBalances[msg.sender], burnAmount);
        FHE.allowThis(noBalances[msg.sender]);
        FHE.allow(noBalances[msg.sender], msg.sender);

        // Return cUSDT
        FHE.allowThis(burnAmount);
        FHE.allow(burnAmount, address(token));
        token.transferEncrypted(msg.sender, burnAmount);

        // Note: totalSharesMinted is NOT decremented on burn.
        // It tracks mint operations only (monotonic) to prevent cancelMarket/setResolver
        // abuse when users have active positions from matching.

        emit SharesBurned(msg.sender, block.timestamp);
    }

    // ═══════════════════════════════════════
    // ORDER PLACEMENT (UNIFIED)
    // ═══════════════════════════════════════

    /// @notice Place an order with encrypted side. Both bids and asks escrow cUSDT.
    ///         Nobody — not even the contract — knows which side you're betting on.
    /// @param encSide Encrypted side: 0=YES, 1=NO
    /// @param price Public price 100-9900 ($0.01-$0.99 per share)
    /// @param isBid true = buying, false = selling
    /// @param encAmount Encrypted number of shares
    /// @param sideProof ZK proof for encrypted side
    /// @param amountProof ZK proof for encrypted amount
    function placeOrder(
        externalEuint8 encSide,
        uint32 price,
        bool isBid,
        externalEuint64 encAmount,
        bytes calldata sideProof,
        bytes calldata amountProof
    ) external nonReentrant whenNotPaused {
        if (resolved) revert Resolved();
        if (block.timestamp >= deadline) revert Closed();
        if (price < 100 || price > 9900) revert BadPrice();
        if (userActiveOrderCount[msg.sender] >= MAX_ACTIVE_ORDERS) revert OrderLimit();

        euint8 side = FHE.fromExternal(encSide, sideProof);
        euint64 amount = FHE.fromExternal(encAmount, amountProof);

        // Validate side is 0 (YES) or 1 (NO) — reject any other value
        ebool validSide = FHE.or(FHE.eq(side, FHE.asEuint8(SIDE_YES)), FHE.eq(side, FHE.asEuint8(SIDE_NO)));
        // Invalid side → amount becomes 0 (order is a no-op)
        amount = FHE.select(validSide, amount, ZERO);

        // Calculate escrow per share in micro-cUSDT:
        // Bid: price × PRICE_TO_USDT (you pay the price for your side)
        // Ask: (BPS - price) × PRICE_TO_USDT (you risk the complement)
        uint64 escrowPerShare;
        if (isBid) {
            escrowPerShare = uint64(price) * PRICE_TO_USDT;
        } else {
            escrowPerShare = uint64(BPS - uint256(price)) * PRICE_TO_USDT;
        }

        // Overflow protection: ensure amount * escrowPerShare fits in uint64
        uint64 maxSafeSize = type(uint64).max / escrowPerShare;
        euint64 encMaxSize = FHE.asEuint64(maxSafeSize);
        ebool sizeOk = FHE.le(amount, encMaxSize);
        amount = FHE.select(sizeOk, amount, ZERO);
        FHE.allowThis(amount);

        // Calculate total escrow
        euint64 escrow = FHE.mul(amount, FHE.asEuint64(escrowPerShare));
        FHE.allowThis(escrow);
        FHE.allow(escrow, address(token));

        // Transfer cUSDT escrow from user
        euint64 actualEscrow = token.transferFromChecked(msg.sender, address(this), escrow);
        FHE.allowThis(actualEscrow);

        // If transfer failed (returned 0), size becomes 0 too
        ebool transferOk = FHE.gt(actualEscrow, ZERO);
        euint64 actualSize = FHE.select(transferOk, amount, ZERO);
        FHE.allowThis(actualSize);

        euint64 filledSize = ZERO;
        FHE.allowThis(filledSize);

        // Create order
        uint256 orderId = nextOrderId++;
        uint256 seq = nextSequence++;
        Order storage order = orders[orderId];
        order.id = orderId;
        order.owner = msg.sender;
        order.encSide = side;
        order.price = price;
        order.size = actualSize;
        order.filledSize = filledSize;
        order.escrowRemaining = actualEscrow;
        order.isBid = isBid;
        order.isActive = true;
        order.sequence = seq;
        order.createdAt = block.timestamp;

        // ACL: allow contract to use encrypted values in future txs
        FHE.allowThis(order.encSide);
        FHE.allow(order.encSide, msg.sender); // Only owner can decrypt their side
        FHE.allow(order.size, msg.sender);
        FHE.allow(order.filledSize, msg.sender);
        FHE.allow(order.escrowRemaining, msg.sender);

        userOrderIds[msg.sender].push(orderId);
        activeOrderCount++;
        userActiveOrderCount[msg.sender]++;

        // Update price level (unified book — no YES/NO separation)
        bytes32 key = keccak256(abi.encodePacked(price));
        if (isBid) {
            priceLevels[key].bidCount++;
            if (bestBid == 0 || price > bestBid) bestBid = price;
        } else {
            priceLevels[key].askCount++;
            if (bestAsk == 0 || price < bestAsk) bestAsk = price;
        }

        // Event: side and amount are NOT revealed
        emit OrderPlaced(orderId, msg.sender, price, isBid, seq, block.timestamp);
    }

    // ═══════════════════════════════════════
    // TRUSTLESS FHE MATCHING
    // ═══════════════════════════════════════

    /// @notice Attempt to match two orders. ANYONE can call this (permissionless).
    ///         Matching happens entirely in the FHE domain — no decryption occurs.
    ///         Caller gains ZERO information about success or failure.
    ///         Failed matches (same side) look identical to successful matches.
    /// @param bidId The bid order ID
    /// @param askId The ask order ID
    function attemptMatch(uint256 bidId, uint256 askId) external nonReentrant {
        if (resolved) revert Resolved();
        if (block.timestamp >= deadline) revert Closed();

        Order storage bid = orders[bidId];
        Order storage ask = orders[askId];

        // Public checks (reveal nothing about sides)
        if (!bid.isActive) revert BidNotActive();
        if (!ask.isActive) revert AskNotActive();
        if (!bid.isBid) revert NotBid();
        if (ask.isBid) revert NotAsk();
        if (bid.price < ask.price) revert BidLessThanAsk();
        if (bid.owner == ask.owner) revert NoSelfMatch();

        // ═══════════════════════════════════════════════════════
        // ALL LOGIC BELOW IS IN FHE DOMAIN — NO DECRYPTION
        // ═══════════════════════════════════════════════════════

        // Step 1: Check if sides are OPPOSITE (YES vs NO)
        // FHE.ne returns encrypted boolean — nobody sees the result
        ebool isOpposite = FHE.ne(bid.encSide, ask.encSide);

        // Step 2: Calculate potential fill amount (in whole shares)
        euint64 bidRemaining = FHE.sub(bid.size, bid.filledSize);
        euint64 askRemaining = FHE.sub(ask.size, ask.filledSize);
        euint64 potentialFill = FHE.min(bidRemaining, askRemaining);

        // Step 3: Conditional fill — if opposite sides, fill; otherwise 0
        // This is the KEY privacy guarantee: actualFill=0 looks identical to actualFill=N
        euint64 actualFill = FHE.select(isOpposite, potentialFill, ZERO);
        FHE.allowThis(actualFill);

        // Step 4: Trading fee (0.05% of payment at ask price)
        // Fee model: Trade fee is deducted from share backing.
        // Each matched share is backed by (SHARE_UNIT - feePerShare) micro-cUSDT instead of SHARE_UNIT.
        // The difference (feePerShare * fillSize) stays in the contract as trade fees.
        // encryptedTradeFees accumulates these for fee collector withdrawal.
        // Contract solvency: total_escrowed >= sum(share_backing) + encryptedTradeFees + collectedFees
        uint64 feePerShare = uint64((uint256(ask.price) * PRICE_TO_USDT * TRADE_FEE_BPS) / BPS);
        euint64 tradeFee = FHE.mul(actualFill, FHE.asEuint64(feePerShare));
        FHE.allowThis(tradeFee);
        encryptedTradeFees = FHE.add(encryptedTradeFees, tradeFee);
        FHE.allowThis(encryptedTradeFees);

        // Step 5: Calculate share transfer (SHARE_UNIT minus fee to ensure solvency)
        // Each share is backed by (SHARE_UNIT - feePerShare) cUSDT; fee retained by protocol
        uint64 netShareUnit = SHARE_UNIT - feePerShare;
        euint64 shareTransfer = FHE.mul(actualFill, FHE.asEuint64(netShareUnit));
        FHE.allowThis(shareTransfer);

        // Step 6: Update bid order escrow
        // Bid escrowed: bid.price * PRICE_TO_USDT * size
        // On fill: consumed = bid.price * PRICE_TO_USDT * actualFill
        uint64 bidEscrowPerShare = uint64(bid.price) * PRICE_TO_USDT;
        euint64 bidEscrowUsed = FHE.mul(actualFill, FHE.asEuint64(bidEscrowPerShare));
        FHE.allowThis(bidEscrowUsed);
        bid.filledSize = FHE.add(bid.filledSize, actualFill);
        FHE.allowThis(bid.filledSize);
        bid.escrowRemaining = FHE.sub(bid.escrowRemaining, bidEscrowUsed);
        FHE.allowThis(bid.escrowRemaining);

        // Step 7: Update ask order escrow
        // Ask escrowed: (BPS - ask.price) * PRICE_TO_USDT * size
        uint64 askEscrowPerShare = uint64(BPS - uint256(ask.price)) * PRICE_TO_USDT;
        euint64 askEscrowUsed = FHE.mul(actualFill, FHE.asEuint64(askEscrowPerShare));
        FHE.allowThis(askEscrowUsed);
        ask.filledSize = FHE.add(ask.filledSize, actualFill);
        FHE.allowThis(ask.filledSize);
        ask.escrowRemaining = FHE.sub(ask.escrowRemaining, askEscrowUsed);
        FHE.allowThis(ask.escrowRemaining);

        // Step 8: Create outcome tokens for BOTH parties
        // Determine bid's side (encrypted)
        ebool bidIsYes = FHE.eq(bid.encSide, FHE.asEuint8(SIDE_YES));

        // Initialize balances if needed
        _initBalances(bid.owner);
        _initBalances(ask.owner);

        // Bid owner gets tokens for THEIR side
        euint64 bidYesTokens = FHE.select(bidIsYes, shareTransfer, ZERO);
        euint64 bidNoTokens = FHE.select(bidIsYes, ZERO, shareTransfer);
        yesBalances[bid.owner] = FHE.add(yesBalances[bid.owner], bidYesTokens);
        FHE.allowThis(yesBalances[bid.owner]);
        FHE.allow(yesBalances[bid.owner], bid.owner);
        noBalances[bid.owner] = FHE.add(noBalances[bid.owner], bidNoTokens);
        FHE.allowThis(noBalances[bid.owner]);
        FHE.allow(noBalances[bid.owner], bid.owner);

        // Ask owner gets tokens for THEIR side (opposite of bid)
        euint64 askYesTokens = FHE.select(bidIsYes, ZERO, shareTransfer);
        euint64 askNoTokens = FHE.select(bidIsYes, shareTransfer, ZERO);
        yesBalances[ask.owner] = FHE.add(yesBalances[ask.owner], askYesTokens);
        FHE.allowThis(yesBalances[ask.owner]);
        FHE.allow(yesBalances[ask.owner], ask.owner);
        noBalances[ask.owner] = FHE.add(noBalances[ask.owner], askNoTokens);
        FHE.allowThis(noBalances[ask.owner]);
        FHE.allow(noBalances[ask.owner], ask.owner);

        // Step 9: Escrow refund for buyer (price improvement)
        // Price improvement: Bidder escrowed at bid.price but match executes at ask.price.
        // The difference (bid.price - ask.price) * PRICE_TO_USDT is refunded immediately.
        // This refund is separate from outcome tokens — bidder keeps it win or lose.
        // Economically equivalent to limit order execution at better price.
        if (bid.price > ask.price) {
            uint64 priceGap = (uint64(bid.price) - uint64(ask.price)) * PRICE_TO_USDT;
            euint64 bidRefund = FHE.mul(actualFill, FHE.asEuint64(priceGap));
            FHE.allowThis(bidRefund);
            FHE.allow(bidRefund, address(token));
            token.transferEncrypted(bid.owner, bidRefund);
            // Deduct refund from escrow to prevent double-spend on cancel
            bid.escrowRemaining = FHE.sub(bid.escrowRemaining, bidRefund);
            FHE.allowThis(bid.escrowRemaining);
        }

        // Step 10: ACL updates for order owners
        FHE.allow(bid.size, bid.owner);
        FHE.allow(bid.filledSize, bid.owner);
        FHE.allow(bid.escrowRemaining, bid.owner);
        FHE.allow(ask.size, ask.owner);
        FHE.allow(ask.filledSize, ask.owner);
        FHE.allow(ask.escrowRemaining, ask.owner);

        // M-1 fix: Track that matching created positions.
        // Since we can't know the plaintext amount (encrypted), increment by 1 to indicate
        // activity occurred. This prevents cancelMarket() from thinking no one participated.
        totalSharesMinted += 1;

        // Event: intentionally reveals NOTHING about match success
        emit MatchAttempted(bidId, askId, msg.sender, block.timestamp);
    }

    // ═══════════════════════════════════════
    // CANCEL ORDER
    // ═══════════════════════════════════════

    /// @notice Cancel an active order and return escrowed cUSDT.
    function cancelOrder(uint256 orderId) external nonReentrant {
        Order storage order = orders[orderId];
        if (order.owner != msg.sender) revert NotOwner();
        if (!order.isActive) revert NotActive();

        order.isActive = false;
        activeOrderCount--;
        userActiveOrderCount[order.owner]--;

        // Update price level
        bytes32 key = keccak256(abi.encodePacked(order.price));
        if (order.isBid) {
            if (priceLevels[key].bidCount > 0) priceLevels[key].bidCount--;
        } else {
            if (priceLevels[key].askCount > 0) priceLevels[key].askCount--;
        }

        // Advisory best price tracking: reset to 0 when level empties.
        // bestBid/bestAsk are advisory only — a new placeOrder will update them.
        // The matcher bot tracks all active orders off-chain for accurate price discovery.
        if (order.isBid && order.price == bestBid && priceLevels[key].bidCount == 0) {
            bestBid = 0;
        } else if (!order.isBid && order.price == bestAsk && priceLevels[key].askCount == 0) {
            bestAsk = 0;
        }

        // Return escrowed cUSDT (both bids and asks escrow USDT in V2)
        euint64 remaining = order.escrowRemaining;
        order.escrowRemaining = ZERO; // Zero out to prevent stale data (L-1 fix)
        FHE.allowThis(order.escrowRemaining);
        FHE.allowThis(remaining);
        FHE.allow(remaining, address(token));
        token.transferEncrypted(msg.sender, remaining);

        emit OrderCancelled(orderId, msg.sender, block.timestamp);
    }

    /// @notice Cancel specific orders by ID. Replaces cancelAllMyOrders to avoid gas DoS.
    /// @param orderIdsToCancel Array of order IDs to cancel (caller must own them)
    function cancelOrders(uint256[] calldata orderIdsToCancel) external nonReentrant {
        for (uint256 i = 0; i < orderIdsToCancel.length; i++) {
            Order storage order = orders[orderIdsToCancel[i]];
            if (order.owner != msg.sender) revert NotOwner();
            if (!order.isActive) continue; // skip already-cancelled

            order.isActive = false;
            activeOrderCount--;
            userActiveOrderCount[msg.sender]--;

            bytes32 key = keccak256(abi.encodePacked(order.price));
            if (order.isBid) {
                if (priceLevels[key].bidCount > 0) priceLevels[key].bidCount--;
            } else {
                if (priceLevels[key].askCount > 0) priceLevels[key].askCount--;
            }

            // Return escrowed cUSDT, then zero out escrow (L-2 fix)
            euint64 remaining = order.escrowRemaining;
            order.escrowRemaining = ZERO;
            FHE.allowThis(order.escrowRemaining);
            FHE.allowThis(remaining);
            FHE.allow(remaining, address(token));
            token.transferEncrypted(msg.sender, remaining);

            emit OrderCancelled(orderIdsToCancel[i], msg.sender, block.timestamp);
        }
    }

    // ═══════════════════════════════════════
    // RESOLUTION
    // ═══════════════════════════════════════

    /// @notice Resolve the market. Only callable by the designated resolver.
    function resolve(bool _outcome) external {
        if (msg.sender != resolver) revert OnlyResolver();
        if (resolved) revert Resolved();
        if (block.timestamp < deadline) revert NotEnded();
        if (block.timestamp > deadline + GRACE_PERIOD) revert WindowExpired();

        resolved = true;
        outcome = _outcome;
        resolvedAt = block.timestamp;

        emit MarketResolved(_outcome, block.timestamp);
    }

    // ═══════════════════════════════════════
    // REDEMPTION (2-step: makePubliclyDecryptable + checkSignatures)
    // ═══════════════════════════════════════

    /// @notice Request redemption: marks winning share balance as publicly decryptable.
    function requestRedemption() external whenNotPaused {
        if (!resolved) revert NotResolved();
        if (redemptionFinalized[msg.sender]) revert Redeemed();
        if (emergencyFinalized[msg.sender]) revert EmrgRefunded();
        if (!hasShares[msg.sender]) revert NoShares();
        if (redemptionRequested[msg.sender]) revert Requested();

        redemptionRequested[msg.sender] = true;

        // Make winning share balance publicly decryptable
        if (outcome) {
            FHE.makePubliclyDecryptable(yesBalances[msg.sender]);
        } else {
            FHE.makePubliclyDecryptable(noBalances[msg.sender]);
        }

        emit RedemptionRequested(msg.sender, block.timestamp);
    }

    /// @notice Finalize redemption with KMS proof. Pays $1/share - fees.
    function finalizeRedemption(
        uint64 winningShares,
        bytes memory decryptionProof
    ) external nonReentrant whenNotPaused {
        if (!resolved) revert NotResolved();
        if (!redemptionRequested[msg.sender]) revert NotRequested();
        if (redemptionFinalized[msg.sender]) revert Redeemed();
        if (emergencyFinalized[msg.sender]) revert EmrgRefunded();

        // Verify KMS proof
        bytes32[] memory handles = new bytes32[](1);
        if (outcome) {
            handles[0] = FHE.toBytes32(yesBalances[msg.sender]);
        } else {
            handles[0] = FHE.toBytes32(noBalances[msg.sender]);
        }
        bytes memory abiClearValue = abi.encode(winningShares);
        FHE.checkSignatures(handles, abiClearValue, decryptionProof);

        redemptionFinalized[msg.sender] = true;

        // Payout: 1 share = 1_000_000 micro-cUSDT ($1.00)
        uint256 grossPayout = uint256(winningShares);

        if (grossPayout > 0) {
            // Apply percentage fee (0.5%)
            uint256 fee = (grossPayout * FEE_BPS) / BPS;
            uint256 netPayout = grossPayout - fee;

            // Apply flat withdrawal fee ($1.00)
            if (netPayout > WITHDRAW_FEE) {
                netPayout -= WITHDRAW_FEE;
                fee += WITHDRAW_FEE;
            } else {
                fee += netPayout;
                netPayout = 0;
            }

            collectedFees += fee;

            // M-2 fix: Skip transfer if netPayout is 0 (below minimum threshold)
            if (netPayout == 0) {
                emit RedemptionFinalized(msg.sender, 0, block.timestamp);
                return;
            }

            if (netPayout > type(uint64).max) revert Overflow();
            euint64 encPayout = FHE.asEuint64(uint64(netPayout));
            FHE.allowThis(encPayout);
            FHE.allow(encPayout, address(token));
            token.transferEncrypted(msg.sender, encPayout);

            emit RedemptionFinalized(msg.sender, netPayout, block.timestamp);
        } else {
            emit RedemptionFinalized(msg.sender, 0, block.timestamp);
        }
    }

    // ═══════════════════════════════════════
    // EMERGENCY WITHDRAWAL
    // ═══════════════════════════════════════

    /// @notice Emergency withdrawal when market is not resolved after grace period.
    function emergencyWithdraw() external nonReentrant whenNotPaused {
        if (resolved) revert Resolved();
        if (block.timestamp <= deadline + GRACE_PERIOD) revert GraceActive();
        if (!hasShares[msg.sender]) revert NoShares();
        if (emergencyRequested[msg.sender]) revert Requested();

        emergencyRequested[msg.sender] = true;

        FHE.makePubliclyDecryptable(yesBalances[msg.sender]);
        FHE.makePubliclyDecryptable(noBalances[msg.sender]);

        emit EmergencyWithdrawal(msg.sender, block.timestamp);
    }

    /// @notice Finalize emergency withdrawal with KMS proof.
    function finalizeEmergencyWithdraw(
        uint64 yesAmount,
        uint64 noAmount,
        bytes memory decryptionProof
    ) external nonReentrant whenNotPaused {
        if (!emergencyRequested[msg.sender]) revert NotRequested();
        if (emergencyFinalized[msg.sender]) revert Finalized();

        emergencyFinalized[msg.sender] = true;

        bytes32[] memory handles = new bytes32[](2);
        handles[0] = FHE.toBytes32(yesBalances[msg.sender]);
        handles[1] = FHE.toBytes32(noBalances[msg.sender]);
        bytes memory abiClearValues = abi.encode(yesAmount, noAmount);
        FHE.checkSignatures(handles, abiClearValues, decryptionProof);

        // Refund: each YES+NO pair is backed by $1.00 cUSDT.
        uint256 pairs = uint256(yesAmount) < uint256(noAmount) ? uint256(yesAmount) : uint256(noAmount);
        uint256 refund = pairs;
        if (refund > 0 && address(token) != address(0)) {
            if (refund > type(uint64).max) revert Overflow();
            euint64 encRefund = FHE.asEuint64(uint64(refund));
            FHE.allowThis(encRefund);
            FHE.allow(encRefund, address(token));
            token.transferEncrypted(msg.sender, encRefund);
        }
    }

    /// @notice Emergency refund when resolved but redemption KMS times out.
    function emergencyRefundAfterResolution() external nonReentrant {
        if (!resolved) revert NotResolved();
        if (block.timestamp <= resolvedAt + DECRYPT_TIMEOUT) revert TimeoutActive();
        if (!hasShares[msg.sender]) revert NoShares();
        if (emergencyRequested[msg.sender]) revert Requested();

        emergencyRequested[msg.sender] = true;

        FHE.makePubliclyDecryptable(yesBalances[msg.sender]);
        FHE.makePubliclyDecryptable(noBalances[msg.sender]);

        emit EmergencyWithdrawal(msg.sender, block.timestamp);
    }

    // ═══════════════════════════════════════
    // MARKET CANCELLATION
    // ═══════════════════════════════════════

    /// @notice Cancel a market with no shares minted.
    function cancelMarket() external {
        if (msg.sender != creator) revert OnlyCreator();
        if (resolved) revert Resolved();
        if (totalSharesMinted != 0) revert HasParticipants();
        resolved = true;
        emit MarketCancelled(address(this));
    }

    // ═══════════════════════════════════════
    // VIEW FUNCTIONS
    // ═══════════════════════════════════════

    /// @notice Get current mid-price estimate.
    function getCurrentPrice() external view returns (uint32 yesPrice, uint32 noPrice) {
        if (bestBid > 0 && bestAsk > 0) {
            yesPrice = (bestBid + bestAsk) / 2;
        } else if (bestBid > 0) {
            yesPrice = bestBid;
        } else if (bestAsk > 0) {
            yesPrice = bestAsk;
        } else {
            yesPrice = 5000; // Default 50%
        }
        noPrice = uint32(BPS) - yesPrice;
    }

    /// @notice Get user's encrypted share balances.
    function getMyShares() external view returns (euint64 yes, euint64 no) {
        return (yesBalances[msg.sender], noBalances[msg.sender]);
    }

    /// @notice Get order public info (side is NOT returned — it's encrypted).
    function getOrder(
        uint256 orderId
    )
        external
        view
        returns (address owner, uint32 price, bool isBid, bool isActive, uint256 sequence, uint256 createdAt)
    {
        Order storage o = orders[orderId];
        return (o.owner, o.price, o.isBid, o.isActive, o.sequence, o.createdAt);
    }

    /// @notice Get order encrypted fields (only accessible by owner via view key).
    function getOrderEncrypted(
        uint256 orderId
    ) external view returns (euint8 encSide, euint64 size, euint64 filled, euint64 escrow) {
        Order storage o = orders[orderId];
        return (o.encSide, o.size, o.filledSize, o.escrowRemaining);
    }

    /// @notice Get all order IDs for a user.
    function getUserOrders(address user) external view returns (uint256[] memory) {
        return userOrderIds[user];
    }

    /// @notice Get price level info (unified book — no YES/NO separation).
    function getPriceLevel(uint32 price) external view returns (uint256 bidCount, uint256 askCount) {
        bytes32 key = keccak256(abi.encodePacked(price));
        PriceLevel storage level = priceLevels[key];
        return (level.bidCount, level.askCount);
    }

    /// @notice Get best prices.
    function getBestPrices() external view returns (uint32 _bestBid, uint32 _bestAsk) {
        return (bestBid, bestAsk);
    }

    /// @notice Get market info in a single call.
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
        )
    {
        return (
            question,
            deadline,
            resolved,
            outcome,
            totalSharesMinted,
            activeOrderCount,
            resolutionSource,
            resolutionSourceType,
            resolutionCriteria,
            category
        );
    }

    /// @notice Check if user has shares.
    function hasUserShares(address user) external view returns (bool) {
        return hasShares[user];
    }

    // ═══════════════════════════════════════
    // ADMIN
    // ═══════════════════════════════════════

    function setResolver(address _resolver) external {
        if (msg.sender != creator) revert OnlyCreator();
        if (resolved) revert Resolved();
        if (totalSharesMinted != 0) revert HasMints();
        if (_resolver == address(0)) revert ZeroAddress();
        address oldResolver = resolver;
        resolver = _resolver;
        emit ResolverChanged(oldResolver, _resolver);
    }

    function setFeeCollector(address _feeCollector) external {
        if (msg.sender != creator) revert OnlyCreator();
        if (_feeCollector == address(0)) revert ZeroAddress();
        address oldCollector = feeCollector;
        feeCollector = _feeCollector;
        emit FeeCollectorChanged(oldCollector, _feeCollector);
    }

    function withdrawFees() external {
        if (msg.sender != feeCollector) revert OnlyCollector();
        uint256 fees = collectedFees;
        if (fees == 0) revert NoFees();
        collectedFees = 0;

        if (address(token) != address(0)) {
            if (fees > type(uint64).max) revert Overflow();
            euint64 encFees = FHE.asEuint64(uint64(fees));
            FHE.allowThis(encFees);
            FHE.allow(encFees, address(token));
            token.transferEncrypted(feeCollector, encFees);
        }
    }

    function withdrawTradeFees() external {
        if (msg.sender != feeCollector) revert OnlyCollector();
        FHE.allowThis(encryptedTradeFees);
        FHE.allow(encryptedTradeFees, address(token));
        token.transferEncrypted(feeCollector, encryptedTradeFees);
        encryptedTradeFees = ZERO;
        FHE.allowThis(encryptedTradeFees);
    }

    function pause() external {
        if (msg.sender != creator) revert OnlyCreator();
        _pause();
    }

    function unpause() external {
        if (msg.sender != creator) revert OnlyCreator();
        _unpause();
    }

    // ═══════════════════════════════════════
    // TWO-STEP CREATOR TRANSFER
    // ═══════════════════════════════════════

    /// @notice Two-step creator transfer (no timelock — testnet simplicity)
    function transferCreator(address _newCreator) external {
        if (msg.sender != creator) revert OnlyCreator();
        if (_newCreator == address(0)) revert ZeroAddress();
        pendingCreator = _newCreator;
    }

    function acceptCreator() external {
        if (msg.sender != pendingCreator) revert NotPending();
        creator = pendingCreator;
        pendingCreator = address(0);
    }

    // ═══════════════════════════════════════
    // INTERNAL HELPERS
    // ═══════════════════════════════════════

    function _initBalances(address user) internal {
        if (!hasShares[user]) {
            yesBalances[user] = FHE.asEuint64(0);
            noBalances[user] = FHE.asEuint64(0);
            hasShares[user] = true;
            FHE.allowThis(yesBalances[user]);
            FHE.allowThis(noBalances[user]);
        }
    }
}
