"use client";

import { useState, useCallback } from "react";
import { useAccount, usePublicClient, useWalletClient } from "wagmi";
import { OPAQUE_MARKET_ABI } from "../lib/contracts";
import { getFHEInstance } from "../lib/fhe";

interface ShareBalanceProps {
  marketAddress: string;
}

interface DecryptedShares {
  yes: bigint;
  no: bigint;
}

export default function ShareBalance({ marketAddress }: ShareBalanceProps) {
  const { address: userAddress } = useAccount();
  const publicClient = usePublicClient();
  const { data: walletClient } = useWalletClient();
  const [decrypted, setDecrypted] = useState<DecryptedShares | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleDecrypt = useCallback(async () => {
    if (!publicClient || !userAddress) return;
    setLoading(true);
    setError("");

    try {
      // Read encrypted share handles
      const [yesHandle, noHandle] = await publicClient.readContract({
        address: marketAddress as `0x${string}`,
        abi: OPAQUE_MARKET_ABI,
        functionName: "getMyShares",
        account: userAddress as `0x${string}`,
      }) as [bigint, bigint];

      if (yesHandle === 0n && noHandle === 0n) {
        setDecrypted({ yes: 0n, no: 0n });
        return;
      }

      const yesHex = `0x${yesHandle.toString(16).padStart(64, "0")}` as `0x${string}`;
      const noHex = `0x${noHandle.toString(16).padStart(64, "0")}` as `0x${string}`;

      // User decrypt via Zama KMS
      const fhe = await getFHEInstance();
      if (!fhe) throw new Error("FHE initialization failed");
      const keypair = fhe.generateKeypair();
      const startTimestamp = Math.floor(Date.now() / 1000);
      const durationDays = 1;
      const eip712 = fhe.createEIP712(keypair.publicKey, [marketAddress], startTimestamp, durationDays);

      // Use wagmi walletClient for WalletConnect compatibility (C-FE2/3 fix)
      if (!walletClient) throw new Error("No wallet client connected");
      const signature = await walletClient.signTypedData({
        domain: eip712.domain,
        types: eip712.types,
        primaryType: eip712.primaryType,
        message: eip712.message,
      });

      const clearValues = await fhe.userDecrypt(
        [
          { handle: yesHex, contractAddress: marketAddress },
          { handle: noHex, contractAddress: marketAddress },
        ],
        keypair.privateKey,
        keypair.publicKey,
        signature,
        [marketAddress],
        userAddress,
        startTimestamp,
        durationDays,
      );

      const yesAmount = typeof clearValues[yesHex] === "bigint"
        ? clearValues[yesHex] as bigint
        : BigInt(clearValues[yesHex] as string || "0");
      const noAmount = typeof clearValues[noHex] === "bigint"
        ? clearValues[noHex] as bigint
        : BigInt(clearValues[noHex] as string || "0");

      setDecrypted({ yes: yesAmount, no: noAmount });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Decryption failed";
      if (msg.includes("User rejected") || msg.includes("denied")) {
        setError("Signature rejected");
      } else {
        setError(msg.length > 80 ? msg.slice(0, 80) + "..." : msg);
      }
    } finally {
      setLoading(false);
    }
  }, [marketAddress, userAddress, publicClient, walletClient]);

  if (!userAddress) return null;

  const formatShares = (raw: bigint) => {
    const w = raw / 1_000_000n;
    const f = (raw % 1_000_000n) * 100n / 1_000_000n;
    return `${w}.${f.toString().padStart(2, "0")}`;
  };

  return (
    <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm p-6">
      <h4 className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-4">Your Shares</h4>

      {decrypted ? (
        <div>
          {/* Two cards side by side */}
          <div className="grid grid-cols-2 gap-3 mb-4">
            {/* YES Card */}
            <div className="border border-green-200 bg-green-50 dark:bg-green-900/30 rounded-lg p-4 text-center">
              <div className="w-8 h-8 rounded-full bg-green-100 dark:bg-green-900/50 flex items-center justify-center mx-auto mb-2">
                <svg className="w-4 h-4 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <p className="text-xs font-medium uppercase tracking-wider text-gray-400 dark:text-gray-500 mb-1">YES Shares</p>
              <p className="text-xl font-semibold text-green-600">{formatShares(decrypted.yes)}</p>
              <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">cUSDT</p>
            </div>

            {/* NO Card */}
            <div className="border border-red-200 bg-red-50 dark:bg-red-900/30 rounded-lg p-4 text-center">
              <div className="w-8 h-8 rounded-full bg-red-100 dark:bg-red-900/50 flex items-center justify-center mx-auto mb-2">
                <svg className="w-4 h-4 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </div>
              <p className="text-xs font-medium uppercase tracking-wider text-gray-400 dark:text-gray-500 mb-1">NO Shares</p>
              <p className="text-xl font-semibold text-red-600">{formatShares(decrypted.no)}</p>
              <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">cUSDT</p>
            </div>
          </div>

          <button
            onClick={() => setDecrypted(null)}
            className="w-full bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 rounded-lg px-4 py-2 text-xs font-medium hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
          >
            Hide balances
          </button>
        </div>
      ) : (
        <div>
          {error && (
            <div className="bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 rounded-lg px-3 py-2 mb-3">
              <p className="text-xs text-red-600">{error}</p>
            </div>
          )}

          {/* Two placeholder cards */}
          <div className="grid grid-cols-2 gap-3 mb-4">
            <div className="border border-green-200 bg-green-50 dark:bg-green-900/30 rounded-lg p-4 text-center">
              <div className="w-8 h-8 rounded-full bg-green-100 dark:bg-green-900/50 flex items-center justify-center mx-auto mb-2">
                <svg className="w-4 h-4 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <p className="text-xs font-medium uppercase tracking-wider text-gray-400 dark:text-gray-500 mb-1">YES Shares</p>
              <p className="text-lg font-semibold text-gray-300 dark:text-gray-600">---</p>
            </div>
            <div className="border border-red-200 bg-red-50 dark:bg-red-900/30 rounded-lg p-4 text-center">
              <div className="w-8 h-8 rounded-full bg-red-100 dark:bg-red-900/50 flex items-center justify-center mx-auto mb-2">
                <svg className="w-4 h-4 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </div>
              <p className="text-xs font-medium uppercase tracking-wider text-gray-400 dark:text-gray-500 mb-1">NO Shares</p>
              <p className="text-lg font-semibold text-gray-300 dark:text-gray-600">---</p>
            </div>
          </div>

          <button
            onClick={handleDecrypt}
            disabled={loading}
            className="w-full bg-blue-600 hover:bg-blue-700 text-white rounded-lg px-4 py-2.5 text-sm font-medium transition-colors disabled:opacity-50"
          >
            {loading ? "Decrypting via KMS..." : "Decrypt Balances"}
          </button>
          <p className="text-xs text-gray-400 dark:text-gray-500 mt-2 text-center">
            Requires EIP-712 signature for Zama KMS decryption
          </p>
        </div>
      )}
    </div>
  );
}
