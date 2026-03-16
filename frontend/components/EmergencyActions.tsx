"use client";

import { useState } from "react";
import { useAccount, useWriteContract, usePublicClient, useReadContract } from "wagmi";
import { OPAQUE_MARKET_ABI } from "../lib/contracts";
import { getFHEInstance } from "../lib/fhe";

interface EmergencyActionsProps {
  marketAddress: string;
  resolved: boolean;
  deadline: number;
  totalSharesMinted: number;
  creator: string;
}

type EmStep = "idle" | "requesting" | "decrypting" | "finalizing" | "success" | "error";

export default function EmergencyActions({
  marketAddress,
  resolved,
  deadline,
  totalSharesMinted,
  creator,
}: EmergencyActionsProps) {
  const [step, setStep] = useState<EmStep>("idle");
  const [error, setError] = useState("");
  const { address: userAddress, isConnected } = useAccount();
  const { writeContractAsync } = useWriteContract();
  const publicClient = usePublicClient();

  const { data: gracePeriod } = useReadContract({
    address: marketAddress as `0x${string}`,
    abi: OPAQUE_MARKET_ABI,
    functionName: "GRACE_PERIOD",
  });

  const { data: decryptTimeout } = useReadContract({
    address: marketAddress as `0x${string}`,
    abi: OPAQUE_MARKET_ABI,
    functionName: "DECRYPT_TIMEOUT",
  });

  const { data: resolvedAt } = useReadContract({
    address: marketAddress as `0x${string}`,
    abi: OPAQUE_MARKET_ABI,
    functionName: "resolvedAt",
  });

  const { data: hasShares } = useReadContract({
    address: marketAddress as `0x${string}`,
    abi: OPAQUE_MARKET_ABI,
    functionName: "hasUserShares",
    args: [userAddress as `0x${string}`],
    query: { enabled: !!userAddress },
  });

  const now = Math.floor(Date.now() / 1000);
  const grace = gracePeriod ? Number(gracePeriod) : 604800;
  const timeout = decryptTimeout ? Number(decryptTimeout) : 604800;
  const resolvedTime = resolvedAt ? Number(resolvedAt) : 0;

  // Emergency withdraw: !resolved && past deadline + grace
  const canEmergencyWithdraw = !resolved && now > deadline + grace;

  // Emergency refund after resolution: resolved && past resolvedAt + timeout
  const canEmergencyRefund = resolved && resolvedTime > 0 && now > resolvedTime + timeout;

  // Cancel market: creator only, !resolved, 0 shares minted
  const canCancel = userAddress?.toLowerCase() === creator?.toLowerCase() && !resolved && totalSharesMinted === 0;

  const userHasShares = hasShares === true;

  if (!isConnected || !userAddress) return null;
  if (!canEmergencyWithdraw && !canEmergencyRefund && !canCancel) return null;

  async function handleEmergencyWithdraw() {
    if (!publicClient) return;
    setError("");
    try {
      setStep("requesting");
      const fn = canEmergencyRefund ? "emergencyRefundAfterResolution" : "emergencyWithdraw";
      const reqHash = await writeContractAsync({
        address: marketAddress as `0x${string}`,
        abi: OPAQUE_MARKET_ABI,
        functionName: fn,
      });
      await publicClient.waitForTransactionReceipt({ hash: reqHash });

      // Wait for KMS
      setStep("decrypting");
      await new Promise((r) => setTimeout(r, 3000));

      const [yesHandle, noHandle] = await publicClient.readContract({
        address: marketAddress as `0x${string}`,
        abi: OPAQUE_MARKET_ABI,
        functionName: "getMyShares",
        account: userAddress!,
      }) as [bigint, bigint];

      const yesHex = `0x${yesHandle.toString(16).padStart(64, "0")}` as `0x${string}`;
      const noHex = `0x${noHandle.toString(16).padStart(64, "0")}` as `0x${string}`;

      const fhe = await getFHEInstance();
      if (!fhe) throw new Error("FHE initialization failed");
      let decryptResult: any = null;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          decryptResult = await fhe.publicDecrypt([yesHex, noHex]);
          break;
        } catch (e) {
          if (attempt === 2) throw e;
          await new Promise((r) => setTimeout(r, 5000));
        }
      }
      if (!decryptResult) {
        setError("Decryption failed after all retries");
        setStep("idle");
        return;
      }

      const yesAmount = typeof decryptResult.clearValues[yesHex] === "bigint"
        ? decryptResult.clearValues[yesHex]
        : BigInt(decryptResult.clearValues[yesHex] as string);
      const noAmount = typeof decryptResult.clearValues[noHex] === "bigint"
        ? decryptResult.clearValues[noHex]
        : BigInt(decryptResult.clearValues[noHex] as string);
      const proof = decryptResult.decryptionProof as `0x${string}`;

      setStep("finalizing");
      const finalizeHash = await writeContractAsync({
        address: marketAddress as `0x${string}`,
        abi: OPAQUE_MARKET_ABI,
        functionName: "finalizeEmergencyWithdraw",
        args: [yesAmount, noAmount, proof],
      });
      await publicClient.waitForTransactionReceipt({ hash: finalizeHash });

      setStep("success");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Emergency action failed";
      setError(msg.length > 120 ? msg.slice(0, 120) + "..." : msg);
      setStep("error");
    }
  }

  async function handleCancel() {
    if (!publicClient) return;
    setError("");
    try {
      setStep("requesting");
      const hash = await writeContractAsync({
        address: marketAddress as `0x${string}`,
        abi: OPAQUE_MARKET_ABI,
        functionName: "cancelMarket",
      });
      await publicClient.waitForTransactionReceipt({ hash: hash });
      setStep("success");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Cancel failed";
      setError(msg.length > 120 ? msg.slice(0, 120) + "..." : msg);
      setStep("error");
    }
  }

  return (
    <div className="bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-800 rounded-xl p-6 space-y-4">
      <div className="flex items-center gap-2">
        <svg className="w-5 h-5 text-amber-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4.5c-.77-.833-2.694-.833-3.464 0L3.34 16.5c-.77.833.192 2.5 1.732 2.5z" />
        </svg>
        <h4 className="text-base font-semibold text-amber-800">Emergency Actions</h4>
      </div>

      {(canEmergencyWithdraw || canEmergencyRefund) && userHasShares && (
        <div className="space-y-3">
          <p className="text-sm text-amber-700">
            {canEmergencyRefund
              ? "Market resolved but redemption KMS timed out. You can request an emergency refund."
              : "Market was not resolved within the grace period. You can withdraw your shares."}
          </p>
          {step === "success" ? (
            <div className="bg-green-50 dark:bg-green-900/30 border border-green-200 rounded-lg p-3 text-sm text-green-800 dark:text-green-400 font-medium">
              Emergency refund completed!
            </div>
          ) : step === "error" ? (
            <div className="bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 rounded-lg p-3 flex items-center justify-between">
              <span className="text-sm text-red-800 dark:text-red-400">{error}</span>
              <button onClick={() => { setStep("idle"); setError(""); }} className="text-sm text-red-600 font-medium underline ml-3">
                Retry
              </button>
            </div>
          ) : (
            <button
              onClick={handleEmergencyWithdraw}
              disabled={step !== "idle"}
              className="w-full bg-amber-600 hover:bg-amber-700 text-white py-2.5 rounded-lg text-sm font-semibold transition-colors disabled:opacity-40"
            >
              {step === "idle"
                ? "Emergency Withdraw"
                : step === "requesting"
                ? "Requesting..."
                : step === "decrypting"
                ? "Decrypting..."
                : "Finalizing..."}
            </button>
          )}
        </div>
      )}

      {canCancel && (
        <div className="space-y-3">
          <p className="text-sm text-amber-700">
            No shares minted yet. You can cancel this market.
          </p>
          {step === "success" ? (
            <div className="bg-green-50 dark:bg-green-900/30 border border-green-200 rounded-lg p-3 text-sm text-green-800 dark:text-green-400 font-medium">
              Market cancelled!
            </div>
          ) : (
            <button
              onClick={handleCancel}
              disabled={step !== "idle"}
              className="w-full bg-red-600 hover:bg-red-700 text-white py-2.5 rounded-lg text-sm font-semibold transition-colors disabled:opacity-40"
            >
              {step === "requesting" ? "Cancelling..." : "Cancel Market"}
            </button>
          )}

          {step === "error" && error && (
            <div className="bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 rounded-lg p-3 flex items-center justify-between">
              <span className="text-sm text-red-800 dark:text-red-400">{error}</span>
              <button onClick={() => { setStep("idle"); setError(""); }} className="text-sm text-red-600 font-medium underline ml-3">
                Retry
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
