/**
 * OpaqueMarketClient — Wrapper for interacting with a single OpaqueMarket contract.
 *
 * Provides typed methods for minting shares, placing/cancelling orders,
 * matching, querying market info, and redemption.
 */

import { ethers } from "ethers";
import { OPAQUE_MARKET_ABI } from "./abis";
import type {
  MarketInfo,
  Order,
  PriceLevel,
  BestPrices,
  FheInstance,
} from "./types";
import { isValidPrice, MIN_PRICE, MAX_PRICE } from "./constants";
import { encryptSide, encryptAmount, toHex, handleToBytes32 } from "./fhe";

export class OpaqueMarketClient {
  public readonly contract: ethers.Contract;
  public readonly address: string;
  private readonly signer: ethers.Signer | undefined;

  constructor(
    address: string,
    providerOrSigner: ethers.Provider | ethers.Signer,
  ) {
    this.address = address;
    if ("getAddress" in providerOrSigner && "sendTransaction" in providerOrSigner) {
      this.signer = providerOrSigner as ethers.Signer;
      this.contract = new ethers.Contract(address, OPAQUE_MARKET_ABI, providerOrSigner);
    } else {
      this.contract = new ethers.Contract(address, OPAQUE_MARKET_ABI, providerOrSigner);
    }
  }

  // ═══════════════════════════════════════
  // MINT / BURN
  // ═══════════════════════════════════════

  /**
   * Mint YES+NO share pairs by depositing cUSDT.
   * Requires FHE encryption of the amount.
   *
   * @param fhe - FHE instance for encrypting the amount
   * @param userAddress - The caller's address
   * @param amount - Amount of cUSDT to deposit (in micro-cUSDT)
   */
  async mintShares(
    fhe: FheInstance,
    userAddress: string,
    amount: bigint,
  ): Promise<ethers.TransactionResponse> {
    this.requireSigner();
    const encrypted = encryptAmount(fhe, this.address, userAddress, amount);
    const handle = handleToBytes32(encrypted.handles[0]);
    const proof = toHex(encrypted.inputProof);
    return this.contract.mintShares(handle, proof);
  }

  /**
   * Burn YES+NO share pairs to withdraw cUSDT.
   *
   * @param fhe - FHE instance for encrypting the amount
   * @param userAddress - The caller's address
   * @param amount - Amount of shares to burn (in micro-cUSDT)
   */
  async burnShares(
    fhe: FheInstance,
    userAddress: string,
    amount: bigint,
  ): Promise<ethers.TransactionResponse> {
    this.requireSigner();
    const encrypted = encryptAmount(fhe, this.address, userAddress, amount);
    const handle = handleToBytes32(encrypted.handles[0]);
    const proof = toHex(encrypted.inputProof);
    return this.contract.burnShares(handle, proof);
  }

  // ═══════════════════════════════════════
  // ORDER PLACEMENT
  // ═══════════════════════════════════════

  /**
   * Place an encrypted order on the order book.
   *
   * @param fhe - FHE instance for encrypting side and amount
   * @param userAddress - The caller's address
   * @param side - "YES" or "NO"
   * @param price - Price in BPS (100-9900)
   * @param isBid - true for buy order, false for sell order
   * @param amount - Share amount in micro-cUSDT
   */
  async placeOrder(
    fhe: FheInstance,
    userAddress: string,
    side: "YES" | "NO",
    price: number,
    isBid: boolean,
    amount: bigint,
  ): Promise<ethers.TransactionResponse> {
    this.requireSigner();
    if (!isValidPrice(price)) {
      throw new Error(`Invalid price: ${price}. Must be between ${MIN_PRICE} and ${MAX_PRICE}.`);
    }

    const sideEncrypted = encryptSide(fhe, this.address, userAddress, side);
    const amountEncrypted = encryptAmount(fhe, this.address, userAddress, amount);

    const encSide = handleToBytes32(sideEncrypted.handles[0]);
    const sideProof = toHex(sideEncrypted.inputProof);
    const encAmount = handleToBytes32(amountEncrypted.handles[0]);
    const amountProof = toHex(amountEncrypted.inputProof);

    return this.contract.placeOrder(encSide, price, isBid, encAmount, sideProof, amountProof);
  }

  // ═══════════════════════════════════════
  // CANCEL ORDERS
  // ═══════════════════════════════════════

  /**
   * Cancel a single active order.
   * @param orderId - The order ID to cancel
   */
  async cancelOrder(orderId: number): Promise<ethers.TransactionResponse> {
    this.requireSigner();
    return this.contract.cancelOrder(orderId);
  }

