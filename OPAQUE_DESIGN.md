> **V2 UPDATE**: This document was originally written for the LMSR pool-based architecture (V1). The current system (V2)
> uses a **trustless FHE-encrypted order book** with permissionless matching.
>
> **Key V1 → V2 changes:**
>
> - LMSR pool → Order book with `placeOrder()` (encrypted side + amount)
> - `placeBet()` → `mintShares()` + `placeOrder()` + `attemptMatch()`
> - `TFHE.sol` / `GatewayCaller` → `FHE.sol` / `ZamaEthereumConfig` (`@fhevm/solidity@0.10`)
> - Trusted matcher role → **Permissionless matching** (anyone calls `attemptMatch()`)
> - Only amount encrypted → **Both side (YES/NO) AND amount encrypted**
> - `fhevmjs` → `@zama-fhe/relayer-sdk`
> - Price range: 100-9900 BPS ($0.01-$0.99)
>
> See **README.md** for the current V2 architecture, contract addresses, and API reference.

---

# Opaque — FHE-Powered Dark Pool Prediction Market

> "Where bets are private but odds are public."

**Version:** 2.0 **Author:** Himess **Date:** February 2026 **Stack:** Zama fhEVM · Solidity · @fhevm/solidity@0.10 ·
React/Next.js 16 · Ethereum

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Problem Statement](#2-problem-statement)
3. [Solution Architecture](#3-solution-architecture)
4. [What's Hidden vs What's Public](#4-whats-hidden-vs-whats-public)
5. [Smart Contract Design](#5-smart-contract-design)
6. [Confidential Token Integration](#6-confidential-token-integration)
7. [Oracle System](#7-oracle-system)
8. [Market Categories](#8-market-categories)
9. [Trust & Verification](#9-trust--verification)
10. [Competitive Analysis](#10-competitive-analysis)
11. [User Acquisition Strategy](#11-user-acquisition-strategy)
12. [Tech Stack & Deployment](#12-tech-stack--deployment)
13. [MVP Roadmap (5 Weeks)](#13-mvp-roadmap-5-weeks)
14. [Grant Application Strategy](#14-grant-application-strategy)
15. [Frontend Specification](#15-frontend-specification)
16. [Revenue Model](#16-revenue-model)
17. [Risk Assessment](#17-risk-assessment)

---

## 1. Executive Summary

**Opaque** is an FHE-powered prediction market platform that solves whale manipulation in prediction markets by
encrypting both bet amounts AND bet directions while maintaining real-time public price discovery.

**Core Innovation:** Privacy on trader identity/amounts, public odds. This is NOT "hidden Polymarket" — it's "more
accurate Polymarket." Privacy enables a better prediction mechanism by preventing copy-trading and whale manipulation,
producing genuine "wisdom of the crowd" for the first time.

**Key Differentiator:** Unlike Zolymarket (the only FHE prediction market in Zama ecosystem), Opaque encrypts BOTH
amount AND direction. Zolymarket only encrypts amounts — the direction (YES/NO) remains public. Knowing a whale's
direction is sufficient for copy-trading, making amount-only encryption insufficient.

**Target Market:** Prediction markets grew from $15.8B (2024) to $63.5B (2025) — 4x growth. Polymarket reached $9B
valuation, Kalshi $11B. Combined $3.71B funding in 2025 alone.

---

## 2. Problem Statement

### 2.1 Polymarket's Proven Problems

**Whale Manipulation (Documented)**

- 2024 US Election: 4 accounts (Fredi9999, Theo4, PrincessCaro, Michie) placed $30M+ on Trump. Odds shifted from ~50% to
  ~60%. Everyone followed.
- Top traders use 11+ wallets to hide identity (French whale "Théo" example).
- 170+ third-party tools exist for whale tracking and copy-trading (Polywhaler, PolyTrack, stand.trade, Unusual Whales).
- One user reported making $10K/month purely from copy-trading whale signals.
- $40M+ arbitrage profits extracted (April 2024–2025).

**Oracle Manipulation (Documented)**

- UFO Scandal (Dec 2025): $16M market resolved YES with no evidence. Late-session whale buying + UMA token voting
  manipulated the outcome. Community called it "proof-of-whales."
- Ukraine Mineral Deal (March 2025): $7M market resolved YES despite Ukraine not agreeing. UMA whale cast significant
  votes to force resolution.
- Nobel Prize Insider: $85K profit placed 11 hours before announcement, Norwegian investigation launched.

**Wash Trading (Academic)**

- Columbia University research proved ~25% of Polymarket volume is wash trading (fake volume).

**Copy-Trading Ecosystem**

- 170+ tools tracking whale positions in real-time.
- PredictIt (with $3,500/person limit) produces MORE accurate predictions than Polymarket — because "wisdom of 10,000
  people" > "one whale's ego."

### 2.2 Why Privacy is the Solution

The fundamental issue: prediction markets should aggregate independent judgments. When everyone can see what whales bet,
independence breaks down — people follow whales instead of thinking independently.

```
POLYMARKET:
  Whale bets $5M YES → everyone sees → everyone copies
  → Market reflects whale's opinion, not the crowd's
  → "Wisdom of the crowd" breaks

OPAQUE:
  Whale bets $5M YES → nobody sees → nobody can copy
  → Each person decides independently
  → Market reflects GENUINE crowd wisdom
  → First true "wisdom of the crowd"
```

---

## 3. Solution Architecture

### 3.1 Core Design Decision: Public Prices, Private Orders

**The Fundamental Question:** "How can a trader decide without seeing order flow? They need to calculate risk/reward."

**Answer:** Order **prices** (bid/ask levels) are always public. But order **sides** (YES or NO) and **amounts** are
FHE-encrypted. When a whale places a $50K order, the price level is visible — but nobody knows which side (YES/NO) or
how large the order is. Copy-trading becomes impossible: the news "Fredi9999 bought YES, I'll buy too" cannot exist.

**What's visible on the order book:**

- Everyone sees: Order prices (e.g., "bid at $0.60, ask at $0.65")
- Everyone sees: Number of orders at each price level
- Nobody knows: Which side each order is on (YES or NO)
- Nobody knows: The size of each order
- Nobody knows: WHO placed each order
- Result: Copy-trading IMPOSSIBLE, front-running IMPOSSIBLE

### 3.2 Architecture Diagram

```
┌──────────────────────────────────────────────────┐
│            Frontend (Next.js 16 + React 19)       │
│  ┌──────────┐ ┌──────────┐ ┌──────────────────┐  │
│  │ Market   │ │ Trading  │ │ Order Book       │  │
│  │ List     │ │ Panel    │ │ Display          │  │
│  └──────────┘ └────┬─────┘ └──────────────────┘  │
│                    │ client-side FHE encrypt       │
│  ┌──────────┐ ┌────┴──────┐ ┌──────────────────┐ │
│  │ Share    │ │ Mint/Burn │ │ Auto-Match       │ │
│  │ Balance  │ │ Panel     │ │ Button           │ │
│  └──────────┘ └───────────┘ └──────────────────┘ │
└────────────────────┼─────────────────────────────┘
                     │ encrypted tx
                     ▼
┌──────────────────────────────────────────────────┐
│         Smart Contracts (Zama fhEVM)              │
│                                                   │
│  MarketFactory.sol                                │
│  ├── createMarket(question, deadline, src, ...)   │
│  └── getMarkets(offset, limit)                    │
│                                                   │
│  OpaqueMarket.sol (~930 LOC)                      │
│  ├── mintShares(encAmount, proof)                  │
│  ├── burnShares(encAmount, proof)                  │
│  ├── placeOrder(encSide, price, isBid, encAmt...) │
│  ├── cancelOrder(orderId) / cancelOrders(ids[])   │
│  ├── attemptMatch(bidId, askId) ← PERMISSIONLESS  │
│  ├── resolve(bool outcome) ← oracle               │
│  ├── requestRedemption() → KMS public decrypt      │
│  ├── finalizeRedemption(amount, proof)             │
│  └── getMyShares() → EIP-712 user decrypt          │
│                                                   │
│  OracleResolver.sol (~400 LOC)                    │
│  ├── Chainlink price feeds (Tier 1)               │
│  ├── Onchain verifiable (Tier 2)                  │
│  ├── Manual voting w/ multi-sig (Tier 3)          │
│  └── 5-min BTC auto-cycling markets               │
└──────────────────────────────────────────────────┘
                     │
                     ▼
            Zama Coprocessor Network
            (FHE computations)
            + Zama KMS (threshold decryption)
```

---

## 4. What's Hidden vs What's Public

### Always Public

| Data                           | Why Public                              | How                               |
| ------------------------------ | --------------------------------------- | --------------------------------- |
| Order prices (bid/ask levels)  | Users need risk/reward calculation      | uint32 price field (100-9900 BPS) |
| Number of orders at each price | Market depth, liquidity visibility      | On-chain counter per price level  |
| Order type (bid or ask)        | Market structure                        | bool isBid field                  |
| Market question & deadline     | Users need to know what they're trading | Plaintext strings                 |
| Market resolution outcome      | Final result must be verifiable         | Oracle result                     |
| Total shares minted            | Market size transparency                | uint256 counter                   |
| Timestamps, sequence numbers   | FIFO ordering                           | Block timestamps                  |

### Always Private (FHE-Encrypted)

| Data                         | Why Private                         | How                                         |
| ---------------------------- | ----------------------------------- | ------------------------------------------- |
| Order side (YES or NO)       | Prevent copy-trading, front-running | `euint8` encrypted via `FHE.fromExternal()` |
| Order size (share amount)    | Prevent inferring position size     | `euint64` encrypted                         |
| User share balances (YES/NO) | Complete position privacy           | Encrypted mapping                           |
| Fill amounts from matching   | Match outcome hidden                | `FHE.min()` + `FHE.select()`                |
| Match success/failure        | Indistinguishable on-chain          | `FHE.select()` — zero-effect on failure     |

### Revealed at Redemption

| Data                     | When             | Who Sees                              |
| ------------------------ | ---------------- | ------------------------------------- |
| Winner (YES/NO)          | After resolution | Everyone (oracle result)              |
| Individual share balance | Redemption time  | Only the owner (KMS public decrypt)   |
| Payout amount            | Redemption time  | Only the owner (on-chain calculation) |

**Rationale:** Privacy matters during the market's OPEN period to prevent manipulation. After resolution, individual
redemption amounts are revealed only to the owner via Zama KMS decryption proofs. Aggregate pool data is never
explicitly revealed — each user redeems their winning shares at $1.00 each.

---

## 5. Smart Contract Design

### 5.1 Core Market Contract (OpaqueMarket.sol — ~930 LOC)

```solidity
// SPDX-License-Identifier: BSD-3-Clause-Clear
pragma solidity ^0.8.24;

import "@fhevm/solidity/lib/FHE.sol";
import { ZamaEthereumConfig } from "@fhevm/solidity/config/ZamaConfig.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";

contract OpaqueMarket is ZamaEthereumConfig, ReentrancyGuard, Pausable, IOpaqueMarket {
  // ═══════════════════════════════════════
  // KEY TYPES
  // ═══════════════════════════════════════

  struct Order {
    uint256 id;
    address owner;
    euint8 encSide; // ENCRYPTED: 0=YES, 1=NO
    uint32 price; // PUBLIC: 100-9900 ($0.01-$0.99)
    euint64 size; // ENCRYPTED: share count
    euint64 filledSize; // ENCRYPTED: filled amount
    euint64 escrowRemaining; // ENCRYPTED: locked USDT
    bool isBid; // PUBLIC: buy or sell
    bool isActive;
    uint256 sequence; // FIFO ordering
    uint256 createdAt;
  }

  // ═══════════════════════════════════════
  // STATE
  // ═══════════════════════════════════════

  // Market metadata
  string public question;
  uint256 public deadline;
  bool public resolved;
  bool public outcome;
  address public resolver;
  address public creator;
  address public feeCollector;

  // Token
  IConfidentialERC20 public token;

  // Share balances (ENCRYPTED)
  mapping(address => euint64) private yesBalances;
  mapping(address => euint64) private noBalances;
  uint256 public totalSharesMinted; // PUBLIC monotonic counter

  // Order book
  mapping(uint256 => Order) private orders;
  uint256 public nextOrderId;
  uint256 public activeOrderCount;
  mapping(address => uint256[]) private userOrderIds;

  // Redemption (two-step: request → KMS decrypt → finalize)
  mapping(address => bool) private redemptionRequested;
  mapping(address => bool) private redemptionFinalized;

  // Constants
  uint256 public constant SHARE_UNIT = 1_000_000; // 1 share = $1.00
  uint256 public constant BPS = 10_000;
  uint256 public constant PRICE_TO_USDT = 100;
  uint256 public constant FEE_BPS = 50; // 0.5% redemption fee
  uint256 public constant TRADE_FEE_BPS = 5; // 0.05% per match
  uint256 public constant FLAT_FEE = 1_000_000; // $1.00 flat fee
  uint256 public constant MAX_ACTIVE_ORDERS = 200;
  uint256 public constant GRACE_PERIOD = 7 days;
  uint256 public constant DECRYPT_TIMEOUT = 7 days;

  // ═══════════════════════════════════════
  // EVENTS (intentionally leak NO private data)
  // ═══════════════════════════════════════

  event SharesMinted(address indexed user, uint256 timestamp);
  event SharesBurned(address indexed user, uint256 timestamp);
  event OrderPlaced(
    uint256 indexed orderId,
    address indexed owner,
    uint32 price,
    bool isBid,
    uint256 sequence,
    uint256 timestamp
  );
  event OrderCancelled(uint256 indexed orderId, address indexed owner, uint256 timestamp);
  event MatchAttempted(uint256 indexed bidId, uint256 indexed askId, address indexed caller, uint256 timestamp);
  event MarketResolved(bool outcome, uint256 timestamp);
  event RedemptionRequested(address indexed user, uint256 timestamp);
  event RedemptionFinalized(address indexed user, uint256 payout, uint256 timestamp);

  // ═══════════════════════════════════════
  // CORE FUNCTIONS
  // ═══════════════════════════════════════

  /// @notice Deposit cUSDT to mint equal YES + NO shares
  /// 1 cUSDT = 1 YES share + 1 NO share (= $1.00 each)
  function mintShares(externalEuint64 encAmount, bytes calldata proof) external;

  /// @notice Burn equal YES + NO shares to get cUSDT back
  function burnShares(externalEuint64 encAmount, bytes calldata proof) external;

  /// @notice Place an order with encrypted side and amount
  /// Price is public (100-9900), side is encrypted (0=YES, 1=NO)
  /// Escrow: bid locks price*PRICE_TO_USDT*amount cUSDT
  ///         ask locks amount shares (of the encrypted side)
  function placeOrder(
    externalEuint8 encSide,
    uint32 price,
    bool isBid,
    externalEuint64 encAmount,
    bytes calldata sideProof,
    bytes calldata amountProof
  ) external;

  /// @notice Cancel an order and return escrowed assets
  function cancelOrder(uint256 orderId) external;

  /// @notice Batch cancel multiple orders
  function cancelOrders(uint256[] calldata orderIds) external;

  /// @notice PERMISSIONLESS matching — anyone can call
  /// Uses FHE.select so failed matches (same side) produce
  /// zero-effect transactions indistinguishable from success
  function attemptMatch(uint256 bidId, uint256 askId) external;

  /// @notice Resolve market outcome (resolver only, after deadline)
  function resolve(bool _outcome) external;

  /// @notice Request KMS public decryption of winning share balance
  function requestRedemption() external;

  /// @notice Finalize redemption with KMS decryption proof
  /// Payout = shares * $1.00 - 0.5% fee - $1.00 flat fee
  function finalizeRedemption(uint64 amount, bytes calldata proof) external;

  /// @notice Emergency withdrawal after 7-day grace period
  function emergencyWithdraw() external;
}
```

**Key Design Decisions:**

1. **No LMSR:** V2 uses a traditional order book. Price discovery happens through bid/ask spread, not a formula. This is
   more capital-efficient and matches how real prediction markets work.

2. **Encrypted Side (euint8):** The side of every order (YES=0, NO=1) is FHE-encrypted. This means even the contract
   cannot distinguish YES orders from NO orders during matching — it uses `FHE.select()` to branch on encrypted
   conditions.

3. **Permissionless Matching:** Anyone can call `attemptMatch(bidId, askId)`. The caller sees NOTHING about whether the
   match succeeded. Failed matches (e.g., both orders on the same side) produce zero-effect transactions that are
   on-chain indistinguishable from successful matches.

4. **Two-Step Redemption:** After resolution, users call `requestRedemption()` which marks their winning balance for KMS
   public decryption. Then `finalizeRedemption(amount, proof)` verifies the KMS proof and pays out.

5. **Share Minting:** Users deposit cUSDT to receive equal YES + NO shares. This is the only way to create shares —
   ensuring the market is always fully collateralized (every YES share has a matching NO share).

### 5.2 Matching Algorithm (Core Innovation)

```solidity
function attemptMatch(uint256 bidId, uint256 askId) external nonReentrant whenNotPaused {
  Order storage bid = orders[bidId];
  Order storage ask = orders[askId];

  // PUBLIC checks: both active, bid.price >= ask.price, bid is bid, ask is ask
  if (!bid.isActive) revert BidNotActive();
  if (!ask.isActive) revert AskNotActive();
  if (!bid.isBid) revert NotBid();
  if (ask.isBid) revert NotAsk();
  if (bid.price < ask.price) revert BidLessThanAsk();

  // ENCRYPTED check: verify sides are opposite (one YES, one NO)
  // If same side → match is invalid → FHE.select produces zero fill
  ebool sidesMatch = FHE.ne(bid.encSide, ask.encSide);

  // Calculate fill amount (encrypted)
  euint64 bidRemaining = FHE.sub(bid.size, bid.filledSize);
  euint64 askRemaining = FHE.sub(ask.size, ask.filledSize);
  euint64 rawFill = FHE.min(bidRemaining, askRemaining);

  // If sides don't match → fillSize = 0 (zero-effect transaction)
  euint64 fillSize = FHE.select(sidesMatch, rawFill, ZERO);

  // Settlement at ask price (price improvement goes to buyer)
  euint64 payment = FHE.mul(fillSize, FHE.asEuint64(uint64(ask.price) * PRICE_TO_USDT));

  // Update orders
  bid.filledSize = FHE.add(bid.filledSize, fillSize);
  ask.filledSize = FHE.add(ask.filledSize, fillSize);
  bid.escrowRemaining = FHE.sub(bid.escrowRemaining, payment);
  ask.escrowRemaining = FHE.sub(ask.escrowRemaining, fillSize);

  // Trade fee deduction from fill
  euint64 feePerShare = FHE.asEuint64(uint64((SHARE_UNIT * TRADE_FEE_BPS) / BPS));
  euint64 netPerShare = FHE.asEuint64(uint64(SHARE_UNIT - (SHARE_UNIT * TRADE_FEE_BPS) / BPS));
  euint64 netFill = FHE.mul(fillSize, netPerShare);

  // Settle shares: buyer gets shares of ask's side, seller gets cUSDT
  // Uses FHE.select to determine which balance to credit
  // ... (full implementation in OpaqueMarket.sol)

  emit MatchAttempted(bidId, askId, msg.sender, block.timestamp);
  // NOTE: Event reveals NO information about match success/failure
}
```

**Why this is trustless:** The matcher (caller) learns absolutely nothing:

- They don't know if sides matched (YES vs NO)
- They don't know the fill amount
- They don't know if any shares actually transferred
- A failed match looks identical to a successful one on-chain

### 5.3 Market Factory Contract (MarketFactory.sol — ~165 LOC)

```solidity
contract MarketFactory is ZamaEthereumConfig {
    address[] public markets;
    address public owner;
    address public pendingOwner;       // Two-step ownership transfer
    address public defaultResolver;
    address public feeCollector;
    IConfidentialERC20 public token;

    uint64 public immutable CREATION_FEE;
    uint256 public immutable MIN_DURATION;
    uint256 public immutable CREATION_COOLDOWN;

    constructor(
        address _defaultResolver, address _feeCollector, address _token,
        uint64 _creationFee, uint256 _minDuration, uint256 _creationCooldown
    );

    function createMarket(
        string memory question, uint256 deadline,
        string memory resolutionSource, string memory resolutionSourceType,
        string memory resolutionCriteria
    ) external returns (address);

    function createMarketWithResolver(
        string memory question, uint256 deadline,
        string memory resolutionSource, string memory resolutionSourceType,
        string memory resolutionCriteria, address customResolver
    ) external returns (address);

    function transferOwnership(address newOwner) external;
    function acceptOwnership() external;
}
```

### 5.4 Escrow Design

**BUY Orders (isBid = true):**

- Escrow = `price * PRICE_TO_USDT * amount` cUSDT
- Example: Buy 10 shares at $0.60 → escrow 10 \* 60_000 = 600_000 micro-cUSDT ($0.60)
- Uses `token.transferFromChecked()` which returns 0 on insufficient balance (silent FHE failure)

**SELL Orders (isBid = false):**

- Escrow = `amount` shares (deducted from user's YES or NO balance via encrypted side)
- Uses `FHE.select()` to deduct from the correct balance based on encrypted side

**Price Improvement:**

- Matches settle at **ask price**, not bid price
- Bid's excess escrow (bid_price - ask_price) \* fill is refunded to buyer's token balance

---

## 6. Confidential Token Integration

### 6.1 Zama's Confidential Token Ecosystem

**Zama mainnet** launched December 30, 2025 with confidential tokens:

- **cUSDT**: Encrypted USDT via Zaiffer Protocol (ERC-7984 standard)
- **Transaction cost**: ~$0.13 per encrypted operation
- **Zaiffer Protocol**: Converts standard ERC-20 → confidential ERC-7984 tokens with encrypted balances and transfers

### 6.2 User Flow

```
Step 1: Shield
  User has 500 USDT in wallet
  → Calls Zaiffer Protocol (or mints test cUSDT on testnet)
  → Receives 500 cUSDT (encrypted balance)
  → On-chain: transfer visible, AMOUNT hidden

Step 2: Mint Shares
  User calls OpaqueMarket.mintShares(encrypted_amount, proof)
  → Deposits N cUSDT → receives N YES shares + N NO shares
  → On-chain: "someone minted shares" — amount hidden

Step 3: Trade
  User calls OpaqueMarket.placeOrder(encSide, price, isBid, encAmount, ...)
  → Places buy/sell order with encrypted side + encrypted amount
  → Price is public, side (YES/NO) and amount are FHE-encrypted
  → On-chain: "order at price $0.60" — side and size hidden

Step 4: Matching
  Anyone calls attemptMatch(bidId, askId) — PERMISSIONLESS
  → FHE computes fill amount, settles shares + cUSDT
  → Caller sees NOTHING about match result
  → Failed matches indistinguishable from successful ones

Step 5: Resolution
  Market resolves after deadline (oracle provides outcome)
  User calls requestRedemption() → KMS public decryption
  User calls finalizeRedemption(amount, proof) → payout in cUSDT

Step 6: Unshield (Optional)
  User converts cUSDT → USDT via Zaiffer
  → Can withdraw to CEX or other DeFi
```

### 6.3 Testnet Strategy

For development on Ethereum Sepolia testnet:

- Deployed `ConfidentialUSDT.sol` (~100 LOC) — a custom FHE-compatible ERC20 with owner-only minting.
- Implements `transferFromChecked()` which returns 0 on insufficient balance (FHE silent failure pattern).
- Implements `transferEncrypted()` for encrypted transfers between accounts.
- Migration to real cUSDT on mainnet requires only changing the token address in MarketFactory.

```solidity
// ConfidentialUSDT.sol — deployed on Sepolia
contract ConfidentialUSDT is ZamaEthereumConfig {
  mapping(address => euint64) private balances;
  string public name = "Confidential USDT";
  string public symbol = "cUSDT";

  function mint(address to, uint64 amount) external onlyOwner;
  function transferEncrypted(address to, euint64 amount) external;
  function transferFromChecked(address from, address to, euint64 amount) external returns (euint64 transferred);
  function balanceOf(address account) external view returns (euint64);
}
```

---

## 7. Oracle System

### 7.1 Source-Mandatory Markets (Core Innovation)

**Problem:** UMA oracle scandals ($16M UFO market, $7M Ukraine market) stem from ambiguous resolution criteria. "Did X
happen?" is subjective.

**Solution:** Every market MUST specify a verifiable resolution source at creation time. No source = no market.

```javascript
// Example market creation
{
  question: "BTC exceeds $200K by Dec 2026?",
  source: "Chainlink BTC/USD Price Feed",
  source_type: "onchain_oracle",
  threshold: ">= 200000",
  deadline: "2026-12-31T23:59:59Z"
}

// This CANNOT be created:
{
  question: "Will aliens visit Earth?",
  source: "",  // ← REJECTED: no verifiable source
}
```

**This rule eliminates ~90% of oracle problems** by making every market outcome deterministically verifiable.

### 7.2 Oracle Tiers

#### Tier 1 — Chainlink Price Feeds (MVP)

- **What:** BTC/USD, ETH/USD, gold, forex, stock indices
- **How:** Direct on-chain Chainlink feed reading at deadline
- **Manipulation risk:** Near zero (Chainlink is battle-tested)
- **Markets:** Crypto price predictions, commodity prices, forex rates
- **Implementation:** Contract reads Chainlink aggregator at deadline block

```solidity
import "@chainlink/contracts/src/v0.8/interfaces/AggregatorV3Interface.sol";

function resolveFromChainlink(address feed, int256 threshold) external {
  (, int256 price, , , ) = AggregatorV3Interface(feed).latestRoundData();
  bool result = price >= threshold;
  market.resolve(result);
}
```

#### Tier 2 — Onchain Verifiable (Week 1-2)

- **What:** Airdrop amounts, FDV/market cap, TVL, stablecoin supply, gas fees, network metrics
- **How:** Read from on-chain sources (DEX pools, lending protocols, L1 state)
- **Markets:** "Will Aave TVL exceed $30B?", "Will USDC supply hit $100B?"
- **Implementation:** Custom resolver contracts that read on-chain state

#### Tier 3 — API Verifiable (Month 1)

- **What:** Stock indices (S&P 500, Nasdaq), individual stocks (Tesla, Nvidia), Twitter/GitHub metrics, interest rates
  (Fed, ECB)
- **How:** Chainlink Functions or custom oracle with API calls
- **Markets:** "Will S&P 500 close above 6000?", "Will Elon's Twitter followers exceed 200M?"
- **Implementation:** Chainlink Functions with specific API endpoint + JSON path

#### Tier 4 — AI Oracle Consensus (V2 Feature)

- **What:** Subjective/complex markets (AI model releases, regulation decisions, sports)
- **How:** 3 AI APIs (Claude + GPT + Gemini) independently query a structured question. 2/3 consensus required.
- **Key insight:** Transform subjective questions into verifiable tasks

```
Market: "Did OpenAI announce AGI?"
Resolution criterion: "Does openai.com/blog contain the word 'AGI' in a post after [date]?"

Claude (web search) → scans openai.com/blog → NO
GPT (browsing)     → scans openai.com/blog → NO
Gemini (search)    → scans openai.com/blog → NO

3/3 consensus → NO ✅
Raw responses uploaded to IPFS, hash stored in tx
```

**NOT subjective anymore** — it's a deterministic text search. The AI is just executing a structured query, not making a
judgment call.

### 7.3 Oracle Resolver Contract (OracleResolver.sol — ~400 LOC)

The deployed OracleResolver implements a multi-tier resolution system:

```solidity
contract OracleResolver is Ownable2Step, ReentrancyGuard {
  // ═══════ Tier 1: Chainlink Price Feeds ═══════

  function configureChainlink(
    address market,
    address feed,
    int256 threshold,
    bool thresholdAbove,
    uint256 staleness
  ) external onlyOwner;

  // 5-minute BTC auto-cycling markets
  function configureChainlinkAutoThreshold(
    address market,
    address feed,
    bool thresholdAbove,
    uint256 staleness
  ) external onlyOwner;
  // Records opening BTC price, uses it as threshold after 5 min

  function resolveChainlink(address market) external nonReentrant;
  // Reads Chainlink feed, compares to threshold, resolves

  // ═══════ Tier 2: On-Chain Oracle ═══════

  function configureOnchain(
    address market,
    address source,
    bytes4 selector,
    int256 threshold,
    bool thresholdAbove
  ) external onlyOwner;

  function resolveOnchain(address market) external nonReentrant;

  // ═══════ Tier 3: Manual Voting ═══════

  function configureManual(address market, address[] voters, uint256 threshold) external onlyOwner;

  function voteManual(address market, bool result) external;
  // voters submit YES/NO votes; auto-resolves when threshold met

  function resetManualVoting(address market) external onlyOwner;
  // 1-day cooldown between resets (M-SC6 protection)

  // ═══════ Direct Resolution ═══════

  function resolveDirectly(address market, bool result) external onlyOwner;
  // Only after market deadline has passed (M-SC2 protection)
}
```

**Key safety features:**

- `resolveDirectly` requires market deadline to have passed (prevents premature resolution)
- `resetManualVoting` has 1-day cooldown (prevents vote manipulation via rapid resets)
- Chainlink staleness check prevents using stale price data
- Two-step ownership transfer (Ownable2Step)

---

## 8. Market Categories

### Tier 1 — Launch (Chainlink Feeds)

| Category     | Example Markets             | Oracle            |
| ------------ | --------------------------- | ----------------- |
| Crypto Price | "BTC > $200K by Dec 2026?"  | Chainlink BTC/USD |
| Crypto Price | "ETH > $10K by Q3 2026?"    | Chainlink ETH/USD |
| Crypto Price | "SOL > $500 by June 2026?"  | Chainlink SOL/USD |
| Commodities  | "Gold > $3000/oz by March?" | Chainlink XAU/USD |
| Forex        | "EUR/USD > 1.15 by Q2?"     | Chainlink EUR/USD |

### Tier 2 — Weeks 1-2 (Onchain Verifiable)

| Category       | Example Markets                             | Oracle                  |
| -------------- | ------------------------------------------- | ----------------------- |
| Airdrop        | "LayerZero airdrop > 100 ZRO per eligible?" | Contract read           |
| FDV/Market Cap | "Solana FDV > $200B?"                       | DEX pool price × supply |
| TVL            | "Aave TVL > $30B?"                          | DeFi Llama / on-chain   |
| Stablecoin     | "USDC supply > $100B?"                      | Contract totalSupply()  |
| Gas Fees       | "Ethereum avg gas < 10 gwei for 7 days?"    | Block data              |

### Tier 3 — Month 1 (API Verifiable)

| Category       | Example Markets                  | Oracle                    |
| -------------- | -------------------------------- | ------------------------- |
| Stock Indices  | "S&P 500 closes > 6500?"         | Chainlink Functions + API |
| Stocks         | "NVDA market cap > $5T?"         | Chainlink Functions + API |
| Social         | "Elon Twitter followers > 250M?" | API endpoint              |
| Interest Rates | "Fed cuts rates in June?"        | Fed data feed             |

### Tier 4 — V2 (Structured Verification)

| Category    | Example Markets                          | Oracle                    |
| ----------- | ---------------------------------------- | ------------------------- |
| AI Releases | "GPT-5 released before July?"            | AI Oracle Consensus       |
| Sports      | "Champions League winner = Real Madrid?" | API + multi-source        |
| Regulation  | "US Bitcoin reserve established?"        | Government source         |
| Blockchain  | "Major DEX hack > $100M in Q2?"          | Multi-source verification |

### Crypto-Native Markets (Strong Category)

Airdrop predictions, FDV forecasts, TVL competitions — all fully onchain verifiable. **Insider information is especially
valuable here** (project team members, VCs know airdrop details). Privacy-enabled platform lets this information safely
enter the market, producing better predictions.

---

## 9. Trust & Verification

### 9.1 Problem: The Privacy Paradox

On Polymarket, everyone can see every transaction and verify everything. In an FHE system, computation is encrypted —
how do users trust that the contract computed correctly?

### 9.2 Solution A: Zama KMS (Key Management System)

Zama's KMS uses **threshold decryption** — the master decryption key is split across multiple nodes using MPC. No single
party (including the contract deployer) can decrypt FHE data alone.

- 13 MPC nodes in Zama's production network
- AWS Nitro Enclaves for additional security
- Majority required for any decryption operation
- All operations publicly visible through the Gateway

### 9.3 Solution B: Two-Step Redemption with KMS Verification

After resolution, each winner redeems individually:

```
Redemption Flow:
────────────────────────────
Market: "BTC > $200K by Dec 2026?"
Outcome: YES ✅

Step 1: requestRedemption()
  → Marks user's winning share balance for KMS public decryption
  → FHE.makePubliclyDecryptable(winningBalance)
  → FHE.requestDecryption(winningBalance)

Step 2: finalizeRedemption(amount, proof)
  → KMS provides decrypted amount + cryptographic proof
  → Contract verifies proof on-chain
  → Payout = amount * $1.00 - 0.5% fee - $1.00 flat fee
  → cUSDT transferred to user

Example:
  User has 10 YES shares (decrypted: 10_000_000 micro-cUSDT)
  Gross payout: $10.00
  Fee: $10.00 * 0.5% = $0.05
  Flat fee: $1.00
  Net payout: $8.95
```

**Key properties:**

- Each user's redemption is independent (no aggregate pool reveal needed)
- KMS proof prevents fraudulent redemption claims
- Winning shares always redeem at $1.00 each (market is fully collateralized)
- Individual redemption amounts visible only to the redeemer

### 9.4 Solution C: Emergency Safeguards

Two emergency mechanisms protect users if resolution or KMS decryption fails:

1. **Emergency Withdrawal** — If market never resolves, users can withdraw after a 7-day grace period past deadline.
   Their YES + NO shares are burned and cUSDT refunded based on total minted.

2. **Emergency Refund After Resolution** — If KMS decryption times out (7 days after requesting redemption), users can
   claim an emergency refund.

---

## 10. Competitive Analysis

### 10.1 Feature Comparison

| Feature                 | Polymarket      | Zolymarket          | **OPAQUE V2**                       |
| ----------------------- | --------------- | ------------------- | ----------------------------------- |
| Order book              | ✅ CLOB         | ?                   | ✅ FHE Order Book                   |
| Order amount privacy    | ❌ Public       | ✅ Encrypted        | ✅ **Encrypted (euint64)**          |
| Order side privacy      | ❌ Public       | ❌ **Public**       | ✅ **Encrypted (euint8)**           |
| Matching                | Centralized     | ?                   | ✅ **Permissionless on-chain**      |
| Match outcome visible   | Yes             | ?                   | ✅ **No (FHE.select)**              |
| Whale tracking          | ❌ 170+ tools   | Partially mitigated | ✅ **Impossible**                   |
| Copy-trading            | ❌ Rampant      | Partially mitigated | ✅ **Impossible**                   |
| Front-running           | ❌ Possible     | Partially mitigated | ✅ **Impossible (encrypted sides)** |
| Oracle manipulation fix | ❌ UMA scandals | ❌ No fix           | ✅ Source-mandatory + Chainlink     |
| Multi-market platform   | ✅              | ❌ Single           | ✅ Factory pattern                  |
| Confidential token      | ❌              | ❌                  | ✅ cUSDT (FHE ERC20)                |
| Post-close verification | ✅ (all public) | ?                   | ✅ (KMS proof verification)         |
| Insider-safe trading    | ❌              | ❌                  | ✅                                  |
| Auto-cycling markets    | ❌              | ❌                  | ✅ 5-min BTC Chainlink              |

### 10.2 Why Opaque > Zolymarket

The CRITICAL difference: **Zolymarket only encrypts amounts, direction remains public.**

If a whale bets on YES and everyone can see the direction, copy-trading still works. You don't need to know the amount —
knowing a respected trader's DIRECTION is sufficient to copy-trade.

Opaque encrypts BOTH. The only observable event is: "someone placed a bet on this market." That's it.

### 10.3 Broader Competitive Landscape

- **Polymarket** ($9B valuation): Market leader but suffering from whale manipulation, wash trading, oracle scandals
- **Kalshi** ($11B valuation, $1B Series E): Regulated US market, no privacy
- **Azuro**: DeFi sports betting, no privacy
- **Gnosis/Omen**: AMM-based, declining relevance, no privacy
- **Augur v2**: Mostly inactive

None have privacy. The market is wide open.

---

## 11. User Acquisition Strategy

### 11.1 Target Segments

**Segment 1: Whales & Pro Traders (PRIMARY)**

- Already actively seeking privacy (11 wallets, handle changes, secondary accounts)
- Copy-traders erode their edge immediately
- Value prop: "Bet here, nobody can see or copy you"
- Channel: Direct outreach, CT (Crypto Twitter), trading communities

**Segment 2: Insider Information Holders**

- Company employees, political advisors, scientists, project team members
- Cannot bet on Polymarket (would be identified and investigated)
- Value prop: "Your knowledge enters the market safely, prices become more accurate"
- Channel: Anonymous marketing, privacy-focused communities

**Segment 3: Regulatory Risk Users**

- Polymarket banned in Portugal, Hungary. US requires KYC via Coinbase.
- Value prop: "Privacy as functional necessity"
- Channel: VPN communities, privacy advocates

### 11.2 Cold Start Solution

```
Polymarket's volume: 70%+ comes from top 1000 traders
→ These 1000 people = target audience

Strategy:
1. DM top Polymarket whales directly (many are known on CT)
2. Target pro traders frustrated by copy-trading eroding edge
3. First 50-100 whales arrive → liquidity arrives
4. Liquidity arrives → smaller traders follow

One-liner pitch to whales:
"You spend 11 wallets hiding your bets. We hide them with math."
```

### 11.3 Growth Flywheel

```
Privacy → Whales come → Liquidity → Accurate odds
   ↑                                      │
   └──── Better predictions ← More users ←┘
```

---

## 12. Tech Stack & Deployment

### 12.1 Technology Stack

| Layer              | Technology                                                 | Purpose                                 |
| ------------------ | ---------------------------------------------------------- | --------------------------------------- |
| Smart Contracts    | Solidity 0.8.27 + `@fhevm/solidity@0.10`                   | Core market logic, encrypted order book |
| Confidential Token | ConfidentialUSDT (custom FHE ERC20)                        | Encrypted deposits/payouts              |
| Oracle             | Chainlink V3 Price Feeds + on-chain oracle + manual voting | Multi-tier resolution                   |
| Frontend           | Next.js 16 + React 19 + wagmi v3 + viem                    | User interface                          |
| FHE SDK            | `@zama-fhe/relayer-sdk@0.4`                                | EIP-712 user decrypt, public decrypt    |
| Key Management     | Zama KMS (MPC threshold decryption)                        | Decryption key security                 |
| Testing            | Hardhat + Chai + `@fhevm/hardhat-plugin@0.4`               | 321 tests, ~20s                         |
| Testnet            | Ethereum Sepolia                                           | Development and demo                    |
| Mainnet            | Ethereum + Zama Coprocessor                                | Production deployment                   |

### 12.2 Deployment Strategy

```
Phase 1 — Development
  Network: Zama Sepolia testnet
  Token: Mock ConfidentialERC20 (mock cUSDT)
  Oracle: Mock price feeds + manual resolve

Phase 2 — Grant Demo
  Network: Zama Sepolia testnet
  Token: Mock ConfidentialERC20
  Oracle: Chainlink Sepolia feeds
  Frontend: Deployed on Vercel
  Video demo + documentation

Phase 3 — Production
  Network: Ethereum mainnet + Zama Coprocessor
  Token: Real cUSDT via Zaiffer Protocol
  Oracle: Chainlink mainnet feeds
  Frontend: Production deployment
```

### 12.3 Key Dependencies

```json
{
  "dependencies": {
    "@fhevm/solidity": "^0.10.0",
    "@chainlink/contracts": "^1.3.0",
    "@openzeppelin/contracts": "^5.2.0",
    "ethers": "^6.0.0"
  },
  "devDependencies": {
    "hardhat": "^2.22.0",
    "@fhevm/hardhat-plugin": "^0.4.0",
    "@zama-fhe/relayer-sdk": "^0.4.0"
  }
}
```

---

## 13. Development Status

### Completed (V2)

**Smart Contracts:**

- [x] `OpaqueMarket.sol` (~930 LOC) — encrypted order book, trustless matching, share minting/burning, two-step
      redemption, emergency withdrawal
- [x] `MarketFactory.sol` (~165 LOC) — factory with configurable resolver, fees, cooldowns, two-step ownership
- [x] `ConfidentialUSDT.sol` (~100 LOC) — FHE ERC20 with owner-only minting
- [x] `OracleResolver.sol` (~400 LOC) — Chainlink Tier 1, on-chain Tier 2, manual voting Tier 3, 5-min BTC auto-cycling
- [x] Deploy to Ethereum Sepolia testnet

**Testing:**

- [x] 321 tests passing (OpaqueMarket 179, MarketFactory 38, ConfidentialUSDT 14, OracleResolver 43, E2E 27, Payout 24)
- [x] Contract size: 16,369 bytes (< 24KB limit)

**Frontend:**

- [x] Market list page with best bid/ask prices
- [x] Market detail page with order book display
- [x] Trading panel (Buy YES/NO, Sell YES/NO) with FHE encryption
- [x] Share balance decryption via EIP-712 + Zama KMS
- [x] Mint/Burn shares panel
- [x] My Orders with cancel functionality
- [x] Auto-Match button (scans for crossing orders)
- [x] Redemption panel with two-step flow
- [x] Portfolio page (share balances + active orders)
- [x] Market creation form

**Scripts & Infrastructure:**

- [x] Deploy scripts for Sepolia
- [x] Matcher bot (permissionless order matcher)
- [x] Chainlink configuration script
- [x] Sample market creation script

### Next Steps (Post-MVP)

- [ ] Mainnet deployment (Ethereum + Zama Coprocessor)
- [ ] Real cUSDT integration via Zaiffer Protocol
- [ ] Mobile-responsive design polish
- [ ] Video demo (2-3 minutes)
- [ ] Liquidity provider / market maker bot
- [ ] Batch matching for gas efficiency

---

## 14. Grant Application Strategy

### 14.1 Primary Target: Zama Developer Program

**Probability:** 70-80% (strong) **Amount:** $10K-$50K **Why strong:**

1. Himess already won Zama grant for Pendex Protocol — established relationship
2. Opaque is significantly more comprehensive than Pendex
3. Solves a real, documented problem with academic research backing
4. Targets $63.5B+ market (4x growth 2024-2025)
5. Demonstrates FHE's unique capability (encrypted state + computation + ACL)
6. Zama's own token auction used sealed-bid FHE — same philosophy
7. No execution leakage (all computation stays in FHE)
8. More comprehensive than Zolymarket (encrypts direction too)

### 14.2 Grant Pitch (Draft)

> **OPAQUE V2 — Trustless FHE Prediction Markets**
>
> Polymarket did $21.5B+ volume but suffers from whale manipulation proven by Columbia University (25% fake volume), UMA
> oracle scandals ($16M+ manipulated markets), and 170+ copy-trading tools that destroy the "wisdom of the crowd."
>
> OPAQUE solves this with the world's first trustless FHE-encrypted order book. Both order **sides** (YES/NO) and
> **amounts** are encrypted. Matching is fully permissionless — anyone can call `attemptMatch()` and the caller learns
> nothing about whether the match succeeded or failed. Copy-trading and front-running become mathematically impossible.
>
> Technical highlights:
>
> - FHE.select for indistinguishable match success/failure (zero-effect transactions)
> - Encrypted order sides (euint8) + amounts (euint64) via FHE.fromExternal()
> - Permissionless matching — no trusted matcher, operator, or third party
> - Source-mandatory markets with Chainlink + on-chain oracle + manual voting
> - Two-step redemption via Zama KMS threshold decryption with on-chain proof verification
> - 321 tests, ~930 LOC core contract, 16KB compiled
>
> This is not "hidden Polymarket" — it's "more accurate Polymarket."

### 14.3 Secondary Targets

| Grant Program               | Probability | Amount              | Angle                           |
| --------------------------- | ----------- | ------------------- | ------------------------------- |
| Ethereum Foundation Privacy | 30-40%      | $20K-$100K          | FHE + prediction market privacy |
| Chainlink BUILD             | 20-30%      | Integration support | Oracle innovation               |
| Token Launch (future)       | 30-40%      | Variable            | POLY token filing precedent     |

### 14.4 VC Potential (Post-MVP)

**Pre-seed:** 15-25% probability ($200K-$500K)

- **For:** $3.71B sector investment in 2025, privacy narrative strong
- **Against:** Solo founder, Turkey location, FHE experimental

**Recommended path:** Zama grant → Working MVP → Testnet users (500+) → Metrics ($1M+ test volume) → VC conversation
becomes much stronger.

---

## 15. Frontend Specification

### 15.1 Pages

**Home / Market List**

```
┌──────────────────────────────────────────────┐
│  OPAQUE — Trustless FHE Prediction Markets    │
│                                               │
│  [Active Markets]  [Resolved]  [Create New]   │
│                                               │
│  ┌──────────────────────────────────────────┐ │
│  │ BTC > $200K by Dec 2026?                 │ │
│  │ Best Bid: $0.62  │  Best Ask: $0.65      │ │
│  │ Active Orders: 47  │  Closes: Dec 31     │ │
│  └──────────────────────────────────────────┘ │
│  ┌──────────────────────────────────────────┐ │
│  │ ETH > $10K by Q3 2026?                   │ │
│  │ Best Bid: $0.28  │  Best Ask: $0.31      │ │
│  │ Active Orders: 23  │  Closes: Sep 30     │ │
│  └──────────────────────────────────────────┘ │
└──────────────────────────────────────────────┘
```

**Market Detail Page**

```
┌──────────────────────────────────────────────┐
│  BTC > $200K by Dec 2026?                     │
│                                               │
│  ┌───────────────────┐ ┌──────────────────┐   │
│  │   ORDER BOOK       │ │  TRADING PANEL   │  │
│  │                     │ │                  │  │
│  │  ASK $0.70  ███     │ │ [Buy] [Sell]     │  │
│  │  ASK $0.68  █████   │ │                  │  │
│  │  ASK $0.65  ███████ │ │ Side: [YES/NO]   │  │
│  │  ─── spread ───     │ │ Price: [$0.60]   │  │
│  │  BID $0.62  ██████  │ │ Amount: [10]     │  │
│  │  BID $0.60  ████    │ │ Cost: ~$6.00     │  │
│  │  BID $0.55  ██      │ │ [Place Order]    │  │
│  │                     │ │                  │  │
│  │  Sizes: *** (FHE)   │ │ [Auto-Match]     │  │
│  └───────────────────┘ └──────────────────┘   │
│                                               │
│  ┌───────────────────┐ ┌──────────────────┐   │
│  │  YOUR SHARES       │ │  MINT / BURN     │  │
│  │  YES: *** (decrypt) │ │ Amount: [___]    │  │
│  │  NO:  *** (decrypt) │ │ [Mint] [Burn]    │  │
│  │  [Decrypt Balances] │ │                  │  │
│  └───────────────────┘ └──────────────────┘   │
│                                               │
│  ── Your Active Orders ──                     │
│  #42: BID $0.60 (size: ***)  [Cancel]         │
│  #47: ASK $0.68 (size: ***)  [Cancel]         │
│  [Cancel All]                                 │
│                                               │
│  ── Recent Matches ──                         │
│  Match #42 x #35 @ $0.65 — 2 min ago         │
│  Match #38 x #31 @ $0.60 — 5 min ago         │
│                                               │
│  ── Privacy Info ──                           │
│  Order sides (YES/NO): ENCRYPTED              │
│  Order amounts: ENCRYPTED                     │
│  Match results: INDISTINGUISHABLE             │
│  Only YOU can see your position               │
└──────────────────────────────────────────────┘
```

**Portfolio Page**

```
┌──────────────────────────────────────────────┐
│  My Portfolio                                 │
│                                               │
│  Share Balances (decrypt via EIP-712):        │
│  • BTC > $200K — YES: 10.00, NO: 5.00       │
│  • ETH > $10K  — YES: 0.00, NO: 20.00       │
│                                               │
│  Active Orders:                               │
│  • BTC > $200K — BID $0.60 (size: ***)       │
│  • ETH > $10K  — ASK $0.72 (size: ***)       │
│                                               │
│  Resolved (Redeem):                           │
│  • SOL > $300 — YES won, 10 shares [Redeem]  │
└──────────────────────────────────────────────┘
```

### 15.2 Client-Side Encryption Flow

```typescript
import { ZamaRelayer } from "@zama-fhe/relayer-sdk";

// Initialize FHE instance
const fhe = new ZamaRelayer({ network: "sepolia" });
await fhe.init();

// Place an order with encrypted side + encrypted amount
async function placeOrder(marketAddress: string, side: number, price: number, isBid: boolean, amount: bigint) {
  // IMPORTANT: Two separate encrypted inputs (C-FE1 fix)
  // Side and amount must use separate createEncryptedInput calls

  // Encrypt side (euint8: 0=YES, 1=NO)
  const sideInput = fhe.createEncryptedInput(marketAddress, userAddress);
  sideInput.add8(side);
  const encryptedSide = await sideInput.encrypt();

  // Encrypt amount (euint64: share count in micro-cUSDT)
  const amountInput = fhe.createEncryptedInput(marketAddress, userAddress);
  amountInput.add64(amount);
  const encryptedAmount = await amountInput.encrypt();

  // Send transaction
  const tx = await contract.placeOrder(
    encryptedSide.handles[0], // encrypted side
    price, // PUBLIC price (100-9900)
    isBid, // PUBLIC bid/ask
    encryptedAmount.handles[0], // encrypted amount
    encryptedSide.inputProof, // side proof
    encryptedAmount.inputProof, // amount proof
  );

  await tx.wait();
}

// Decrypt own share balances via EIP-712 + Zama KMS
async function viewMyShares(marketAddress: string) {
  const [yesHandle, noHandle] = await contract.getMyShares();

  // Generate keypair for KMS decryption
  const keypair = fhe.generateKeypair();
  const eip712 = fhe.createEIP712(
    keypair.publicKey,
    [marketAddress],
    Math.floor(Date.now() / 1000),
    1, // 1 day validity
  );

  // Sign with wallet (wagmi walletClient for WalletConnect compatibility)
  const signature = await walletClient.signTypedData({
    domain: eip712.domain,
    types: eip712.types,
    primaryType: eip712.primaryType,
    message: eip712.message,
  });

  // Decrypt via KMS
  const clearValues = await fhe.userDecrypt(
    [
      { handle: yesHandle, contractAddress: marketAddress },
      { handle: noHandle, contractAddress: marketAddress },
    ],
    keypair.privateKey,
    keypair.publicKey,
    signature,
    [marketAddress],
    userAddress,
    Math.floor(Date.now() / 1000),
    1,
  );

  return { yes: clearValues[yesHandle], no: clearValues[noHandle] };
}
```

---

## 16. Revenue Model

### 16.1 Fee Structure (V2)

| Fee Type            | Rate                              | Collected                      |
| ------------------- | --------------------------------- | ------------------------------ |
| Trading fee         | 0.05% per match (TRADE_FEE_BPS=5) | On each successful match       |
| Redemption fee      | 0.5% of payout (FEE_BPS=50)       | On winning share redemption    |
| Flat fee            | $1.00 per redemption              | On winning share redemption    |
| Market creation fee | Configurable (default 10 cUSDT)   | On market creation via factory |

### 16.2 Revenue Projections

Assuming 1% of Polymarket's volume ($21.5B → $215M) at 1.5% average fee:

- **Annual revenue potential:** $3.2M
- **Conservative (0.1% of Polymarket):** $322K

### 16.3 Token Potential (V2)

Polymarket filed POLY token trademark in February 2026. Prediction market tokens are trending. A governance/utility
token for Opaque could:

- Govern market creation/curation
- Stake for oracle resolution rights
- Fee sharing with token holders

---

## 17. Risk Assessment

### 17.1 Technical Risks

| Risk                  | Severity | Mitigation                                                                           |
| --------------------- | -------- | ------------------------------------------------------------------------------------ |
| FHE computation cost  | Medium   | Zama's coprocessor handles heavy lifting; $0.13/tx on mainnet                        |
| FHE latency           | Medium   | Async redemption via KMS; two-step UX flow                                           |
| Zama network downtime | High     | Emergency withdrawal after 7-day grace period; manual resolution fallback            |
| Smart contract bugs   | High     | 321 tests, testnet-first, custom errors, ReentrancyGuard                             |
| Contract size limit   | Medium   | Currently 16KB (< 24KB). Optimizer runs=800, viaIR=true                              |
| matchOrders gas (~5M) | Medium   | Testnet OK; mainnet batch matching planned                                           |
| FHE.div not available | Low      | Use `transferFromChecked` binary result + `FHE.select`                               |
| Order deactivation    | Low      | `filledSize` encrypted — off-chain tracking + `cancelOrder` returns remaining escrow |

### 17.2 Market Risks

| Risk                    | Severity | Mitigation                                             |
| ----------------------- | -------- | ------------------------------------------------------ |
| Low initial liquidity   | High     | Whale outreach, incentivized early markets             |
| Regulatory crackdown    | Medium   | Privacy by default; no KYC requirement is feature      |
| Polymarket adds privacy | Low      | FHE integration is complex; significant lead time      |
| Zolymarket improves     | Medium   | Already ahead (direction encryption); faster execution |

### 17.3 Operational Risks

| Risk            | Severity | Mitigation                                                    |
| --------------- | -------- | ------------------------------------------------------------- |
| Solo founder    | High     | Build community, attract contributors via open source         |
| Grant rejection | Medium   | Multiple grant applications; self-funded MVP possible         |
| Oracle failure  | Medium   | Multi-source oracle; manual fallback; source-mandatory design |

---

## Appendix A: Key Design Decisions Log

| Decision             | Options Considered                          | Chosen                                                      | Rationale                                                                       |
| -------------------- | ------------------------------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Price visibility     | A) All hidden, B) Public prices             | B) Public prices                                            | Users need risk/reward; privacy on side+amount sufficient                       |
| Direction encryption | Amount only vs Amount+Direction             | Amount+Direction (V2)                                       | Direction alone enables copy-trading (Zolymarket's weakness)                    |
| Price discovery      | LMSR vs CLOB vs FHE Order Book              | FHE Order Book (V2)                                         | More capital-efficient, matches real prediction markets, no LMSR formula needed |
| Matching             | Trusted matcher vs Permissionless           | Permissionless (V2)                                         | FHE.select makes failed matches indistinguishable; no trust needed              |
| Token                | Custom token vs cUSDT                       | Custom ConfidentialUSDT (testnet), cUSDT (mainnet)          | Testnet flexibility; mainnet uses Zaiffer Protocol                              |
| Oracle approach      | UMA vs Chainlink vs Custom                  | Source-mandatory + multi-tier (Chainlink, on-chain, manual) | Prevents 90% of oracle scandals; Chainlink battle-tested                        |
| Trust model          | Full ZK vs KMS threshold decryption         | KMS + on-chain proof verification                           | Pragmatic; KMS proof sufficient for redemption integrity                        |
| Redemption           | Pool-based payout vs Share-based redemption | Share-based ($1.00 per winning share)                       | Simpler, fully collateralized, no proportional calculation needed               |
| Project name         | SealedMarket, VeilMarket, Umbra, Opaque     | OPAQUE                                                      | Describes core concept perfectly; no conflicts; memorable                       |

## Appendix B: Research References

- Columbia University: Polymarket wash trading analysis (~25% fake volume)
- Polymarket UFO market scandal ($16M, Dec 2025)
- Polymarket Ukraine mineral deal ($7M, March 2025)
- Nobel Prize insider trading investigation (Norwegian authorities)
- PredictIt vs Polymarket accuracy comparison
- Zama mainnet launch (Dec 30, 2025) — cUSDT, Zaiffer, KMS
- Zama fhEVM documentation and ERC-7984 standard
- LMSR (Hanson, 2003) — Logarithmic Market Scoring Rule
- Polymarket whale tracking ecosystem (170+ tools)
- Stand.trade, PolyTrack, Polywhaler — copy-trading platforms

## Appendix C: Glossary

| Term                   | Definition                                                                  |
| ---------------------- | --------------------------------------------------------------------------- |
| **FHE**                | Fully Homomorphic Encryption — compute on encrypted data without decrypting |
| **fhEVM**              | Zama's FHE-enabled EVM — Solidity + encrypted types                         |
| **FHE.sol**            | Zama's Solidity library (`@fhevm/solidity@0.10`) — replaces legacy TFHE.sol |
| **ZamaEthereumConfig** | Base config contract all FHE contracts must inherit                         |
| **euint8**             | Encrypted unsigned 8-bit integer (used for order side: 0=YES, 1=NO)         |
| **euint64**            | Encrypted unsigned 64-bit integer (used for amounts, balances)              |
| **ebool**              | Encrypted boolean (used for FHE comparisons)                                |
| **FHE.select**         | Encrypted conditional — `select(cond, a, b)` returns a if true, b if false  |
| **FHE.fromExternal**   | Validate encrypted inputs with ZKPoK proof (`externalEuint8/64`)            |
| **cUSDT**              | Confidential USDT — encrypted USDT (Zaiffer on mainnet, custom on testnet)  |
| **KMS**                | Key Management System — Zama's threshold decryption service (13 MPC nodes)  |
| **EIP-712**            | Typed data signing standard — used for KMS user decryption authorization    |
| **userDecrypt**        | Client-side decryption via Zama KMS with EIP-712 signature                  |
| **publicDecrypt**      | Public decryption via Zama KMS for redemption amounts                       |
| **attemptMatch**       | Core V2 function — permissionless, trustless order matching                 |
| **Dark Pool**          | Trading venue where order details are hidden until execution                |
| **CLOB**               | Central Limit Order Book                                                    |
| **Coprocessor**        | Zama's off-chain FHE computation nodes                                      |
| **SHARE_UNIT**         | 1,000,000 micro-cUSDT = $1.00 per share                                     |
| **BPS**                | Basis points — 10,000 = 100%. Price range: 100-9900 ($0.01-$0.99)           |

---

_Document prepared for Zama Developer Program grant application. V2 architecture implemented and deployed on Ethereum
Sepolia._
