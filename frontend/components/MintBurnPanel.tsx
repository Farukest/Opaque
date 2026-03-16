"use client";

import { useState } from "react";
import { useAccount, useWriteContract, usePublicClient, useChainId } from "wagmi";
import { OPAQUE_MARKET_ABI, CUSDT_ABI } from "../lib/contracts";
import { CONTRACTS } from "../lib/constants";
import { sepolia } from "wagmi/chains";
import { getFHEInstance, toHex } from "../lib/fhe";

interface MintBurnPanelProps {
  marketAddress: string;
  resolved: boolean;
  onSuccess?: () => void;
}

type Mode = "mint" | "burn";
type TxStep = "idle" | "approving" | "encrypting" | "submitting" | "success" | "error";

export default function MintBurnPanel({ marketAddress, resolved, onSuccess }: MintBurnPanelProps) {
  const [mode, setMode] = useState<Mode>("mint");
  const [amount, setAmount] = useState("");
  const [step, setStep] = useState<TxStep>("idle");
  const [error, setError] = useState("");

  const { address: userAddress, isConnected } = useAccount();
  const { writeContractAsync } = useWriteContract();
  const publicClient = usePublicClient();
  const chainId = useChainId();

  async function handleSubmit() {
    if (!publicClient || !userAddress || !amount) return;
    setError("");

    if (chainId !== sepolia.id) {
      setError("Please switch to Sepolia network");
      return;
    }

    const shareCount = parseInt(amount, 10); // Number of shares to mint/burn
    if (shareCount <= 0 || isNaN(shareCount)) {
      setError("Amount must be greater than 0");
      return;
    }

    try {
      if (mode === "mint") {
        // Approve cUSDT first
        setStep("approving");
        const approveHash = await writeContractAsync({
          address: CONTRACTS.CUSDT,
          abi: CUSDT_ABI,
          functionName: "approvePlaintext",
          args: [marketAddress as `0x${string}`, BigInt(shareCount * 1_000_000)],
        });
        await publicClient.waitForTransactionReceipt({ hash: approveHash });
      }

      // Encrypt amount
      setStep("encrypting");
      const fhe = await getFHEInstance();
      if (!fhe) throw new Error("FHE initialization failed");
      const input = fhe.createEncryptedInput(marketAddress, userAddress);
      input.add64(BigInt(shareCount * 1_000_000)); // Convert shares to micro-cUSDT (SHARE_UNIT)
      const encrypted = await input.encrypt();

      const handle = toHex(encrypted.handles[0]);
      const proof = toHex(encrypted.inputProof);

      // Submit
      setStep("submitting");
      const fnName = mode === "mint" ? "mintShares" : "burnShares";
      const txHash = await writeContractAsync({
        address: marketAddress as `0x${string}`,
        abi: OPAQUE_MARKET_ABI,
        functionName: fnName,
        args: [handle, proof],
      });
      await publicClient.waitForTransactionReceipt({ hash: txHash });

      setStep("success");
      setAmount("");
      onSuccess?.();
      setTimeout(() => setStep("idle"), 3000);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Transaction failed";
      const isUserRejection = (m: string) =>
        m.includes("User rejected") ||
        m.includes("user rejected") ||
        m.includes("denied") ||
        m.includes("ACTION_REJECTED") ||
        m.includes("User denied");
      if (isUserRejection(msg)) {
        setError("Transaction rejected");
      } else {
        setError(msg.length > 100 ? msg.slice(0, 100) + "..." : msg);
      }
      setStep("error");
    }
  }

  if (resolved) return null;
  if (!isConnected) return null;

  return (
    <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm p-6">
      {/* Mint / Burn Tabs */}
      <div className="flex border-b border-gray-100 dark:border-gray-800 mb-5">
        <button
          onClick={() => setMode("mint")}
          className={`flex-1 pb-2.5 text-sm font-medium transition-colors border-b-2 ${
            mode === "mint"
              ? "border-blue-600 text-blue-600"
              : "border-transparent text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300"
          }`}
        >
          Mint Shares
        </button>
        <button
          onClick={() => setMode("burn")}
          className={`flex-1 pb-2.5 text-sm font-medium transition-colors border-b-2 ${
            mode === "burn"
              ? "border-blue-600 text-blue-600"
              : "border-transparent text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300"
          }`}
        >
          Burn Shares
        </button>
      </div>

      {/* Info Text */}
      <div className="bg-gray-50 dark:bg-gray-800 rounded-lg px-4 py-3 mb-4">
        <p className="text-sm text-gray-600 dark:text-gray-400">
          {mode === "mint"
            ? "Deposit cUSDT to receive equal YES + NO shares."
            : "Return equal YES + NO shares to receive cUSDT back."}
        </p>
        <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">1 cUSDT = 1 YES + 1 NO share</p>
      </div>

      {/* Amount Input */}
      <div className="mb-4">
        <label className="text-xs font-medium uppercase tracking-wider text-gray-400 dark:text-gray-500 block mb-1.5">
          Number of shares
        </label>
        <div className="relative">
          <input
            type="number"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="Enter amount"
            min="1"
            step="1"
            className="w-full bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg px-3 pr-16 py-2.5 text-gray-900 dark:text-gray-100 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 focus:outline-none"
          />
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-gray-500 text-sm">shares</span>
        </div>
        <div className="flex gap-1.5 mt-2">
          {[1, 5, 10, 50, 100].map((a) => (
            <button
              key={a}
              onClick={() => setAmount(a.toString())}
              className="text-xs px-2.5 py-1 rounded-md bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
            >
              {a}
            </button>
          ))}
        </div>
      </div>

      {/* Cost preview for mint */}
      {amount && (
        <div className="border-t border-gray-100 dark:border-gray-800 pt-3 mb-4">
          <div className="flex justify-between text-sm">
            <span className="text-gray-500 dark:text-gray-400">{mode === "mint" ? "Cost" : "You receive"}</span>
            <span className="text-gray-900 dark:text-gray-100 font-medium">{amount} cUSDT</span>
          </div>
        </div>
      )}

      {/* Submit Button */}
      <button
        onClick={handleSubmit}
        disabled={(step !== "idle" && step !== "error") || !amount}
        className="w-full bg-blue-600 hover:bg-blue-700 text-white rounded-lg px-4 py-2.5 text-sm font-medium transition-colors disabled:opacity-40"
      >
        {step === "idle" || step === "error"
          ? `${mode === "mint" ? "Mint" : "Burn"} ${amount || "..."} Shares`
          : step === "approving"
          ? "Approving cUSDT..."
          : step === "encrypting"
          ? "Encrypting amount..."
          : step === "submitting"
          ? "Submitting..."
          : `${mode === "mint" ? "Minted" : "Burned"} successfully!`}
      </button>

      {mode === "mint" && step === "idle" && (
        <p className="text-xs text-gray-400 dark:text-gray-500 mt-2 text-center">
          Requires 2 confirmations: approve + mint
        </p>
      )}

      {/* Error */}
      {error && (
        <div className="mt-3 flex items-center justify-center gap-2 text-sm text-red-600">
          <span>{error}</span>
          <button
            onClick={() => { setStep("idle"); setError(""); }}
            className="text-red-600 underline hover:text-red-700"
          >
            Retry
          </button>
        </div>
      )}
    </div>
  );
}
