// FHE initialization and encryption utilities
// Uses @zama-fhe/relayer-sdk for real FHE on Ethereum Sepolia
// Dynamic import to avoid WASM loading at build time (Turbopack/SSR compatible)

import { SEPOLIA_RPC_URL } from "./wagmi";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let instancePromise: Promise<any> | null = null;

/**
 * Initialize and return the FhevmInstance (singleton with Promise memoization).
 * Uses SepoliaConfig with the host chain RPC as network.
 * Dynamically imports the SDK so WASM is only loaded in the browser at runtime.
 * Promise memoization prevents parallel initializations (race condition fix).
 */
export async function getFHEInstance(): Promise<any> {
  if (instancePromise) return instancePromise;

  instancePromise = (async () => {
    try {
      console.log("Initializing Zama Relayer SDK (SepoliaConfig)...");

      const { createInstance, SepoliaConfig, initSDK } = await import("@zama-fhe/relayer-sdk/web");

      // Load WASM modules before creating instance
      await initSDK();

      // SepoliaConfig has all contract addresses pre-configured.
      // We only need to supply the `network` (RPC URL or EIP-1193 provider).
      const inst = await createInstance({
        ...SepoliaConfig,
        network: SEPOLIA_RPC_URL,
      });

      console.log("Zama Relayer SDK initialized successfully");
      return inst;
    } catch (err) {
      instancePromise = null; // Reset on failure so retry works
      throw err;
    }
  })();

  return instancePromise;
}

// Helper: convert Uint8Array to hex string for contract calls
export function toHex(bytes: Uint8Array): `0x${string}` {
  return `0x${Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")}` as `0x${string}`;
}
