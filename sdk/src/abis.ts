/**
 * OPAQUE V3 Contract ABIs
 *
 * Minimal JSON ABIs for ethers v6 Contract interaction.
 * Covers all functions needed by the SDK clients.
 *
 * Note: FHE encrypted types (externalEuint64, externalEuint8) are ABI-encoded
 * as bytes32 handles. The FHE coprocessor resolves them on-chain.
 */

export const OPAQUE_MARKET_ABI = [
  // ═══════ VIEW ═══════
  "function question() view returns (string)",
  "function deadline() view returns (uint256)",
  "function resolved() view returns (bool)",
  "function outcome() view returns (bool)",
  "function resolutionSource() view returns (string)",
  "function resolutionSourceType() view returns (string)",
  "function resolutionCriteria() view returns (string)",
  "function category() view returns (string)",
  "function creator() view returns (address)",
  "function resolver() view returns (address)",
  "function feeCollector() view returns (address)",
  "function collectedFees() view returns (uint256)",
  "function resolvedAt() view returns (uint256)",
  "function totalSharesMinted() view returns (uint256)",
  "function nextOrderId() view returns (uint256)",
  "function nextSequence() view returns (uint256)",
  "function activeOrderCount() view returns (uint256)",
  "function bestBid() view returns (uint32)",
  "function bestAsk() view returns (uint32)",
  "function SIDE_YES() view returns (uint8)",
  "function SIDE_NO() view returns (uint8)",
  "function GRACE_PERIOD() view returns (uint256)",
  "function DECRYPT_TIMEOUT() view returns (uint256)",
  "function MAX_ACTIVE_ORDERS() view returns (uint256)",
  "function SHARE_UNIT() view returns (uint64)",
  "function PRICE_TO_USDT() view returns (uint64)",
  "function FEE_BPS() view returns (uint256)",
  "function TRADE_FEE_BPS() view returns (uint256)",
  "function BPS() view returns (uint256)",
  "function WITHDRAW_FEE() view returns (uint256)",
  "function getCurrentPrice() view returns (uint32 yesPrice, uint32 noPrice)",
  "function getMyShares() view returns (uint256 yes, uint256 no)",
  "function getOrder(uint256 orderId) view returns (address owner, uint32 price, bool isBid, bool isActive, uint256 sequence, uint256 createdAt)",
  "function getOrderEncrypted(uint256 orderId) view returns (uint256 encSide, uint256 size, uint256 filled, uint256 escrow)",
  "function getUserOrders(address user) view returns (uint256[])",
  "function getPriceLevel(uint32 price) view returns (uint256 bidCount, uint256 askCount)",
  "function getBestPrices() view returns (uint32 _bestBid, uint32 _bestAsk)",
  "function getMarketInfo() view returns (string, uint256, bool, bool, uint256, uint256, string, string, string, string)",
  "function hasUserShares(address user) view returns (bool)",

  // ═══════ MUTATING ═══════
  "function mintShares(bytes32 encryptedAmount, bytes inputProof)",
  "function burnShares(bytes32 encryptedAmount, bytes inputProof)",
  "function placeOrder(bytes32 encSide, uint32 price, bool isBid, bytes32 encAmount, bytes sideProof, bytes amountProof)",
  "function cancelOrder(uint256 orderId)",
  "function cancelOrders(uint256[] orderIds)",
  "function attemptMatch(uint256 bidId, uint256 askId)",
  "function resolve(bool outcome)",
  "function requestRedemption()",
  "function finalizeRedemption(uint64 winningShares, bytes decryptionProof)",
  "function emergencyWithdraw()",
  "function finalizeEmergencyWithdraw(uint64 yesAmount, uint64 noAmount, bytes decryptionProof)",
  "function emergencyRefundAfterResolution()",
  "function cancelMarket()",
  "function setResolver(address resolver)",
  "function setFeeCollector(address feeCollector)",
  "function withdrawFees()",
  "function withdrawTradeFees()",
  "function pause()",
  "function unpause()",

  // ═══════ EVENTS ═══════
  "event SharesMinted(address indexed user, uint256 timestamp)",
  "event SharesBurned(address indexed user, uint256 timestamp)",
  "event OrderPlaced(uint256 indexed orderId, address indexed owner, uint32 price, bool isBid, uint256 sequence, uint256 timestamp)",
  "event OrderCancelled(uint256 indexed orderId, address indexed owner, uint256 timestamp)",
  "event MatchAttempted(uint256 indexed bidId, uint256 indexed askId, address indexed caller, uint256 timestamp)",
  "event MarketResolved(bool outcome, uint256 timestamp)",
  "event RedemptionRequested(address indexed user, uint256 timestamp)",
  "event RedemptionFinalized(address indexed user, uint256 payout, uint256 timestamp)",
  "event ResolverChanged(address indexed oldResolver, address indexed newResolver)",
  "event FeeCollectorChanged(address indexed oldFeeCollector, address indexed newFeeCollector)",
  "event EmergencyWithdrawal(address indexed user, uint256 timestamp)",
  "event MarketCancelled(address indexed market)",
] as const;

