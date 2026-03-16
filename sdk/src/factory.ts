/**
 * MarketFactoryClient — Wrapper for interacting with the MarketFactory contract.
 *
 * Provides typed methods for creating new prediction markets and querying
 * existing ones.
 */

import { ethers } from "ethers";
import { MARKET_FACTORY_ABI } from "./abis";
import { SEPOLIA_ADDRESSES } from "./addresses";
import type { CreateMarketParams } from "./types";

export class MarketFactoryClient {
  public readonly contract: ethers.Contract;
  public readonly address: string;
  private readonly signer: ethers.Signer | undefined;

  constructor(
    providerOrSigner: ethers.Provider | ethers.Signer,
    address: string = SEPOLIA_ADDRESSES.MarketFactory,
  ) {
    this.address = address;
    if ("getAddress" in providerOrSigner && "sendTransaction" in providerOrSigner) {
      this.signer = providerOrSigner as ethers.Signer;
    }
    this.contract = new ethers.Contract(address, MARKET_FACTORY_ABI, providerOrSigner);
  }

  // ═══════════════════════════════════════
  // MARKET CREATION
  // ═══════════════════════════════════════

  /**
   * Create a new prediction market.
   *
   * @param params - Market creation parameters
   * @returns The address of the newly deployed OpaqueMarket contract
   */
  async createMarket(params: CreateMarketParams): Promise<string> {
    this.requireSigner();

    if (!params.question.trim()) {
      throw new Error("Question is required.");
    }
    if (!params.resolutionSource.trim()) {
      throw new Error("Resolution source is required.");
    }
    if (!params.resolutionSourceType.trim()) {
      throw new Error("Resolution source type is required.");
    }
    if (!params.resolutionCriteria.trim()) {
      throw new Error("Resolution criteria is required.");
    }
    if (params.deadline <= Math.floor(Date.now() / 1000)) {
      throw new Error("Deadline must be in the future.");
    }

    let tx: ethers.TransactionResponse;

    if (params.resolver) {
      tx = await this.contract.createMarketWithResolver(
        params.question,
        params.deadline,
        params.resolutionSource,
        params.resolutionSourceType,
        params.resolutionCriteria,
        params.category,
        params.resolver,
      );
    } else {
      tx = await this.contract.createMarket(
        params.question,
        params.deadline,
        params.resolutionSource,
        params.resolutionSourceType,
        params.resolutionCriteria,
        params.category,
      );
    }

    const receipt = await tx.wait();
    if (!receipt) {
      throw new Error("Transaction receipt is null.");
    }

    // Parse the MarketCreated event to extract the new market address
    const iface = new ethers.Interface(MARKET_FACTORY_ABI);
    for (const log of receipt.logs) {
      try {
        const parsed = iface.parseLog({ topics: log.topics as string[], data: log.data });
        if (parsed && parsed.name === "MarketCreated") {
          return parsed.args[0] as string; // market address
        }
      } catch {
        // Not our event, skip
      }
    }

    throw new Error("MarketCreated event not found in transaction receipt.");
  }

  // ═══════════════════════════════════════
  // VIEW FUNCTIONS
  // ═══════════════════════════════════════

  /**
   * Get the total number of markets created.
   */
  async getMarketCount(): Promise<number> {
    const count = await this.contract.getMarketCount();
    return Number(count);
  }

  /**
   * Get the address of a market by its index.
   */
  async getMarket(index: number): Promise<string> {
    return this.contract.markets(index);
  }

  /**
   * Get all market addresses.
   */
  async getAllMarkets(): Promise<string[]> {
    return this.contract.getAllMarkets();
  }

  /**
   * Get the factory owner address.
   */
  async getOwner(): Promise<string> {
    return this.contract.owner();
  }

  /**
   * Get the default resolver address.
   */
  async getDefaultResolver(): Promise<string> {
    return this.contract.defaultResolver();
  }

  /**
   * Check if creation fee is enabled.
   */
  async isCreationFeeEnabled(): Promise<boolean> {
    return this.contract.creationFeeEnabled();
  }

  /**
   * Get the creation fee amount.
   */
  async getCreationFee(): Promise<bigint> {
    return this.contract.CREATION_FEE();
  }

  /**
   * Get the token address used by the factory.
   */
  async getTokenAddress(): Promise<string> {
    return this.contract.token();
  }

  // ═══════════════════════════════════════
  // INTERNALS
  // ═══════════════════════════════════════

  private requireSigner(): void {
    if (!this.signer) {
      throw new Error("Signer required for write operations. Provide a signer in the constructor.");
    }
  }
}
