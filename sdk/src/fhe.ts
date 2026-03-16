/**
 * FHE Helpers for OPAQUE V3
 *
 * Provides initialization of the Zama FHE instance and encryption utilities
 * for encrypting order sides (YES/NO) and amounts.
 *
 * Uses @zama-fhe/relayer-sdk (successor to fhevmjs).
 * - Node.js: import from "@zama-fhe/relayer-sdk/node"
 * - Browser: import from "@zama-fhe/relayer-sdk/web"
 *
 * The SDK consumer is responsible for importing the correct subpath.
 */

import type { FheInstance, EncryptedInputResult } from "./types";
import { SIDE_YES, SIDE_NO } from "./constants";

/** Singleton FHE instance promise (prevents parallel initializations) */
let instancePromise: Promise<FheInstance> | null = null;

/**
 * Initialize and return the FHE instance (singleton with promise memoization).
 *
 * @param createInstanceFn - The createInstance function from @zama-fhe/relayer-sdk
 * @param config - SepoliaConfig (or custom) with `network` set to your RPC URL
 * @returns The initialized FheInstance
 *
 * @example
 * ```ts
 * import { createInstance, SepoliaConfig } from "@zama-fhe/relayer-sdk/node";
 * const fhe = await initFhe(createInstance, { ...SepoliaConfig, network: rpcUrl });
 * ```
 */
export async function initFhe(
  createInstanceFn: (config: Record<string, unknown>) => Promise<FheInstance>,
  config: Record<string, unknown>,
): Promise<FheInstance> {
  if (instancePromise) return instancePromise;

  instancePromise = (async () => {
    try {
      const instance = await createInstanceFn(config);
      return instance;
    } catch (err) {
      instancePromise = null; // Reset on failure so retry works
      throw err;
    }
  })();

  return instancePromise;
}

/**
 * Reset the cached FHE instance (useful for testing or re-initialization).
 */
export function resetFheInstance(): void {
  instancePromise = null;
}

/**
 * Encrypt the order side (YES=0 or NO=1) as an euint8.
 *
 * @param fhe - The FHE instance
 * @param contractAddress - The OpaqueMarket contract address
 * @param userAddress - The user's wallet address
 * @param side - "YES" or "NO"
 * @returns Encrypted handle (bytes32) and input proof
 */
export function encryptSide(
  fhe: FheInstance,
  contractAddress: string,
  userAddress: string,
  side: "YES" | "NO",
): EncryptedInputResult {
  const sideValue = side === "YES" ? SIDE_YES : SIDE_NO;
  const input = fhe.createEncryptedInput(contractAddress, userAddress);
  input.add8(sideValue);
  return input.encrypt();
}

/**
 * Encrypt an amount as an euint64.
 *
 * @param fhe - The FHE instance
 * @param contractAddress - The OpaqueMarket or ConfidentialUSDT contract address
 * @param userAddress - The user's wallet address
 * @param amount - The amount in micro-cUSDT (uint64)
 * @returns Encrypted handle (bytes32) and input proof
 */
export function encryptAmount(
  fhe: FheInstance,
  contractAddress: string,
  userAddress: string,
  amount: bigint,
): EncryptedInputResult {
  const input = fhe.createEncryptedInput(contractAddress, userAddress);
  input.add64(amount);
  return input.encrypt();
}

/**
 * Encrypt both side and amount for a placeOrder call.
 * Returns two separate encrypted inputs (side needs its own proof, amount needs its own).
 *
 * @param fhe - The FHE instance
 * @param contractAddress - The OpaqueMarket contract address
 * @param userAddress - The user's wallet address
 * @param side - "YES" or "NO"
 * @param amount - The amount in micro-cUSDT
 * @returns Object with sideEncrypted and amountEncrypted results
 */
export function encryptOrderInputs(
  fhe: FheInstance,
  contractAddress: string,
  userAddress: string,
  side: "YES" | "NO",
  amount: bigint,
): { sideEncrypted: EncryptedInputResult; amountEncrypted: EncryptedInputResult } {
  return {
    sideEncrypted: encryptSide(fhe, contractAddress, userAddress, side),
    amountEncrypted: encryptAmount(fhe, contractAddress, userAddress, amount),
  };
}

/**
 * Convert a Uint8Array to a hex string (for contract call parameters).
 */
export function toHex(bytes: Uint8Array): string {
  return (
    "0x" +
    Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("")
  );
}

/**
 * Convert a handle (Uint8Array) to a bytes32 hex string.
 */
export function handleToBytes32(handle: Uint8Array): string {
  if (handle.length !== 32) {
    // Pad to 32 bytes if needed
    const padded = new Uint8Array(32);
    padded.set(handle, 32 - handle.length);
    return toHex(padded);
  }
  return toHex(handle);
}