export const MARKET_FACTORY_ABI = [
  "function getMarketCount() view returns (uint256)",
  "function markets(uint256 index) view returns (address)",
  "function getAllMarkets() view returns (address[])",
  "function createMarket(string question, uint256 deadline, string resolutionSource, string resolutionSourceType, string resolutionCriteria, string category) returns (address)",
  "function createMarketWithResolver(string question, uint256 deadline, string resolutionSource, string resolutionSourceType, string resolutionCriteria, string category, address resolver) returns (address)",
  "function owner() view returns (address)",
  "function defaultResolver() view returns (address)",
  "function creationFeeEnabled() view returns (bool)",
  "function CREATION_FEE() view returns (uint64)",
  "function CREATION_COOLDOWN() view returns (uint256)",
  "function feeCollector() view returns (address)",
  "function token() view returns (address)",
  "function setDefaultResolver(address resolver)",
  "function setFeeCollector(address feeCollector)",
  "function setCreationFeeEnabled(bool enabled)",
  "function transferOwnership(address newOwner)",
  "event MarketCreated(address indexed market, address indexed creator, string question, uint256 deadline, string resolutionSource, string resolutionSourceType, string category, uint256 marketIndex)",
] as const;

export const MARKET_GROUP_ABI = [
  // ═══════ VIEW ═══════
  "function question() view returns (string)",
  "function category() view returns (string)",
  "function owner() view returns (address)",
  "function resolved() view returns (bool)",
  "function winningIndex() view returns (uint256)",
  "function outcomeCount() view returns (uint256)",
  "function getGroupInfo() view returns (string, uint256, bool, uint256, string)",
  "function getOutcome(uint256 index) view returns (string label, address market)",

  // ═══════ MUTATING ═══════
  "function addOutcome(string label, address market)",
  "function resolveGroup(uint256 winnerIndex)",

  // ═══════ EVENTS ═══════
  "event OutcomeAdded(uint256 indexed index, string label, address market)",
  "event GroupResolved(uint256 winningIndex, string winningLabel)",
] as const;

export const ORACLE_RESOLVER_ABI = [
  // ═══════ VIEW ═══════
  "function owner() view returns (address)",
  "function getConfig(address market) view returns (uint8 sourceType, address chainlinkFeed, int256 threshold, bool thresholdAbove, uint256 requiredSignatures, bool isConfigured)",
  "function getOpeningPrice(address market) view returns (int256)",
  "function getMultisigSigners(address market) view returns (address[])",
  "function getVoteCounts(address market) view returns (uint256 yesVotes, uint256 noVotes)",

  // ═══════ MUTATING ═══════
  "function resolveChainlink(address market)",
  "function resolveOnchain(address market)",
  "function resolveDirectly(address market, bool result)",
] as const;

export const CUSDT_ABI = [
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function totalSupply() view returns (uint256)",
  "function balanceOf(address account) view returns (uint256)",
  "function mint(address to, uint256 amount)",
  "function approvePlaintext(address spender, uint64 amount)",
  "function allowancePlaintext(address owner, address spender) view returns (uint64)",
  "function approve(address spender, bytes32 amount, bytes inputProof)",
  "function transfer(address to, bytes32 encryptedAmount, bytes inputProof) returns (uint256)",
  "event Transfer(address indexed from, address indexed to)",
  "event Approval(address indexed owner, address indexed spender)",
  "event Mint(address indexed to, uint256 amount)",
] as const;
