/**
 * OpaqueClient — Main entry point for the OPAQUE V3 SDK.
 *
 * Provides a unified interface for interacting with all OPAQUE contracts:
 * - OpaqueMarket (prediction markets)
 * - ConfidentialUSDT (FHE-encrypted token)
 * - MarketFactory (market creation)
 *
 * @example
 * ```ts
 * import { OpaqueClient } from "opaque-sdk";
 * import { ethers } from "ethers";
 *
 * const provider = new ethers.JsonRpcProvider("https://rpc.sepolia.org");
 * const signer = new ethers.Wallet(privateKey, provider);
 *
 * const client = new OpaqueClient({ provider, signer });
 * const market = client.market("0x...");
 * const info = await market.getMarketInfo();
 * ```
 */

import { ethers } from "ethers";
import { OpaqueMarketClient } from "./market";
import { ConfidentialTokenClient } from "./token";
import { MarketFactoryClient } from "./factory";
import { SEPOLIA_ADDRESSES, SEPOLIA_CHAIN_ID, getAddresses } from "./addresses";
import type { OpaqueClientConfig, FheInstance } from "./types";
import { initFhe, resetFheInstance } from "./fhe";

export class OpaqueClient {
  public readonly provider: ethers.Provider;
  public readonly signer: ethers.Signer | undefined;
  public readonly chainId: number;

  private fheInstance: FheInstance | null = null;

  constructor(config: OpaqueClientConfig) {
    this.provider = config.provider;
    this.signer = config.signer;
    this.chainId = config.chainId ?? SEPOLIA_CHAIN_ID;
  }

  // ═══════════════════════════════════════
  // CLIENT FACTORIES
  // ═══════════════════════════════════════

  /**
   * Create a market client for a specific OpaqueMarket address.
   *
   * @param address - The OpaqueMarket contract address
   * @returns An OpaqueMarketClient instance
   */
  market(address: string): OpaqueMarketClient {
    if (!ethers.isAddress(address)) {
      throw new Error(`Invalid market address: ${address}`);
    }
    const signerOrProvider = this.signer ?? this.provider;
    return new OpaqueMarketClient(address, signerOrProvider);
  }

  /**
   * Create a token client for ConfidentialUSDT.
   *
   * @param address - Optional custom token address (defaults to Sepolia cUSDT)
   * @returns A ConfidentialTokenClient instance
   */
  token(address?: string): ConfidentialTokenClient {
    const addr = address ?? this.getAddresses().ConfidentialUSDT;
    if (!ethers.isAddress(addr)) {
      throw new Error(`Invalid token address: ${addr}`);
    }
    const signerOrProvider = this.signer ?? this.provider;
    return new ConfidentialTokenClient(signerOrProvider, addr);
  }

  /**
   * Create a factory client for MarketFactory.
   *
   * @param address - Optional custom factory address (defaults to Sepolia factory)
   * @returns A MarketFactoryClient instance
   */
  factory(address?: string): MarketFactoryClient {
    const addr = address ?? this.getAddresses().MarketFactory;
    if (!ethers.isAddress(addr)) {
      throw new Error(`Invalid factory address: ${addr}`);
    }
    const signerOrProvider = this.signer ?? this.provider;
    return new MarketFactoryClient(signerOrProvider, addr);
  }

  // ═══════════════════════════════════════
  // FHE
  // ═══════════════════════════════════════

  /**
   * Initialize and return the FHE instance.
   * The instance is cached for subsequent calls.
   *
   * @param createInstanceFn - The createInstance function from @zama-fhe/relayer-sdk
   * @param config - SDK config (e.g., SepoliaConfig with network RPC URL)
   * @returns The initialized FheInstance
   *
   * @example
   * ```ts
   * import { createInstance, SepoliaConfig } from "@zama-fhe/relayer-sdk/node";
   *
   * const fhe = await client.initFhe(createInstance, {
   *   ...SepoliaConfig,
   *   network: "https://rpc.sepolia.org",
   * });
   * ```
   */
  async initFhe(
    createInstanceFn: (config: Record<string, unknown>) => Promise<FheInstance>,
    config: Record<string, unknown>,
  ): Promise<FheInstance> {
    if (this.fheInstance) return this.fheInstance;
    this.fheInstance = await initFhe(createInstanceFn, config);
    return this.fheInstance;
  }

  /**
   * Get the cached FHE instance.
   * @throws Error if FHE has not been initialized yet.
   */
  getFhe(): FheInstance {
    if (!this.fheInstance) {
      throw new Error("FHE not initialized. Call client.initFhe() first.");
    }
    return this.fheInstance;
  }

  /**
   * Reset the FHE instance (useful for re-initialization).
   */
  resetFhe(): void {
    this.fheInstance = null;
    resetFheInstance();
  }

  // ═══════════════════════════════════════
  // UTILITY
  // ═══════════════════════════════════════

  /**
   * Get the deployed contract addresses for the configured chain.
   */
  getAddresses(): typeof SEPOLIA_ADDRESSES {
    return getAddresses(this.chainId);
  }

  /**
   * Check if a signer is available for write operations.
   */
  hasSigner(): boolean {
    return this.signer !== undefined;
  }
}
