"use client";

import { useState } from "react";
import { useAccount, useWriteContract, usePublicClient, useReadContract } from "wagmi";
import { OPAQUE_MARKET_ABI } from "../lib/contracts";
import { getFHEInstance } from "../lib/fhe";

interface RedemptionPanelProps {
  marketAddress: string;
  resolved: boolean;
  outcome: boolean;
}

type Step = "idle" | "requesting" | "decrypting" | "finalizing" | "success" | "error";

const STEPS = [
  { key: "requesting", label: "Request", number: 1 },
  { key: "decrypting", label: "Decrypt", number: 2 },
  { key: "finalizing", label: "Finalize", number: 3 },
] as const;

export default function RedemptionPanel({ marketAddress, resolved, outcome }: RedemptionPanelProps) {
  const [step, setStep] = useState<Step>("idle");
  const [payout, setPayout] = useState<bigint | null>(null);
  const [error, setError] = useState("");

  const { address: userAddress, isConnected } = useAccount();
  const { writeContractAsync } = useWriteContract();
  const publicClient = usePublicClient();

  const { data: hasShares } = useReadContract({
    address: marketAddress as `0x${string}`,
    abi: OPAQUE_MARKET_ABI,
    functionName: "hasUserShares",
    args: [userAddress as `0x${string}`],
    query: { enabled: !!userAddress && resolved },
  });

  if (!resolved || !isConnected || !userAddress || !hasShares) return null;

  function getStepStatus(stepKey: string) {
    const order = ["requesting", "decrypting", "finalizing"];
    const currentIdx = order.indexOf(step);
    const stepIdx = order.indexOf(stepKey);
    if (step === "success") return "completed";
    if (stepIdx < currentIdx) return "completed";
    if (stepIdx === currentIdx) return "active";
    return "pending";
  }

  async function handleRedeem() {
    if (!publicClient || !userAddress) return;
    setError("");

    try {
      // Step 1: Request redemption (marks winning shares as publicly decryptable)
      setStep("requesting");
      const reqHash = await writeContractAsync({
        address: marketAddress as `0x${string}`,
        abi: OPAQUE_MARKET_ABI,
        functionName: "requestRedemption",
      });
      await publicClient.waitForTransactionReceipt({ hash: reqHash });

      // Step 2: Wait for KMS, then public decrypt
      setStep("decrypting");
      await new Promise((r) => setTimeout(r, 3000));

      // Read the winning share handle
      const [yesHandle, noHandle] = await publicClient.readContract({
        address: marketAddress as `0x${string}`,
        abi: OPAQUE_MARKET_ABI,
        functionName: "getMyShares",
        account: userAddress,
      }) as [bigint, bigint];

      const winningHandle = outcome ? yesHandle : noHandle;
      const winningHex = `0x${winningHandle.toString(16).padStart(64, "0")}` as `0x${string}`;

      // Public decrypt
      const fhe = await getFHEInstance();
      if (!fhe) throw new Error("FHE initialization failed");
      let decryptResult: any = null;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          decryptResult = await fhe.publicDecrypt([winningHex]);
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

      const winningShares = typeof decryptResult.clearValues[winningHex] === "bigint"
        ? decryptResult.clearValues[winningHex]
        : BigInt(decryptResult.clearValues[winningHex] as string);
      const proof = decryptResult.decryptionProof as `0x${string}`;

      // Step 3: Finalize redemption
      setStep("finalizing");
      const finalizeHash = await writeContractAsync({
        address: marketAddress as `0x${string}`,
        abi: OPAQUE_MARKET_ABI,
        functionName: "finalizeRedemption",
        args: [winningShares, proof],
      });
      await publicClient.waitForTransactionReceipt({ hash: finalizeHash });

      const sharesBigInt = typeof winningShares === "bigint" ? winningShares : BigInt(String(winningShares));
      // Matches contract FEE_BPS = 50 (0.5%) + WITHDRAW_FEE = 1_000_000 ($1 flat)
      const netPayout = sharesBigInt - (sharesBigInt * 50n / 10000n) - 1_000_000n;
      setPayout(netPayout);
      setStep("success");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Redemption failed";
      if (msg.includes("Already requested") || msg.includes("Already redeemed")) {
        setError("Redemption already processed");
      } else if (msg.includes("User rejected") || msg.includes("denied")) {
        setError("Transaction rejected");
      } else {
        setError(msg.length > 100 ? msg.slice(0, 100) + "..." : msg);
      }
      setStep("error");
    }
  }

  return (
    <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl shadow-sm p-6">
      {/* Header */}
      <div className="flex items-center gap-2 mb-4">
        <svg className="w-5 h-5 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        <h4 className="text-base font-semibold text-gray-900 dark:text-gray-100">Claim Winnings</h4>
      </div>

      <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
        Market resolved:{" "}
        <span className={`font-medium ${outcome ? "text-green-600" : "text-red-600"}`}>
          {outcome ? "YES" : "NO"} wins
        </span>.
        Redeem your {outcome ? "YES" : "NO"} shares for $1.00 each (minus 0.5% fee).
      </p>

      {/* Step Indicator */}
      {step !== "idle" && step !== "error" && step !== "success" && (
        <div className="flex items-center gap-2 mb-5">
          {STEPS.map((s, i) => {
            const status = getStepStatus(s.key);
            return (
              <div key={s.key} className="flex items-center gap-2 flex-1">
                <div className="flex items-center gap-2 flex-1">
                  <div
                    className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold shrink-0 ${
                      status === "completed"
                        ? "bg-green-600 text-white"
                        : status === "active"
                        ? "bg-blue-600 text-white"
                        : "bg-gray-100 dark:bg-gray-800 text-gray-400 dark:text-gray-500"
                    }`}
                  >
                    {status === "completed" ? (
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                    ) : (
                      s.number
                    )}
                  </div>
                  <span className={`text-xs font-medium ${status === "active" ? "text-blue-600" : status === "completed" ? "text-green-600" : "text-gray-400 dark:text-gray-500"}`}>
                    {s.label}
                  </span>
                </div>
                {i < STEPS.length - 1 && (
                  <div className={`h-px flex-1 ${status === "completed" ? "bg-green-300" : "bg-gray-200 dark:bg-gray-700"}`} />
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Success State */}
      {step === "success" && payout !== null ? (
        <div className="bg-green-50 dark:bg-green-900/30 border border-green-200 rounded-lg p-6 text-center">
          <div className="text-3xl font-bold text-green-700 mb-1">
            {(() => {
              const w = payout / 1_000_000n;
              const f = (payout % 1_000_000n) * 100n / 1_000_000n;
              return `${w}.${f.toString().padStart(2, "0")} cUSDT`;
            })()}
          </div>
          <div className="text-sm text-green-600 font-medium">Redeemed successfully</div>
        </div>
      ) : (
        <button
          onClick={handleRedeem}
          disabled={step !== "idle" && step !== "error"}
          className="w-full bg-green-600 hover:bg-green-700 text-white py-3 rounded-lg text-sm font-semibold transition-colors disabled:opacity-40"
        >
          {step === "idle" || step === "error"
            ? "Claim Winnings"
            : step === "requesting"
            ? "Requesting..."
            : step === "decrypting"
            ? "Decrypting via KMS..."
            : "Finalizing..."}
        </button>
      )}

      {/* Error State */}
      {error && (
        <div className="mt-3 bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 rounded-lg p-3 flex items-center justify-between">
          <span className="text-sm text-red-800">{error}</span>
          <button
            onClick={() => { setStep("idle"); setError(""); }}
            className="text-sm text-red-600 font-medium hover:text-red-700 underline ml-3"
          >
            Retry
          </button>
        </div>
      )}
    </div>
  );
}
