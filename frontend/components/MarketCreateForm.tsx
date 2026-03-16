"use client";

import { useState } from "react";
import { useAccount, useWriteContract, usePublicClient } from "wagmi";
import { decodeEventLog } from "viem";
import { CONTRACTS, TOPIC_CATEGORIES } from "../lib/constants";
import { MARKET_FACTORY_ABI } from "../lib/contracts";

const SOURCE_TYPES = [
  { value: "onchain_oracle", label: "On-chain Oracle (Chainlink)", desc: "Automated price feeds" },
  { value: "api_verifiable", label: "API Verifiable", desc: "Publicly verifiable API" },
  { value: "manual_multisig", label: "Manual Multi-sig", desc: "Committee resolution" },
];

type Status = "idle" | "creating" | "success" | "error";

export default function MarketCreateForm() {
  const [question, setQuestion] = useState("");
  const [deadlineDuration, setDeadlineDuration] = useState("30d");
  const [source, setSource] = useState("");
  const [sourceType, setSourceType] = useState("onchain_oracle");
  const [criteria, setCriteria] = useState("");
  const [category, setCategory] = useState("crypto");
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState("");
  const [txHash, setTxHash] = useState("");
  const [newMarketAddress, setNewMarketAddress] = useState("");
  const [newMarketIndex, setNewMarketIndex] = useState<number | null>(null);

  const { isConnected } = useAccount();
  const { writeContractAsync } = useWriteContract();
  const publicClient = usePublicClient();

  // Clear success/error banner when user starts editing
  function clearBanner() {
    if (status === "success" || status === "error") {
      setStatus("idle");
      setError("");
    }
  }

  async function handleCreate() {
    if (!question || !source || !criteria) {
      setError("All fields are required");
      setStatus("error");
      return;
    }
    if (!isConnected) {
      setError("Connect your wallet first");
      setStatus("error");
      return;
    }

    setStatus("creating");
    setError("");

    try {
      const durationSeconds = deadlineDuration === "1h" ? 3900
        : deadlineDuration === "4h" ? 14700
        : Number(deadlineDuration.replace("d", "")) * 86400;
      const deadlineTimestamp = BigInt(Math.floor(Date.now() / 1000) + durationSeconds);

      const hash = await writeContractAsync({
        address: CONTRACTS.MARKET_FACTORY,
        abi: MARKET_FACTORY_ABI,
        functionName: "createMarket",
        args: [question, deadlineTimestamp, source, sourceType, criteria, category],
      });

      setTxHash(hash);

      if (publicClient) {
        const receipt = await publicClient.waitForTransactionReceipt({ hash });

        // Extract market address from MarketCreated event using viem decodeEventLog
        for (const log of receipt.logs) {
          try {
            const decoded = decodeEventLog({
              abi: MARKET_FACTORY_ABI,
              data: log.data,
              topics: log.topics,
            });
            if (decoded.eventName === "MarketCreated" && decoded.args) {
              const args = decoded.args as { market?: `0x${string}`; marketIndex?: bigint };
              if (args.market) {
                setNewMarketAddress(args.market);
                if (args.marketIndex !== undefined) {
                  setNewMarketIndex(Number(args.marketIndex));
                }
                break;
              }
            }
          } catch {
            // Not a MarketCreated event, skip
          }
        }
      }

      setStatus("success");
      setQuestion("");
      setSource("");
      setCriteria("");
      setDeadlineDuration("30d");
      setSourceType("onchain_oracle");
      setCategory("crypto");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Transaction failed";
      if (msg.includes("User rejected") || msg.includes("denied")) {
        setError("Transaction rejected");
      } else {
        setError(msg.length > 120 ? msg.slice(0, 120) + "..." : msg);
      }
      setStatus("error");
    }
  }

  return (
    <div className="space-y-6">
      {/* Question */}
      <div>
        <label className="text-sm font-medium text-gray-900 dark:text-gray-100 mb-1.5 block">
          Prediction Question <span className="text-red-500">*</span>
        </label>
        <input
          type="text"
          value={question}
          onChange={(e) => { setQuestion(e.target.value); clearBanner(); }}
          placeholder='e.g., "BTC exceeds $200K by Dec 2026?"'
          className="w-full bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2.5 text-gray-900 dark:text-gray-100 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 focus:outline-none placeholder-gray-400 dark:placeholder-gray-500"
        />
      </div>

      {/* Deadline - Pill style */}
      <div>
        <label className="text-sm font-medium text-gray-900 dark:text-gray-100 mb-1.5 block">Market Duration</label>
        <div className="flex gap-2">
          {["1h", "4h", "7d", "14d", "30d", "90d"].map((d) => (
            <button
              key={d}
              onClick={() => setDeadlineDuration(d)}
              className={`flex-1 py-2 rounded-full text-sm font-medium transition-all ${
                deadlineDuration === d
                  ? "bg-blue-600 text-white shadow-sm"
                  : "bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700"
              }`}
            >
              {d}
            </button>
          ))}
        </div>
      </div>

      {/* Category */}
      <div>
        <label className="text-sm font-medium text-gray-900 dark:text-gray-100 mb-1.5 block">Category</label>
        <div className="flex flex-wrap gap-2">
          {TOPIC_CATEGORIES.filter((c) => c.value !== "all").map((c) => (
            <button
              key={c.value}
              onClick={() => setCategory(c.value)}
              className={`px-3 py-1.5 rounded-full text-sm font-medium transition-all ${
                category === c.value
                  ? "bg-blue-600 text-white shadow-sm"
                  : "bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700"
              }`}
            >
              {c.label}
            </button>
          ))}
        </div>
      </div>

      {/* Resolution Source Type - Card style */}
      <div>
        <label className="text-sm font-medium text-gray-900 dark:text-gray-100 mb-1.5 block">
          Resolution Type <span className="text-red-500">*</span>
        </label>
        <div className="grid grid-cols-3 gap-2">
          {SOURCE_TYPES.map((st) => (
            <button
              key={st.value}
              onClick={() => setSourceType(st.value)}
              className={`p-3 rounded-lg text-left transition-all ${
                sourceType === st.value
                  ? "bg-blue-50 dark:bg-blue-900/30 border-2 border-blue-500 ring-1 ring-blue-200"
                  : "bg-white dark:bg-gray-900 border-2 border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600"
              }`}
            >
              <div className={`text-xs font-semibold mb-0.5 ${sourceType === st.value ? "text-blue-700" : "text-gray-900 dark:text-gray-100"}`}>
                {st.label}
              </div>
              <div className={`text-[11px] ${sourceType === st.value ? "text-blue-600" : "text-gray-400 dark:text-gray-500"}`}>
                {st.desc}
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Resolution Source */}
      <div>
        <label className="text-sm font-medium text-gray-900 dark:text-gray-100 mb-1.5 block">
          Resolution Source <span className="text-red-500">*</span>
        </label>
        <input
          type="text"
          value={source}
          onChange={(e) => { setSource(e.target.value); clearBanner(); }}
          placeholder='e.g., "Chainlink BTC/USD Price Feed"'
          className="w-full bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2.5 text-gray-900 dark:text-gray-100 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 focus:outline-none placeholder-gray-400 dark:placeholder-gray-500"
        />
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-1.5">
          Every market must have a verifiable resolution source. This prevents oracle manipulation.
        </p>
      </div>

      {/* Resolution Criteria - Textarea */}
      <div>
        <label className="text-sm font-medium text-gray-900 dark:text-gray-100 mb-1.5 block">
          Resolution Criteria <span className="text-red-500">*</span>
        </label>
        <textarea
          value={criteria}
          onChange={(e) => { setCriteria(e.target.value); clearBanner(); }}
          placeholder='e.g., "Resolves YES if BTC/USD price feed reads >= 200000 at any point before deadline"'
          rows={3}
          className="w-full bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2.5 text-gray-900 dark:text-gray-100 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 focus:outline-none placeholder-gray-400 dark:placeholder-gray-500 resize-none"
        />
      </div>

      {/* Info Box */}
      <div className="bg-blue-50 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
        <p className="text-sm font-medium text-blue-800 mb-1">Source-Mandatory Design</p>
        <p className="text-xs text-blue-700">
          Unlike Polymarket, every Opaque market requires a verifiable resolution source at creation.
          This eliminates ~90% of oracle problems by making outcomes deterministically verifiable.
        </p>
      </div>

      {/* Success Message */}
      {status === "success" && (
        <div className="bg-green-50 dark:bg-green-900/30 border border-green-200 dark:border-green-800 rounded-lg p-4">
          <p className="text-sm font-medium text-green-800">Market created successfully!</p>
          {newMarketAddress && (
            <p className="text-xs text-green-600 mt-1 font-mono">{newMarketAddress}</p>
          )}
          {newMarketIndex !== null && (
            <a
              href={`/market/${newMarketIndex}`}
              className="inline-block text-sm text-blue-600 hover:text-blue-700 font-medium mt-2 hover:underline"
            >
              View Market &rarr;
            </a>
          )}
          {txHash && (
            <a
              href={`https://sepolia.etherscan.io/tx/${txHash}`}
              target="_blank"
              rel="noopener noreferrer"
              className="block text-xs text-green-600 hover:text-green-700 mt-1.5 underline"
            >
              View on Etherscan
            </a>
          )}
        </div>
      )}

      {/* Error Message */}
      {status === "error" && error && (
        <div className="bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 rounded-lg p-4 text-sm text-red-800 dark:text-red-400">
          {error}
        </div>
      )}

      {/* Submit */}
      <button
        onClick={handleCreate}
        disabled={!question || !source || !criteria || !isConnected || status === "creating"}
        className="w-full bg-blue-600 hover:bg-blue-700 text-white py-3 rounded-lg font-semibold transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
      >
        {!isConnected
          ? "Connect Wallet First"
          : status === "creating"
            ? "Creating Market..."
            : "Create Market"}
      </button>
    </div>
  );
}
