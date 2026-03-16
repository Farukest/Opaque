/**
 * OPAQUE V3 Protocol Constants
 *
 * These values mirror the on-chain constants defined in OpaqueMarket.sol.
 * Price range: 100-9900 (BPS=10000), so 5000 = $0.50.
 * 1 share = 1_000_000 micro-cUSDT = $1.00.
 */

/** Encrypted side: YES = 0 */
export const SIDE_YES = 0 as const;

/** Encrypted side: NO = 1 */
export const SIDE_NO = 1 as const;

/** 1 share = 1_000_000 micro-cUSDT ($1.00) */
export const SHARE_UNIT = 1_000_000n;

/** Basis points denominator (10000 = 100%) */
export const BPS = 10_000 as const;

/** Price-to-USDT conversion factor (SHARE_UNIT / BPS) */
export const PRICE_TO_USDT = 100n;

/** Redemption fee: 0.5% (50 BPS) */
export const FEE_BPS = 50 as const;

/** Trading fee: 0.05% (5 BPS) */
export const TRADE_FEE_BPS = 5 as const;

/** Flat withdrawal fee: $1.00 = 1_000_000 micro-cUSDT */
export const WITHDRAW_FEE = 1_000_000n;

/** Maximum active orders per user */
export const MAX_ACTIVE_ORDERS = 200 as const;

/** Grace period after market deadline (7 days in seconds) */
export const GRACE_PERIOD = 7 * 24 * 60 * 60;

/** Decryption timeout (7 days in seconds) */
export const DECRYPT_TIMEOUT = 7 * 24 * 60 * 60;

/** Minimum valid price (100 = $0.01) */
export const MIN_PRICE = 100 as const;

/** Maximum valid price (9900 = $0.99) */
export const MAX_PRICE = 9900 as const;

/** cUSDT decimals */
export const TOKEN_DECIMALS = 6 as const;

/**
 * Format a price from BPS to a dollar string.
 * @example formatPrice(5000) => "$0.50"
 */
export function formatPrice(price: number): string {
  return `$${(price / BPS).toFixed(2)}`;
}

/**
 * Convert a BPS price to a percentage.
 * @example priceToPercent(5000) => 50.0
 */
export function priceToPercent(price: number): number {
  return price / 100;
}

/**
 * Convert a dollar amount to micro-cUSDT (6 decimals).
 * @example dollarsToMicro(1.5) => 1_500_000n
 */
export function dollarsToMicro(dollars: number): bigint {
  return BigInt(Math.round(dollars * 1_000_000));
}

/**
 * Convert micro-cUSDT to a dollar amount.
 * @example microToDollars(1_500_000n) => 1.5
 */
export function microToDollars(micro: bigint): number {
  return Number(micro) / 1_000_000;
}

/**
 * Validate a price is within the allowed range (100-9900).
 */
export function isValidPrice(price: number): boolean {
  return Number.isInteger(price) && price >= MIN_PRICE && price <= MAX_PRICE;
}