  /**
   * Cancel multiple active orders in a single transaction.
   * @param orderIds - Array of order IDs to cancel
   */
  async cancelOrders(orderIds: number[]): Promise<ethers.TransactionResponse> {
    this.requireSigner();
    return this.contract.cancelOrders(orderIds);
  }

  // ═══════════════════════════════════════
  // MATCHING
  // ═══════════════════════════════════════

  /**
   * Attempt to match a bid and an ask order.
   * The match is executed entirely on-chain under FHE — the caller never
   * learns whether it succeeded or failed.
   *
   * @param bidId - The bid order ID
   * @param askId - The ask order ID
   */
  async attemptMatch(bidId: number, askId: number): Promise<ethers.TransactionResponse> {
    this.requireSigner();
    return this.contract.attemptMatch(bidId, askId);
  }

  // ═══════════════════════════════════════
  // REDEMPTION
  // ═══════════════════════════════════════

  /**
   * Request redemption of winning shares after market resolution.
   * The decryption callback will finalize the payout.
   */
  async requestRedemption(): Promise<ethers.TransactionResponse> {
    this.requireSigner();
    return this.contract.requestRedemption();
  }

  // ═══════════════════════════════════════
  // EMERGENCY
  // ═══════════════════════════════════════

  /**
   * Request emergency withdrawal (before resolution, after grace period).
   */
  async emergencyWithdraw(): Promise<ethers.TransactionResponse> {
    this.requireSigner();
    return this.contract.emergencyWithdraw();
  }

  /**
   * Emergency refund after market resolution (if no redemption within timeout).
   */
  async emergencyRefundAfterResolution(): Promise<ethers.TransactionResponse> {
    this.requireSigner();
    return this.contract.emergencyRefundAfterResolution();
  }

  // ═══════════════════════════════════════
  // VIEW FUNCTIONS
  // ═══════════════════════════════════════

  /**
   * Get full market info including current prices.
   */
  async getMarketInfo(): Promise<MarketInfo> {
    const [info, prices] = await Promise.all([
      this.contract.getMarketInfo(),
      this.contract.getCurrentPrice(),
    ]);

    return {
      question: info[0] as string,
      deadline: Number(info[1]),
      resolved: info[2] as boolean,
      outcome: info[3] as boolean,
      totalSharesMinted: BigInt(info[4]),
      activeOrderCount: BigInt(info[5]),
      resolutionSource: info[6] as string,
      resolutionSourceType: info[7] as string,
      resolutionCriteria: info[8] as string,
      category: info[9] as string,
      yesPrice: Number(prices[0]),
      noPrice: Number(prices[1]),
    };
  }

  /**
   * Get the public fields of a specific order.
   */
  async getOrder(orderId: number): Promise<Order> {
    const result = await this.contract.getOrder(orderId);
    return {
      id: orderId,
      owner: result[0] as string,
      price: Number(result[1]),
      isBid: result[2] as boolean,
      isActive: result[3] as boolean,
      sequence: BigInt(result[4]),
      createdAt: BigInt(result[5]),
    };
  }

  /**
   * Get all order IDs for a user.
   */
  async getUserOrders(user: string): Promise<number[]> {
    const ids: bigint[] = await this.contract.getUserOrders(user);
    return ids.map((id) => Number(id));
  }

  /**
   * Get the encrypted share balance handles for the connected signer.
   * Returns raw bigint handles (need FHE decryption for actual values).
   */
  async getMyShares(): Promise<{ yes: bigint; no: bigint }> {
    const result = await this.contract.getMyShares();
    return {
      yes: BigInt(result[0]),
      no: BigInt(result[1]),
    };
  }

  /**
   * Get bid/ask count at a specific price level.
   */
  async getPriceLevel(price: number): Promise<PriceLevel> {
    const result = await this.contract.getPriceLevel(price);
    return {
      bidCount: BigInt(result[0]),
      askCount: BigInt(result[1]),
    };
  }

  /**
   * Get the best bid and ask prices.
   */
  async getBestPrices(): Promise<BestPrices> {
    const result = await this.contract.getBestPrices();
    return {
      bestBid: Number(result[0]),
      bestAsk: Number(result[1]),
    };
  }

  /**
   * Check whether the user has any shares (minted or received from matching).
   */
  async hasUserShares(user: string): Promise<boolean> {
    return this.contract.hasUserShares(user);
  }

  /**
   * Get current YES and NO prices.
   */
  async getCurrentPrice(): Promise<{ yesPrice: number; noPrice: number }> {
    const result = await this.contract.getCurrentPrice();
    return {
      yesPrice: Number(result[0]),
      noPrice: Number(result[1]),
    };
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
