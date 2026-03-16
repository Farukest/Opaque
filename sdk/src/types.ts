/**
 * OPAQUE V3 SDK Type Definitions
 */

import type { ethers } from "ethers";

// ═══════════════════════════════════════
// ENUMS & LITERALS
// ═══════════════════════════════════════

/** Side of the order book */
export type Side = "YES" | "NO";

/** Numeric side value (matches on-chain SIDE_YES=0, SIDE_NO=1) */
export type SideValue = 0 | 1;

// ═══════════════════════════════════════
// MARKET TYPES
// ═══════════════════════════════════════

/** Market information returned by getMarketInfo() + getCurrentPrice() */
export interface MarketInfo {
  question: string;
  deadline: number;
  resolved: boolean;
  outcome: boolean;
  totalSharesMinted: bigint;
  activeOrderCount: bigint;
  resolutionSource: string;
  resolutionSourceType: string;
  resolutionCriteria: string;
  category: string;
  /** Current YES price in BPS (100-9900) */
  yesPrice: number;
  /** Current NO price in BPS (100-9900) */
  noPrice: number;
}

/** Order data returned by getOrder() (public fields only) */
export interface Order {
  id: number;
  owner: string;
  price: number;
  isBid: boolean;
  isActive: boolean;
  sequence: bigint;
  createdAt: bigint;
}

/** Price level depth at a specific price point */
export interface PriceLevel {
  bidCount: bigint;
  askCount: bigint;
}

/** Best bid/ask prices */
export interface BestPrices {
  bestBid: number;
  bestAsk: number;
}

/** User share balances (encrypted handles — need decryption) */
export interface ShareBalances {
  yes: bigint;
  no: bigint;
}

// ═══════════════════════════════════════
// MARKET GROUP (MULTI-OUTCOME)
// ═══════════════════════════════════════

/** Group information returned by getGroupInfo() */
export interface GroupInfo {
  question: string;
  outcomeCount: number;
  resolved: boolean;
  winningIndex: number;
  category: string;
}

/** Single outcome within a market group */
export interface GroupOutcome {
  label: string;
  market: string;
}

/** Full market group data with outcomes and prices */
export interface MarketGroupData {
  address: string;
  question: string;
  category: string;
  outcomeCount: number;
  resolved: boolean;
  winningIndex: number;
  outcomes: Array<{
    label: string;
    market: string;
    yesPrice: number;
    noPrice: number;
    resolved: boolean;
    outcome: boolean;
  }>;
}

// ═══════════════════════════════════════
// FACTORY TYPES
// ═══════════════════════════════════════

/** Parameters for creating a new market via the factory */
export interface CreateMarketParams {
  question: string;
  deadline: number;
  resolutionSource: string;
  resolutionSourceType: string;
  resolutionCriteria: string;
  category: string;
  /** Optional custom resolver address (defaults to factory's defaultResolver) */
  resolver?: string;
}

// ═══════════════════════════════════════
// CLIENT CONFIG
// ═══════════════════════════════════════

/** Configuration for OpaqueClient */
export interface OpaqueClientConfig {
  /** Ethers provider for read operations */
  provider: ethers.Provider;
  /** Ethers signer for write operations (optional for read-only) */
  signer?: ethers.Signer;
  /** Chain ID override (default: 11155111 for Sepolia) */
  chainId?: number;
}

// ═══════════════════════════════════════
// FHE TYPES
// ═══════════════════════════════════════

/** FHE instance returned by @zama-fhe/relayer-sdk */
export interface FheInstance {
  /** Create an encrypted input bound to a contract + user */
  createEncryptedInput: (
    contractAddress: string,
    userAddress: string,
  ) => EncryptedInput;
}

/** Encrypted input builder */
export interface EncryptedInput {
  addBool: (value: boolean) => EncryptedInput;
  add4: (value: number) => EncryptedInput;
  add8: (value: number) => EncryptedInput;
  add16: (value: number) => EncryptedInput;
  add32: (value: number) => EncryptedInput;
  add64: (value: bigint) => EncryptedInput;
  add128: (value: bigint) => EncryptedInput;
  addAddress: (value: string) => EncryptedInput;
  encrypt: () => EncryptedInputResult;
}

/** Result from encrypting an input */
export interface EncryptedInputResult {
  handles: Uint8Array[];
  inputProof: Uint8Array;
}

// ═══════════════════════════════════════
// EVENT TYPES
// ═══════════════════════════════════════

/** SharesMinted event data */
export interface SharesMintedEvent {
  user: string;
  timestamp: bigint;
}

/** OrderPlaced event data */
export interface OrderPlacedEvent {
  orderId: bigint;
  owner: string;
  price: number;
  isBid: boolean;
  sequence: bigint;
  timestamp: bigint;
}

/** OrderCancelled event data */
export interface OrderCancelledEvent {
  orderId: bigint;
  owner: string;
  timestamp: bigint;
}

/** MatchAttempted event data */
export interface MatchAttemptedEvent {
  bidId: bigint;
  askId: bigint;
  caller: string;
  timestamp: bigint;
}

/** MarketResolved event data */
export interface MarketResolvedEvent {
  outcome: boolean;
  timestamp: bigint;
}

/** MarketCreated event data (from factory) */
export interface MarketCreatedEvent {
  market: string;
  creator: string;
  question: string;
  deadline: bigint;
  resolutionSource: string;
  resolutionSourceType: string;
  category: string;
  marketIndex: bigint;
}
