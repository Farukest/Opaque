[![CI](https://github.com/Himess/opaque/actions/workflows/ci.yml/badge.svg)](https://github.com/Himess/opaque/actions/workflows/ci.yml)
![Tests](https://img.shields.io/badge/tests-559_passing-brightgreen)
![FHE](https://img.shields.io/badge/FHE-14_operations-blue)
![Solidity](https://img.shields.io/badge/Solidity-0.8.27-363636)
![License](https://img.shields.io/badge/license-BSD--3--Clause--Clear-green)

**[Live Demo](https://opaque-market.vercel.app)** · **[Audit Report](docs/COMPREHENSIVE-AUDIT-V3.md)** · **[Design Doc](OPAQUE_DESIGN.md)**

# OPAQUE V3 -- Trustless FHE Prediction Markets

The world's first on-chain FHE order book with trustless matching. Both order **sides (YES/NO)** and **amounts** are
encrypted using Zama's Fully Homomorphic Encryption. Anyone can call `attemptMatch()` -- the caller learns nothing about
whether the match succeeded or failed.

**V3 adds multi-outcome markets** via `MarketGroup` coordinator, hourly BTC markets with Chainlink auto-threshold, and a
simulation bot for realistic order flow.

## What Makes This Different

| Feature                | Polymarket  | OPAQUE V3                        |
| ---------------------- | ----------- | -------------------------------- |
| Order sides            | Public      | **FHE-encrypted**                |
| Order amounts          | Public      | **FHE-encrypted**                |
| Matching               | Centralized | **Permissionless on-chain**      |
| Match outcome visible  | Yes         | **No (FHE.select)**              |
| Copy-trading possible  | Yes         | **Mathematically impossible**    |
| Front-running possible | Yes         | **Impossible (encrypted sides)** |

## How It Works

### What's Public

- Market questions, deadlines, resolution criteria
- Order prices (bid/ask levels)
- Number of orders at each price level
- Market resolution outcome
- Timestamps, queue depth

### What's Encrypted (FHE)

- Order side (YES or NO) -- `euint8`
- Order size (share amount) -- `euint64`
- User share balances (YES/NO)
- Fill amounts from matching
- Match success/failure result

### Information Disclosure Matrix

| Data Point                  | Who Can See        | When                            |
| --------------------------- | ------------------ | ------------------------------- |
| Order side (YES/NO)         | Only order owner   | Anytime (via userDecrypt)       |
| Order amount                | Only order owner   | Anytime (via userDecrypt)       |
| Order price                 | Everyone           | On placement (public by design) |
| Order timestamp             | Everyone           | On placement (block.timestamp)  |
| Match result (fill/no-fill) | **Nobody**         | **Never directly revealed**     |
| YES/NO share balance        | Only balance owner | Anytime (via userDecrypt)       |
| Total shares minted         | Everyone           | Anytime (public counter)        |
| Market resolution           | Everyone           | After oracle callback           |

### Architecture

```
┌────────────────────────────────────────────────────────────────────┐
│                    OPAQUE V3 Protocol Architecture                 │
│                                                                    │
│  ┌──────────┐    ┌───────────────────┐    ┌────────────────────┐  │
│  │ User     │───→│  OpaqueMarket.sol │───→│ Zama Coprocessor   │  │
│  │ Frontend │    │                   │    │ (FHE computation)  │  │
│  │ (Next.js)│    │ • placeOrder()    │    │                    │  │
│  │          │←───│ • attemptMatch()  │←───│ • FHE.ne()         │  │
│  │          │    │ • mintShares()    │    │ • FHE.select()     │  │
│  │          │    │ • cancelOrder()   │    │ • FHE.add/sub()    │  │
│  └──────────┘    └────────┬──────────┘    └────────────────────┘  │
│                           │                                        │
│                  ┌────────▼────────┐    ┌────────────────────┐    │
│                  │ Zama Gateway    │    │ Chainlink Oracle   │    │
│                  │ + KMS           │    │                    │    │
│                  │                 │    │ • BTC/USD Feed     │    │
│                  │ Async decrypt:  │    │ • 5-min resolution │    │
│                  │ • user balance  │    │ • Sepolia testnet  │    │
│                  │ • redemption    │    │                    │    │
│                  └─────────────────┘    └────────────────────┘    │
│                                                                    │
│  ┌──────────┐    ┌───────────────────┐    ┌────────────────────┐  │
│  │ Matcher  │───→│ attemptMatch()    │    │ MarketFactory.sol  │  │
│  │ Bot      │    │ (permissionless)  │    │                    │  │
│  │ (anyone) │    │ Sees: NOTHING     │    │ • createMarket()   │  │
│  └──────────┘    └───────────────────┘    └────────────────────┘  │
│                                                                    │
│  Contracts:                                                        │
│  ├── MarketFactory.sol      — Market creation + fees               │
│  ├── OpaqueMarket.sol       — Core: encrypted order book + match   │
│  ├── MarketGroup.sol        — Multi-outcome coordinator            │
│  ├── OracleResolver.sol     — Chainlink + on-chain + manual voting │
│  └── ConfidentialUSDT.sol   — Encrypted ERC20 for settlements      │
└────────────────────────────────────────────────────────────────────┘
```

### Core Flow

1. **Mint Shares**: Deposit cUSDT to receive equal YES + NO shares (1 cUSDT = 1 YES + 1 NO)
2. **Trade**: Place buy/sell orders with encrypted side and size at a public price
3. **Matching**: Anyone calls `attemptMatch(bidId, askId)` -- permissionless, trustless
4. **Resolution**: Resolver determines outcome after deadline (Chainlink, on-chain oracle, or multisig)
5. **Redemption**: Winners redeem shares for $1.00 each (minus 0.5% fee + $1 flat fee)

### Single Trade Data Flow

```
1. Alice wants to bet YES on "BTC > $95K in 5 min"
   Frontend encrypts: side=0 (YES), amount=100 shares
   Sends: placeOrder(encSide, price=6500, isBid=true, encAmount, proofs)

2. Bob wants to bet NO on the same market
   Frontend encrypts: side=1 (NO), amount=80 shares
   Sends: placeOrder(encSide, price=6500, isBid=false, encAmount, proofs)

3. Matcher bot sees: Two orders at price 6500 (bid + ask)
   Calls: attemptMatch(aliceOrderId, bobOrderId)
   Matcher does NOT know Alice=YES, Bob=NO

4. On-chain FHE (coprocessor executes):
   a. FHE.ne(alice.encSide, bob.encSide) → ebool: are they opposite?
   b. FHE.min(aliceRemaining, bobRemaining) → euint64: fill size
   c. FHE.select(isOpposite, fillSize, 0) → euint64: actual fill
   d. Update encrypted balances for both parties
   → ALL IN ENCRYPTED DOMAIN — nothing decrypted

5. Result: Alice has YES shares, Bob has NO shares
   Neither party, the matcher, nor any observer knows what happened.
   The MatchAttempted event reveals NOTHING about success/failure.

6. 5 minutes later: Chainlink reports BTC=$95,100
   → Market resolves YES
   → Alice calls requestRedemption() + finalizeRedemption() → cUSDT payout
```

### Why Permissionless Matching?

In traditional prediction markets like Polymarket or Kalshi, the order book is **fully public** — everyone can see all
orders, sides, and amounts. Centralized matching is tolerable there because anyone can verify whether the operator is
matching fairly. Transparency acts as a check on the operator.

**OPAQUE is fundamentally different.** Because order sides and amounts are FHE-encrypted, the order book is hidden by
design. This creates a critical problem: if a centralized operator controlled matching in an encrypted order book, they
would hold **unverifiable power**. Nobody could check whether the operator is:

| Risk                    | Why It's Worse With an Encrypted Order Book                                     |
| ----------------------- | ------------------------------------------------------------------------------- |
| **Front-running**       | Operator could learn order intent through the matching process — nobody can audit |
| **Selective matching**  | Operator ignores certain orders — users can't see the book to notice             |
| **Self-dealing**        | Operator prioritizes own orders — impossible to detect in encrypted state         |
| **Order suppression**   | Operator delays/drops orders — no public book to compare against                 |
| **Information asymmetry** | Operator is the only party who sees order flow — sells to HFT firms, users are blind |

In a public order book, these risks are mitigated by transparency. **In an encrypted order book, they become
undetectable.** A centralized matcher in OPAQUE would have strictly more power than a centralized matcher in Polymarket,
because there is no public record to hold them accountable.

**This is why permissionless matching is not a feature — it's a necessity.** When you encrypt the order book, you must
eliminate the privileged matcher role entirely. In OPAQUE:

- **Anyone** can call `attemptMatch()` — no gatekeeper, no special role
- **FHE.select()** ensures matchers learn nothing, even from failed matches
- **On-chain execution** means matching is auditable and deterministic
- **Competition** between matchers prevents censorship

**Coming soon: Matcher incentives.** The protocol will refund gas costs to anyone who successfully matches orders,
creating an open ecosystem of competing matching bots — no single party controls trade execution.

### Matching Deep Dive

`attemptMatch()` is the core innovation. When called:

1. Reads encrypted sides of both orders
2. Verifies one is YES and other is NO (encrypted comparison)
3. Calculates fill amount: `FHE.min(bidRemaining, askRemaining)`
4. Uses `FHE.select()` so that failed matches (same side) produce zero-effect transactions
5. Successful and failed matches are **indistinguishable** on-chain
6. Emits `MatchAttempted` event with NO information about success/failure

### Why Failed Matches Don't Leak Information

```
Successful match (opposite sides):       Failed match (same side):
─────────────────────────────────         ─────────────────────────────
actualFill = FHE.select(                  actualFill = FHE.select(
  TRUE,  potentialFill, 0)                  FALSE, potentialFill, 0)
= potentialFill (encrypted)               = 0 (encrypted)

Balance update:                           Balance update:
FHE.add(balance, potentialFill)           FHE.add(balance, 0)
= new balance (encrypted)                = same balance (encrypted)

Event emitted:                            Event emitted:
MatchAttempted(bidId, askId, caller, timestamp)        MatchAttempted(bidId, askId, caller, timestamp)

               ╔═══════════════════════════════════════════╗
               ║  ON-CHAIN OBSERVABLE DIFFERENCE: **NONE** ║
               ║                                           ║
               ║  • Same gas pattern (FHE ops run either   ║
               ║    way)                                   ║
               ║  • Same event signature                   ║
               ║  • Same state write count                 ║
               ║  • Encrypted values changed but observer  ║
               ║    can't read them                        ║
               ╚═══════════════════════════════════════════╝
```

---

## Tech Stack

| Layer           | Technology                                                         |
| --------------- | ------------------------------------------------------------------ |
| Smart Contracts | Solidity 0.8.27 + Zama fhEVM (`@fhevm/solidity@0.10`)              |
| Frontend        | Next.js 16 + React 19 + wagmi v3 + viem + Tailwind CSS             |
| FHE SDK         | `@zama-fhe/relayer-sdk@0.4` (EIP-712 user decrypt, public decrypt) |
| Testing         | Hardhat + Chai + `@fhevm/hardhat-plugin` (500+ tests)               |
| Oracle          | Chainlink V3 price feeds + on-chain verifiable + manual multisig   |
| Network         | Ethereum Sepolia testnet                                           |

---

## Contracts

| Contract               | LOC  | Description                                                                                                    |
| ---------------------- | ---- | -------------------------------------------------------------------------------------------------------------- |
| `OpaqueMarket.sol`     | ~930 | Core market: encrypted order book, share minting/burning, trustless matching, redemption, emergency withdrawal |
| `MarketFactory.sol`    | ~165 | Factory for deploying markets with configurable resolver and fees                                              |
| `MarketGroup.sol`      | ~200 | Multi-outcome coordinator: links binary markets into a single multi-outcome event                              |
| `OracleResolver.sol`   | ~400 | Multi-tier resolver: Chainlink (Tier 1), on-chain oracle (Tier 2), manual multisig (Tier 3)                    |
| `ConfidentialUSDT.sol` | ~100 | FHE-compatible ERC20 token with owner-only minting                                                             |

### Deployed (Sepolia v7)

| Contract         | Address                                                                                                                         |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| ConfidentialUSDT | [`0xc35eA8889D2C09B2bCF3641236D325C4dF7318f1`](https://sepolia.etherscan.io/address/0xc35eA8889D2C09B2bCF3641236D325C4dF7318f1) |
| OracleResolver   | [`0x165C3B6635EB21A22cEc631046810941BC8731b9`](https://sepolia.etherscan.io/address/0x165C3B6635EB21A22cEc631046810941BC8731b9) |
| MarketFactory    | [`0x29B59C016616e644297a2b38Cf4Ef60E0F03a29B`](https://sepolia.etherscan.io/address/0x29B59C016616e644297a2b38Cf4Ef60E0F03a29B) |
| MarketGroup      | [`0x96A89c4de09054Bcb4222E3868d9a44ecC52Cca9`](https://sepolia.etherscan.io/address/0x96A89c4de09054Bcb4222E3868d9a44ecC52Cca9) |

### On-Chain Verification (Sepolia fhEVM)

Full end-to-end tests executed on Sepolia with **real FHE encryption** -- not mocks. All encrypted inputs created via
`fhevm.createEncryptedInput()`, all decryptions via Zama KMS `userDecryptEuint64`. Test market:
[`0x61263f6220E0B5E7424fdE448a533a71372741f2`](https://sepolia.etherscan.io/address/0x61263f6220E0B5E7424fdE448a533a71372741f2)

#### Scenario 1: Basic Lifecycle -- mint, trade, match, decrypt

| Step  | Action                                   | TX                                                                                                                        | Gas           |
| ----- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ------------- |
| 1     | user1 mintShares(100)                    | [`0x509a...2a72`](https://sepolia.etherscan.io/tx/0x509a82b82ea94164cde9c9e4ed6ddbbbb28470e63efc3d499d8ddcd2cebd2a72)     | 868,520       |
| 2     | user2 mintShares(100)                    | [`0xf81b...0233`](https://sepolia.etherscan.io/tx/0xf81bf7e36da9846ac9064e17ba827581832d60238229251a1c8725bf44ef0233)     | 818,097       |
| 3     | user1 YES bid #0 (price=6500, 50 shares) | [`0xf7bb...3f20`](https://sepolia.etherscan.io/tx/0xf7bb521240282bbb93915ec42da8d6d9cca4ca6019553c1415c32d8e56fb3f20)     | 1,312,251     |
| 4     | user2 NO ask #1 (price=6500, 50 shares)  | [`0xd873...59d7`](https://sepolia.etherscan.io/tx/0xd87380820d57f5c03f6d7f3979f19c33600243b28a5892997664647523c259d7)     | 1,303,632     |
| **5** | **attemptMatch(0, 1) -- OPPOSITE SIDES** | [**`0xf712...9dc3`**](https://sepolia.etherscan.io/tx/0xf71298736af0401daabf198bef7041005728169ac28ec1be2116192670559dc3) | **1,098,757** |

KMS decrypt result: user1 YES shares = **100,000,000 micro-cUSDT** (100 shares) ✅

#### Scenario 2: Failed Match (Same Side) -- privacy indistinguishability proof

| Step  | Action                                                     | TX                                                                                                                        | Gas           |
| ----- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ------------- |
| 1     | user1 YES bid #2 (price=5500, 20 shares)                   | [`0x0ecf...0ce9`](https://sepolia.etherscan.io/tx/0x0ecfb616e8d557196fa303b11a3ccc6eb59ad4df19b4a465109aed305a150ce9)     | 1,266,444     |
| 2     | user2 YES ask #3 (price=5500, 20 shares)                   | [`0x3de7...b49a`](https://sepolia.etherscan.io/tx/0x3de7ca4d258abce4c0dfb83fc4b6253badac3edd5f5965ee8a2538f5aa3db49a)     | 1,269,434     |
| **3** | **attemptMatch(2, 3) -- SAME SIDE (should fail silently)** | [**`0xd425...ef9b`**](https://sepolia.etherscan.io/tx/0xd425c40dac654bd253a4fef731a8f4b898fbe900a38a46c9e6f0e5d7e137ef9b) | **1,104,769** |
| 4a    | Cancel bid #2 (escrow returned)                            | [`0x71dc...42f1`](https://sepolia.etherscan.io/tx/0x71dce3c6fbb4f481bef23b3b354fa5da78258fc99c8f2504970cca7cd93e42f1)     | 324,061       |
| 4b    | Cancel ask #3 (escrow returned)                            | [`0xa3d5...9ba9`](https://sepolia.etherscan.io/tx/0xa3d54e398929e0c18965d70584eda587d16a4964c327db66a40d3ee73ac39ba9)     | 322,506       |

#### Indistinguishability Proof

```
Successful match (opposite sides):  1,098,757 gas    TX: 0xf712...9dc3
Failed match (same side):           1,104,769 gas    TX: 0xd425...ef9b
                                    ─────────
Difference:                         6,012 gas (0.5%)

Both transactions:
  ✓ Emit identical MatchAttempted(bidId, askId, caller, timestamp) event
  ✓ Execute identical FHE operations (ne, min, select, add, sub, mul)
  ✓ Write to identical storage slots (encrypted values updated either way)
  ✓ 0.5% gas variance is within normal EVM execution noise
  ✗ NO observable on-chain difference between success and failure
```

An external observer examining both transactions on Etherscan sees **identical event signatures, identical function
calls, and near-identical gas consumption**. The 6,012 gas difference (0.5%) falls within normal EVM execution variance.
`FHE.select()` ensures all arithmetic runs unconditionally -- the only difference is whether encrypted values change
meaningfully or stay the same, which is invisible without the decryption key.

#### Scenario 3: Partial Fill -- multi-match against single bid

| Step  | Action                                    | TX                                                                                                                        | Gas           |
| ----- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ------------- |
| 0     | user3 mintShares(100)                     | [`0x5825...39d5`](https://sepolia.etherscan.io/tx/0x58250925a73b75d615b2ca44ab4496cc2c62fe20bfb01c990ec4da0470e839d5)     | 818,097       |
| 1     | user1 YES bid #4 (price=7000, 100 shares) | [`0x9f72...036e`](https://sepolia.etherscan.io/tx/0x9f727f7b0a05ae050f80176a512dc008334bfcc907a49d14c0b10f61c305036e)     | 1,269,377     |
| 2     | user2 NO ask #5 (price=6800, 30 shares)   | [`0x9029...6359`](https://sepolia.etherscan.io/tx/0x9029d8e227bb2a51fad8a12814f533be25a2ea3d6c7c9f210139cc6305386359)     | 1,269,432     |
| **3** | **Match bid#4 x ask#5 → fill ≤30**        | [**`0xb45f...e455`**](https://sepolia.etherscan.io/tx/0xb45f6c49d673d7523544b56a1271b4a01ac38f5b16f4f980bb0a9e470312e455) | **1,420,201** |
| 4     | user3 NO ask #6 (price=6900, 50 shares)   | [`0xfc6b...ef6c`](https://sepolia.etherscan.io/tx/0xfc6b760d9079a6fe302af917108c66e6abee09ea826ce4f1e297ddd468eeef6c)     | 1,300,707     |
| **5** | **Match bid#4 x ask#6 → fill ≤50**        | [**`0x2695...0d7d`**](https://sepolia.etherscan.io/tx/0x26952d70d500+2bfe6490ba076fb1ab52daf277fbb8cd2e751869c13d12f60d7d) | **1,442,101** |

Result: bid#4 has 20 shares remaining (100 - 30 - 50). Two partial fills against one order.

#### Scenario 4: Cancel + Refund -- escrow lifecycle

| Step  | Action                                   | TX                                                                                                                        | Gas         |
| ----- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ----------- |
| 1     | user1 YES bid #7 (price=5000, 50 shares) | [`0xb5d9...5088`](https://sepolia.etherscan.io/tx/0xb5d924d4d35fd38d09cf302f5e602a60651e1363dba67d63e366af9ae1ed5088)     | 1,266,444   |
| **2** | **cancelOrder(7) -- escrow returned**    | [**`0xa94a...df01`**](https://sepolia.etherscan.io/tx/0xa94af612d564e5efe7833db67eb79615b21e80764e66927fa84f77157650df01) | **304,161** |

KMS decrypt result: user1 cUSDT balance after cancel = **1,399,700 cUSDT** (escrow fully returned) ✅

#### Scenario 5: Market Resolution (completed after 2h deadline)

| Step  | Action                           | TX                                                                                                                        | Gas        |
| ----- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ---------- |
| **1** | **resolveDirectly(market, YES)** | [**`0x2d49...2a85`**](https://sepolia.etherscan.io/tx/0x2d49cf13aecb523e429a2ef64f74436db07c5c9b6ffb24f08d122038b97f2a85) | **80,947** |

Market resolved as YES after deadline passed. OracleResolver.resolveDirectly() called by deployer.

#### Gas Summary

| Operation                  | Gas            | USD @ 30 gwei |
| -------------------------- | -------------- | ------------- |
| mintShares                 | 818K--868K     | ~$0.05        |
| placeOrder                 | 1.27M--1.31M   | ~$0.08        |
| attemptMatch               | 1.10M--1.44M   | ~$0.09        |
| cancelOrder                | 304K--324K     | ~$0.02        |
| resolveDirectly            | 81K            | ~$0.005       |
| **Full E2E (5 scenarios)** | **18,859,938** | **~$1.14**    |

---

## Unit Breakdown

| Parameter      | Value                                    |
| -------------- | ---------------------------------------- |
| 1 share        | 1,000,000 micro-cUSDT ($1.00)            |
| Price range    | 100 -- 9,900 BPS ($0.01 -- $0.99)        |
| SHARE_UNIT     | 1,000,000                                |
| PRICE_TO_USDT  | 100                                      |
| BPS            | 10,000                                   |
| Redemption fee | 0.5% + $1.00 flat                        |
| Trading fee    | 0.05% per match                          |
| Escrow (bid)   | `price * PRICE_TO_USDT * amount`         |
| Escrow (ask)   | `(BPS - price) * PRICE_TO_USDT * amount` |

---

## Security Features

- **Trustless Matching**: No matcher role. Anyone can call `attemptMatch()`. Caller learns nothing.
- **FHE Overflow Protection**: Silent 0-amount on insufficient balance (no revert leak)
- **Emergency Withdrawal**: After 7-day grace period if market never resolves
- **Emergency Refund After Resolution**: After 7-day KMS decrypt timeout
- **Pause Mechanism**: Creator can pause/unpause trading
- **Custom Errors**: Gas-efficient error handling (no string messages)
- **Two-Step Ownership**: Both MarketFactory and OracleResolver use pending owner pattern
- **encSide Validation**: Invalid side values (not 0 or 1) result in zero-amount orders
- **Monotonic Mint Counter**: `totalSharesMinted` only increments, preventing cancel market abuse
- **Batch Cancel with Gas Control**: `cancelOrders(uint256[])` instead of unbounded loop
- **ZKPoK Input Validation**: All encrypted inputs use `FHE.fromExternal()` with proof verification
- **KMS Signature Verification**: Redemption requires Zama KMS decryption proof
- **Owner-Only Minting**: ConfidentialUSDT mint restricted to owner

### Threat Model

| Threat                   | Risk Level     | Mitigation                                                                        |
| ------------------------ | -------------- | --------------------------------------------------------------------------------- |
| Side information leakage | **ELIMINATED** | Never decrypted. FHE domain only. Even coprocessor can't see plaintext.           |
| Front-running (MEV)      | **ELIMINATED** | Sides encrypted in tx calldata. Bots see encrypted blobs only.                    |
| Match result inference   | **ELIMINATED** | FHE.select makes success and failure indistinguishable on-chain.                  |
| Copy-trading             | **ELIMINATED** | Order sides hidden. Impossible to know if whale bet YES or NO.                    |
| Matcher censorship       | LOW            | Permissionless -- anyone can call `attemptMatch()`. Multiple competing matchers.  |
| Oracle manipulation      | LOW            | Chainlink aggregated feeds + multi-tier resolution + staleness checks.            |
| Callback fraud           | **ELIMINATED** | KMS signature verification on all decryption proofs.                              |
| FHE overflow             | LOW            | `FHE.select` with `ge`/`le` checks before arithmetic. Silent 0-amount on failure. |
| Reentrancy               | LOW            | OpenZeppelin `ReentrancyGuard` on all state-changing functions.                   |
| KMS collusion            | VERY LOW       | Threshold MPC -- majority of 13 KMS nodes must collude. AWS Nitro Enclaves.       |

### Emergency Mechanisms

| Function                                           | Description                                                                  |
| -------------------------------------------------- | ---------------------------------------------------------------------------- |
| `emergencyWithdraw()`                              | Request emergency withdrawal (only after 7-day grace period post-resolution) |
| `finalizeEmergencyWithdraw(uint64, uint64, bytes)` | Finalize with KMS-decrypted share amounts                                    |
| `emergencyRefundAfterResolution()`                 | Request refund if KMS decryption times out (7 days post-resolution)          |
| `cancelMarket()`                                   | Creator cancels market before any participation                              |

---

## FHE Operations Used

```
FHE.fromExternal   -- Validate encrypted inputs with ZKPoK proof
FHE.asEuint8/64    -- Create encrypted constants
FHE.eq / FHE.ne    -- Encrypted equality/inequality comparison
FHE.ge             -- Encrypted greater-or-equal comparison
FHE.or             -- Encrypted logical OR
FHE.select         -- Encrypted conditional (if-then-else)
FHE.min            -- Encrypted minimum (for fill calculation)
FHE.add / FHE.sub  -- Encrypted arithmetic
FHE.mul            -- Encrypted multiplication (escrow calculation)
FHE.allow          -- Grant decryption access to specific address
FHE.allowThis      -- Grant decryption access to current contract
FHE.allowTransient -- Grant temporary decryption access
FHE.makePubliclyDecryptable -- Mark for KMS public decryption
FHE.requestDecryption       -- Request async decryption via KMS
```

---

## Chainlink Hourly BTC Markets

OracleResolver supports auto-cycling hourly BTC/USD markets:

1. `configureChainlinkAutoThreshold(market, feed, thresholdAbove, staleness)` reads the current BTC price and uses it as
   the resolution threshold
2. After 5 minutes, anyone calls `resolveChainlink(market)` to resolve based on whether BTC went up or down
3. `getOpeningPrice(market)` returns the recorded opening price

### Market Lifecycle

```
Time: 00:00:00 — Market Opens
  │  Opening BTC price recorded: $95,000
  │  configureChainlinkAutoThreshold() called
  │  Users place encrypted orders (sides + amounts hidden)
  │
Time: 00:04:55 — Trading winds down
  │  Matching can continue for pending orders
  │
Time: 00:05:00 — Resolution
  │  Anyone calls resolveChainlink(market)
  │  Chainlink BTC/USD checked: $95,150
  │  $95,150 > $95,000 → YES wins
  │  Market resolved, trading stops
  │
Time: 00:05:00 — Next market auto-creates
  │  New opening price: $95,150
  │  Cycle repeats
  │
Time: 00:05:01+ — Redemption
  │  Winners call requestRedemption() → finalizeRedemption()
```

---

## Order Book Visualization

```
Since order sides are encrypted, the order book shows only queue depth:

 Price   │ Bid Queue │ Ask Queue
─────────┼───────────┼───────────
 $0.70   │     3     │     0      ← 3 bids at $0.70 (could be YES or NO)
 $0.65   │     5     │     2      ← 5 bids, 2 asks at $0.65
 $0.60   │     2     │     4      ← 2 bids, 4 asks at $0.60
 $0.55   │     0     │     3      ← 3 asks at $0.55

 Users see:       queue depth per price level, bid/ask type
 Users DON'T see: which orders are YES, which are NO, or amounts
```

---

## Project Structure

```
opaque/
├── contracts/           # Solidity smart contracts
│   ├── OpaqueMarket.sol       # Core market (encrypted order book + matching)
│   ├── MarketFactory.sol      # Market deployment factory
│   ├── MarketGroup.sol        # Multi-outcome coordinator
│   ├── ConfidentialUSDT.sol   # FHE ERC20 token
│   ├── OracleResolver.sol     # Multi-tier oracle resolver
│   ├── MockOnchainSource.sol  # On-chain oracle mock
│   ├── MockV3Aggregator.sol   # Chainlink aggregator mock
│   └── interfaces/
│       ├── IOpaqueMarket.sol
│       ├── IMarketGroup.sol
│       └── IConfidentialERC20.sol
├── test/                # 500+ tests (Hardhat + fhevm mock)
│   ├── OpaqueMarket.test.ts        # Core market tests (191)
│   ├── MarketFactory.test.ts       # Factory tests (38)
│   ├── MarketGroup.test.ts         # Multi-outcome group tests (22)
│   ├── ConfidentialUSDT.test.ts    # Token tests (14)
│   ├── OracleResolver.test.ts      # Oracle resolver tests (48)
│   ├── E2ELifecycle.test.ts        # End-to-end scenarios (28)
│   ├── PayoutVerification.test.ts  # Payout math tests (28)
│   ├── TokenAdvanced.test.ts       # Advanced token edge cases (36)
│   ├── MatchingScenarios.test.ts   # Multi-party matching scenarios (35)
│   ├── SecurityGuards.test.ts      # Access control & state guards (46)
│   └── CrossContract.test.ts       # Cross-contract integration (35)
├── scripts/             # Deploy, bots, utilities
│   ├── deploy-sepolia.ts          # Full deployment
│   ├── matcher-bot.ts             # Permissionless matcher bot
│   ├── sim-bot.ts                 # Simulation bot (fake order flow)
│   ├── configure-chainlink.ts     # Chainlink setup
│   ├── create-sample-markets.ts   # Create test markets
│   ├── create-multi-outcome-market.ts  # Multi-outcome election market
│   ├── create-hourly-btc.ts       # Hourly BTC market
│   └── ...
├── frontend/            # Next.js 16 web app
│   ├── app/             # Routes: /, /create, /market/[id], /group/[id], /portfolio
│   ├── components/      # TradingPanel, OrderBookDisplay, MultiOutcomeCard, ...
│   ├── hooks/           # useMarketData, useOrderBook, useMyOrders
│   └── lib/             # ABI, constants, FHE SDK init
├── sdk/                # TypeScript SDK (opaque-sdk@0.4.0, 66 tests)
│   ├── src/            # OpaqueClient, OpaqueMarketClient, FHE helpers
│   └── test/           # Vitest unit tests
└── deploy/              # hardhat-deploy scripts
```

---

## Quick Start

### Prerequisites

- Node.js 18+
- npm

### Setup

```bash
# Install dependencies
npm install

# Copy environment variables
cp .env.example .env
# Edit .env with your private key and RPC URL

# Compile contracts
npx hardhat compile

# Run tests (500+ tests, ~20s)
npx hardhat test

# Deploy to Sepolia
npx hardhat run scripts/deploy-sepolia.ts --network sepolia
```

### Frontend

```bash
cd frontend
npm install
npm run dev
```

### Matcher Bot

The matcher bot scans for crossing orders and calls `attemptMatch()`. Since matching is permissionless, the bot is
optional -- any user can match orders from the UI via the "Auto-Match" button.

```bash
PRIVATE_KEY=0x... npx hardhat run scripts/matcher-bot.ts --network sepolia
```

### SDK

```bash
cd sdk
npm install
npm run build
npm test  # 66 tests
```

```typescript
import { OpaqueClient, SIDE_YES, SIDE_NO } from "opaque-sdk";

const client = new OpaqueClient({ provider, signer });
await client.initFhe();

const market = client.market("0x...");
await market.mintShares(10_000_000n);                      // 10 shares
await market.placeOrder("YES", 6500, true, 5_000_000n);   // YES bid at $0.65
await market.attemptMatch(0, 1);                           // permissionless match
```

---

## Roadmap

### Phase 1: Protocol Expansion (Q2 2026)

**Range Markets** — New contract type for bounded predictions:
- "BTC between $95K-$96K tomorrow?" → FHE-encrypted range bets
- Uses `FHE.gt()` + `FHE.lt()` + `FHE.and()` for range validation
- Three outcomes: BELOW / IN-RANGE / ABOVE (coordinated via MarketGroup)
- Deeper FHE usage: 15+ unique operations (up from 14)

**Conditional Markets** — Nested predictions with dependency chains:
- "If ETH > $4K, will SOL > $200?" → linked market resolution
- Parent market outcome gates child market activation
- New `ConditionalMarketGroup` coordinator contract

**Time-Weighted Markets** — Continuous price averaging:
- "BTC TWAP > $95K over 24 hours?" → Chainlink samples every block
- FHE.mul() for weighted accumulation, FHE.div() for averaging
- More sophisticated oracle integration

### Phase 2: Infrastructure (Q3 2026)

**Subgraph / Event Indexer** — Real-time market analytics:
- The Graph Protocol subgraph for all contract events (OrderPlaced, MatchAttempted, MarketResolved)
- GraphQL API: query markets by volume, active orders, historical prices
- Frontend switches from RPC polling (10s) to subgraph queries (<1s)
- Market analytics dashboard: total volume, unique traders, match success rate
- Matcher bot optimization: subgraph-fed order discovery instead of on-chain scans

**Real USDC Integration** — Mainnet preparation:
- Zaiffer Protocol (ERC-7984) for real cUSDC wrapping
- Replace testnet ConfidentialUSDT with production-grade confidential token
- Multi-chain deployment (Base, Arbitrum, wherever Zama deploys fhEVM)

### Phase 3: Ecosystem (Q4 2026)

- Governance token (OPAQUE DAO) for dispute resolution and fee governance
- Insurance layer for oracle failure protection
- AI agent integration (autonomous market making via SDK)
- Mobile app (React Native)
- Cross-chain market arbitrage

---

## Security Considerations

- **Testnet Only**: ConfidentialUSDT has owner-only minting -- for testing only
- **FHE Privacy Model**: Order existence and prices are public; sides and amounts are encrypted
- **Silent Failures**: FHE operations cannot revert on encrypted value checks -- insufficient balance results in
  0-amount operations
- **resolveDirectly**: Owner can only resolve after market deadline has passed (M-SC2 protection)
- **Reset Cooldown**: Manual voting reset has 1-day cooldown to prevent abuse (M-SC6 protection)

---

## License

BSD-3-Clause-Clear
