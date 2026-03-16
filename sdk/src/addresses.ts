/**
 * OPAQUE V3 Deployed Contract Addresses
 *
 * Sepolia v7 deployment (Ethereum Sepolia testnet, chainId 11155111).
 */

/** Ethereum Sepolia chain ID */
export const SEPOLIA_CHAIN_ID = 11155111;

/** Sepolia v7 deployed contract addresses */
export const SEPOLIA_ADDRESSES = {
  /** ConfidentialUSDT (cUSDT) — FHE-encrypted ERC-20 token */
  ConfidentialUSDT: "0xc35eA8889D2C09B2bCF3641236D325C4dF7318f1",

  /** OracleResolver — Chainlink / multisig / direct resolution */
  OracleResolver: "0x165C3B6635EB21A22cEc631046810941BC8731b9",

  /** MarketFactory — deploys new OpaqueMarket instances */
  MarketFactory: "0x29B59C016616e644297a2b38Cf4Ef60E0F03a29B",

  /** MarketGroup — multi-outcome market coordinator */
  MarketGroup: "0x96A89c4de09054Bcb4222E3868d9a44ecC52Cca9",
} as const;

/** Address map type */
export type AddressMap = typeof SEPOLIA_ADDRESSES;

/**
 * Get addresses for a given chain ID.
 * Currently only Sepolia is supported.
 *
 * @throws Error if chain ID is not supported
 */
export function getAddresses(chainId: number): AddressMap {
  if (chainId === SEPOLIA_CHAIN_ID) {
    return SEPOLIA_ADDRESSES;
  }
  throw new Error(
    `Unsupported chain ID: ${chainId}. Currently only Sepolia (${SEPOLIA_CHAIN_ID}) is supported.`,
  );
}
