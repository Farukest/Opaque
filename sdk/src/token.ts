/**
 * ConfidentialTokenClient — Wrapper for interacting with ConfidentialUSDT (cUSDT).
 *
 * Provides typed methods for minting, transferring, approving, and querying
 * the FHE-encrypted ERC-20 token used by OPAQUE markets.
 */

import { ethers } from "ethers";
import { CUSDT_ABI } from "./abis";
import { SEPOLIA_ADDRESSES } from "./addresses";
import type { FheInstance } from "./types";
import { encryptAmount, toHex, handleToBytes32 } from "./fhe";

export class ConfidentialTokenClient {
  public readonly contract: ethers.Contract;
  public readonly address: string;
  private readonly signer: ethers.Signer | undefined;

  constructor(
    providerOrSigner: ethers.Provider | ethers.Signer,
    address: string = SEPOLIA_ADDRESSES.ConfidentialUSDT,
  ) {
    this.address = address;
    if ("getAddress" in providerOrSigner && "sendTransaction" in providerOrSigner) {
      this.signer = providerOrSigner as ethers.Signer;
    }
    this.contract = new ethers.Contract(address, CUSDT_ABI, providerOrSigner);
  }

  // ═══════════════════════════════════════
  // VIEW FUNCTIONS
  // ═══════════════════════════════════════

  /**
   * Get the encrypted balance handle for an address.
   * Returns the raw on-chain value (an FHE handle, not the decrypted balance).
   * For testnet ConfidentialUSDT, balanceOf returns the plaintext totalSupply-based value.
   */
  async balanceOf(address: string): Promise<bigint> {
    return this.contract.balanceOf(address);
  }

  /**
   * Get the plaintext allowance (used for pre-checks before FHE operations).
   */
  async allowance(owner: string, spender: string): Promise<bigint> {
    const result = await this.contract.allowancePlaintext(owner, spender);
    return BigInt(result);
  }

  /**
   * Get the token name.
   */
  async name(): Promise<string> {
    return this.contract.name();
  }

  /**
   * Get the token symbol.
   */
  async symbol(): Promise<string> {
    return this.contract.symbol();
  }

  /**
   * Get the token decimals (always 6 for cUSDT).
   */
  async decimals(): Promise<number> {
    return this.contract.decimals();
  }

  /**
   * Get the total supply (plaintext).
   */
  async totalSupply(): Promise<bigint> {
    return this.contract.totalSupply();
  }

  // ═══════════════════════════════════════
  // WRITE FUNCTIONS
  // ═══════════════════════════════════════

  /**
   * Mint tokens to an address (testnet only — owner-gated).
   *
   * @param to - Recipient address
   * @param amount - Amount in micro-cUSDT (plaintext)
   */
  async mint(to: string, amount: bigint): Promise<ethers.TransactionResponse> {
    this.requireSigner();
    return this.contract.mint(to, amount);
  }

  /**
   * Transfer tokens using FHE-encrypted amount.
   *
   * @param fhe - FHE instance for encrypting the amount
   * @param userAddress - The caller's address (for input proof binding)
   * @param to - Recipient address
   * @param amount - Amount in micro-cUSDT
   */
  async transfer(
    fhe: FheInstance,
    userAddress: string,
    to: string,
    amount: bigint,
  ): Promise<ethers.TransactionResponse> {
    this.requireSigner();
    const encrypted = encryptAmount(fhe, this.address, userAddress, amount);
    const handle = handleToBytes32(encrypted.handles[0]);
    const proof = toHex(encrypted.inputProof);
    return this.contract.transfer(to, handle, proof);
  }

  /**
   * Approve a spender using FHE-encrypted amount.
   *
   * @param fhe - FHE instance for encrypting the amount
   * @param userAddress - The caller's address (for input proof binding)
   * @param spender - Spender address (typically the OpaqueMarket contract)
   * @param amount - Allowance amount in micro-cUSDT
   */
  async approve(
    fhe: FheInstance,
    userAddress: string,
    spender: string,
    amount: bigint,
  ): Promise<ethers.TransactionResponse> {
    this.requireSigner();
    const encrypted = encryptAmount(fhe, this.address, userAddress, amount);
    const handle = handleToBytes32(encrypted.handles[0]);
    const proof = toHex(encrypted.inputProof);
    return this.contract.approve(spender, handle, proof);
  }

  /**
   * Approve a spender using a plaintext amount (simpler, no FHE needed).
   * Uses the approvePlaintext function available on the testnet contract.
   *
   * @param spender - Spender address
   * @param amount - Allowance amount as uint64
   */
  async approvePlaintext(
    spender: string,
    amount: bigint,
  ): Promise<ethers.TransactionResponse> {
    this.requireSigner();
    return this.contract.approvePlaintext(spender, amount);
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
