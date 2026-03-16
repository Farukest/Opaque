/**
 * OPAQUE V3 SDK
 *
 * TypeScript SDK for interacting with the OPAQUE FHE-encrypted prediction market protocol.
 *
 * @example
 * ```ts
 * import { OpaqueClient, SEPOLIA_ADDRESSES } from "opaque-sdk";
 * import { ethers } from "ethers";
 *
 * const provider = new ethers.JsonRpcProvider("https://rpc.sepolia.org");
 * const signer = new ethers.Wallet(privateKey, provider);
 * const client = new OpaqueClient({ provider, signer });
 *
 * // Query a market
 * const market = client.market("0x...");
 * const info = await market.getMarketInfo();
 * console.log(info.question, info.yesPrice, info.noPrice);
 *
 * // Mint shares (requires FHE initialization)
 * import { createInstance, SepoliaConfig } from "@zama-fhe/relayer-sdk/node";
 * const fhe = await client.initFhe(createInstance, { ...SepoliaConfig, network: provider });
 * await market.mintShares(fhe, signer.address, 10_000_000n); // 10 cUSDT
 * ```
 *
 * @packageDocumentation
 */

// ═══════════════════════════════════════
// MAIN CLIENT
// ═══════════════════════════════════════

export { OpaqueClient } from "./client";

// ═══════════════════════════════════════
// SUB-CLIENTS
// ═══════════════════════════════════════

export { OpaqueMarketClient } from "./market";
export { ConfidentialTokenClient } from "./token";
export { MarketFactoryClient } from "./factory";

// ═══════════════════════════════════════
// ABIs
// ═══════════════════════════════════════

export {
  OPAQUE_MARKET_ABI,
  MARKET_FACTORY_ABI,
  MARKET_GROUP_ABI,
  ORACLE_RESOLVER_ABI,
  CUSDT_ABI,
} from "./abis";

// ═══════════════════════════════════════
// ADDRESSES
// ═══════════════════════════════════════

export {
  SEPOLIA_ADDRESSES,
  SEPOLIA_CHAIN_ID,
  getAddresses,
} from "./addresses";
export type { AddressMap } from "./addresses";

// ═══════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════

export {
  SIDE_YES,
  SIDE_NO,
  SHARE_UNIT,
  BPS,
  PRICE_TO_USDT,
  FEE_BPS,
  TRADE_FEE_BPS,
  WITHDRAW_FEE,
  MAX_ACTIVE_ORDERS,
  GRACE_PERIOD,
  DECRYPT_TIMEOUT,
  MIN_PRICE,
  MAX_PRICE,
  TOKEN_DECIMALS,
  formatPrice,
  priceToPercent,
  dollarsToMicro,
  microToDollars,
  isValidPrice,
} from "./constants";

// ═══════════════════════════════════════
// FHE HELPERS
// ═══════════════════════════════════════

export {
  initFhe,
  resetFheInstance,
  encryptSide,
  encryptAmount,
  encryptOrderInputs,
  toHex,
  handleToBytes32,
} from "./fhe";

// ═══════════════════════════════════════
// TYPES
// ═══════════════════════════════════════

export type {
  Side,
  SideValue,
  MarketInfo,
  Order,
  PriceLevel,
  BestPrices,
  ShareBalances,
  GroupInfo,
  GroupOutcome,
  MarketGroupData,
  CreateMarketParams,
  OpaqueClientConfig,
  FheInstance,
  EncryptedInput,
  EncryptedInputResult,
  SharesMintedEvent,
  OrderPlacedEvent,
  OrderCancelledEvent,
  MatchAttemptedEvent,
  MarketResolvedEvent,
  MarketCreatedEvent,
} from "./types";
