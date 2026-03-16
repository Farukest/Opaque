"use client";

import { useState } from "react";
import { useAccount, useWriteContract, usePublicClient, useChainId, useReadContract } from "wagmi";
import { OPAQUE_MARKET_ABI, CUSDT_ABI } from "../lib/contracts";
import { CONTRACTS, formatPrice } from "../lib/constants";
import { sepolia } from "wagmi/chains";
import { getFHEInstance, toHex } from "../lib/fhe";
import Link from "next/link";

interface TradingPanelProps {
  marketAddress: string;
  resolved: boolean;
  yesPrice: number;
  noPrice: number;
  onSuccess?: () => void;
}

type Side = "buy" | "sell";
type Book = "YES" | "NO";
type TxStep = "idle" | "approving" | "encrypting" | "submitting" | "success" | "error";

const BPS = 10_000;
const PRICE_TO_USDT = 100;

export default function TradingPanel({ marketAddress, resolved, yesPrice, noPrice, onSuccess }: TradingPanelProps) {
  const [side, setSide] = useState<Side>("buy");
  const [book, setBook] = useState<Book>("YES");
  const [price, setPrice] = useState("");
  const [size, setSize] = useState("");
  const [step, setStep] = useState<TxStep>("idle");
  const [error, setError] = useState("");

  const { address: userAddress, isConnected } = useAccount();
  const { writeContractAsync } = useWriteContract();
  const publicClient = usePublicClient();
  const chainId = useChainId();

  // Read cUSDT balance handle (encrypted — just to check if > 0)
  const { data: cUSDTHandle } = useReadContract({
    address: CONTRACTS.CUSDT,
    abi: CUSDT_ABI,
    functionName: "balanceOf",
    args: userAddress ? [userAddress] : undefined,
    query: { enabled: !!userAddress, refetchInterval: 10_000 },
  });

  const hasBalance = cUSDTHandle ? (cUSDTHandle as bigint) > 0n : false;
  const suggestedPrice = book === "YES" ? yesPrice : noPrice;

  async function handleSubmit() {
    if (!publicClient || !userAddress || !price || !size) return;
    setError("");

    if (chainId !== sepolia.id) {
      setError("Please switch to Sepolia network");
      return;
    }

    // Accept both formats: dollar (0.35) or cents (35) — normalize to BPS
    const rawPrice = parseFloat(price);
    const priceNum = rawPrice < 1
      ? Math.round(rawPrice * 10000)   // dollar format: 0.35 → 3500 BPS
      : Math.round(rawPrice * 100);    // cent/percent format: 35 → 3500 BPS
    const sizeNum = parseInt(size, 10);

    if (priceNum < 100 || priceNum > 9900) {
      setError("Price must be between $0.01 (1%) and $0.99 (99%)");
      return;
    }
    if (sizeNum <= 0 || sizeNum > 10_000) {
      setError("Size must be between 1 and 10,000 shares");
      return;
    }

    try {
      setStep("approving");
      const isBid = side === "buy";
      const escrowAmount = isBid
        ? priceNum * PRICE_TO_USDT * sizeNum
        : (BPS - priceNum) * PRICE_TO_USDT * sizeNum;

      const approveHash = await writeContractAsync({
        address: CONTRACTS.CUSDT,
        abi: CUSDT_ABI,
        functionName: "approvePlaintext",
        args: [marketAddress as `0x${string}`, BigInt(escrowAmount)],
      });
      await publicClient.waitForTransactionReceipt({ hash: approveHash });

      setStep("encrypting");
      const fhe = await getFHEInstance();
      if (!fhe) throw new Error("FHE initialization failed");
      const sideValue = book === "YES" ? 0 : 1;

      const sideInput = fhe.createEncryptedInput(marketAddress, userAddress);
      sideInput.add8(sideValue);
      const encryptedSide = await sideInput.encrypt();
      if (!encryptedSide?.handles?.[0] || !encryptedSide?.inputProof) {
        throw new Error("Side encryption failed");
      }

      const amountInput = fhe.createEncryptedInput(marketAddress, userAddress);
      amountInput.add64(BigInt(sizeNum));
      const encryptedAmount = await amountInput.encrypt();
      if (!encryptedAmount?.handles?.[0] || !encryptedAmount?.inputProof) {
        throw new Error("Amount encryption failed");
      }

      const encSide = toHex(encryptedSide.handles[0]);
      const sideProof = toHex(encryptedSide.inputProof);
      const encAmount = toHex(encryptedAmount.handles[0]);
      const amountProof = toHex(encryptedAmount.inputProof);

      setStep("submitting");
      const txHash = await writeContractAsync({
        address: marketAddress as `0x${string}`,
        abi: OPAQUE_MARKET_ABI,
        functionName: "placeOrder",
        args: [encSide, priceNum, isBid, encAmount, sideProof, amountProof],
      });
      await publicClient.waitForTransactionReceipt({ hash: txHash });

      setStep("success");
      setPrice("");
      setSize("");
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

  if (resolved) {
    return (
      <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm p-6 text-center">
        <p className="text-gray-500 dark:text-gray-400 text-sm">Market resolved. Trading is closed.</p>
      </div>
    );
  }

  if (!isConnected) {
    return (
      <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm p-6 text-center">
        <p className="text-gray-500 dark:text-gray-400 text-sm">Connect wallet to trade</p>
      </div>
    );
  }

  const priceDisplay = parseFloat(price) || 0;

  return (
    <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm p-6">
      {/* cUSDT Balance Bar */}
      <div className="bg-gray-50 dark:bg-gray-800 rounded-lg px-3 py-2.5 mb-4">
        <div className="flex items-center justify-between">
          <span className="text-xs text-gray-400 dark:text-gray-500 font-medium">Available</span>
          <div className="flex items-center gap-1.5">
            <svg className="w-3.5 h-3.5 text-gray-400 dark:text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
            </svg>
            <span className="text-sm font-semibold text-gray-900 dark:text-gray-100">
              {hasBalance ? "Encrypted" : "0.00"} cUSDT
            </span>
          </div>
        </div>
        {!hasBalance && (
          <div className="mt-1.5 pt-1.5 border-t border-gray-200 dark:border-gray-700">
            <Link href="/portfolio" className="text-xs text-blue-600 hover:text-blue-700 font-medium">
              Get cUSDT from faucet
            </Link>
          </div>
        )}
      </div>

      {/* Buy / Sell Tabs */}
      <div className="flex border-b border-gray-100 dark:border-gray-800 mb-5">
        <button
          onClick={() => setSide("buy")}
          className={`flex-1 pb-2.5 text-sm font-medium transition-colors border-b-2 ${
            side === "buy"
              ? "border-green-600 text-green-600"
              : "border-transparent text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300"
          }`}
        >
          Buy
        </button>
        <button
          onClick={() => setSide("sell")}
          className={`flex-1 pb-2.5 text-sm font-medium transition-colors border-b-2 ${
            side === "sell"
              ? "border-red-600 text-red-600"
              : "border-transparent text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300"
          }`}
        >
          Sell
        </button>
      </div>

      {/* YES / NO Side Selector */}
      <div className="flex gap-2 mb-5">
        <button
          onClick={() => setBook("YES")}
          className={`flex-1 py-2.5 rounded-lg text-sm font-medium transition-colors border ${
            book === "YES"
              ? "bg-green-50 dark:bg-green-900/30 text-green-600 border-green-200"
              : "bg-white dark:bg-gray-900 text-gray-500 dark:text-gray-400 border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800"
          }`}
        >
          YES
        </button>
        <button
          onClick={() => setBook("NO")}
          className={`flex-1 py-2.5 rounded-lg text-sm font-medium transition-colors border ${
            book === "NO"
              ? "bg-red-50 dark:bg-red-900/30 text-red-600 border-red-200"
              : "bg-white dark:bg-gray-900 text-gray-500 dark:text-gray-400 border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800"
          }`}
        >
          NO
        </button>
      </div>

      {/* Price Input */}
      <div className="mb-4">
        <label className="text-xs font-medium uppercase tracking-wider text-gray-400 dark:text-gray-500 block mb-1.5">
          Price per share
        </label>
        <div className="relative flex items-center">
          <button
            onClick={() => {
              const cur = parseFloat(price) || 0;
              const next = cur < 1 ? Math.max(0.01, cur - 0.01) : Math.max(1, cur - 1);
              setPrice(next < 1 ? next.toFixed(2) : String(next));
            }}
            className="absolute left-0 h-full px-3 text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 transition-colors text-lg font-medium"
          >
            -
          </button>
          <span className="absolute left-10 text-gray-400 dark:text-gray-500 text-sm pointer-events-none">$</span>
          <input
            type="number"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            placeholder={`0.${(suggestedPrice / 100).toFixed(0).padStart(2, "0")}`}
            min="0.01"
            max="0.99"
            step="0.01"
            className="w-full bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg pl-14 pr-14 py-2.5 text-gray-900 dark:text-gray-100 text-sm text-center focus:border-blue-500 focus:ring-1 focus:ring-blue-500 focus:outline-none"
          />
          <button
            onClick={() => {
              const cur = parseFloat(price) || 0;
              const next = cur < 1 ? Math.min(0.99, cur + 0.01) : Math.min(99, cur + 1);
              setPrice(next < 1 ? next.toFixed(2) : String(next));
            }}
            className="absolute right-0 h-full px-3 text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 transition-colors text-lg font-medium"
          >
            +
          </button>
        </div>
        <div className="flex gap-1.5 mt-2">
          {[0.10, 0.25, 0.50, 0.75, 0.90].map((p) => (
            <button
              key={p}
              onClick={() => setPrice(p.toFixed(2))}
              className="text-xs px-2.5 py-1 rounded-md bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
            >
              {Math.round(p * 100)}%
            </button>
          ))}
        </div>
      </div>

      {/* Size Input */}
      <div className="mb-4">
        <label className="text-xs font-medium uppercase tracking-wider text-gray-400 dark:text-gray-500 block mb-1.5">
          Shares (encrypted)
        </label>
        <div className="relative">
          <input
            type="number"
            value={size}
            onChange={(e) => setSize(e.target.value)}
            placeholder="e.g. 10"
            min="1"
            step="1"
            className="w-full bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg px-3 pr-16 py-2.5 text-gray-900 dark:text-gray-100 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 focus:outline-none"
          />
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-gray-500 text-sm">shares</span>
        </div>
        <div className="flex gap-1.5 mt-2">
          {[1, 5, 10, 50, 100].map((s) => (
            <button
              key={s}
              onClick={() => setSize(s.toString())}
              className="text-xs px-2.5 py-1 rounded-md bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      {/* Cost Summary */}
      {price && size && (
        <div className="border-t border-gray-100 dark:border-gray-800 pt-3 mb-4 space-y-1.5">
          <div className="flex justify-between text-sm">
            <span className="text-gray-500 dark:text-gray-400">Estimated cost</span>
            <span className="text-gray-900 dark:text-gray-100 font-medium">
              {(() => {
                const rawP = parseFloat(price);
                const priceBps = BigInt(rawP < 1 ? Math.round(rawP * 10000) : Math.round(rawP * 100));
                const sizeBI = BigInt(parseInt(size) || 0);
                const escrow = side === "buy"
                  ? priceBps * BigInt(PRICE_TO_USDT) * sizeBI
                  : (BigInt(BPS) - priceBps) * BigInt(PRICE_TO_USDT) * sizeBI;
                const wholePart = escrow / 1_000_000n;
                const fracPart = (escrow % 1_000_000n) * 100n / 1_000_000n;
                return `$${wholePart}.${fracPart.toString().padStart(2, "0")}`;
              })()}
            </span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-gray-500 dark:text-gray-400">To win</span>
            <span className="text-green-600 font-medium">
              ${BigInt(parseInt(size) || 0).toString()}.00
            </span>
          </div>
        </div>
      )}

      {/* Place Order Button */}
      <button
        onClick={handleSubmit}
        disabled={step !== "idle" && step !== "error" || !price || !size}
        className={`w-full py-2.5 rounded-lg text-sm font-medium transition-colors disabled:opacity-40 ${
          side === "buy"
            ? "bg-green-600 hover:bg-green-700 text-white"
            : "bg-red-600 hover:bg-red-700 text-white"
        }`}
      >
        {step === "idle" || step === "error"
          ? "Place Order"
          : step === "approving"
          ? "Approving cUSDT..."
          : step === "encrypting"
          ? "Encrypting side + size..."
          : step === "submitting"
          ? "Submitting order..."
          : "Order placed!"}
      </button>

      {step !== "idle" && step !== "error" && step !== "success" && (
        <p className="text-xs text-gray-400 dark:text-gray-500 mt-2 text-center">
          Step {step === "approving" ? "1/3" : step === "encrypting" ? "2/3" : "3/3"}: {
            step === "approving" ? "Approving cUSDT spend" :
            step === "encrypting" ? "Encrypting order data" :
            "Submitting to chain"
          }
        </p>
      )}

      {step === "idle" && (
        <p className="text-xs text-gray-400 dark:text-gray-500 mt-2 text-center">
          Requires 2 wallet confirmations: approve + order
        </p>
      )}

      {step === "success" && (
        <div className="mt-3 text-sm text-green-600 text-center font-medium">
          Order placed successfully!
        </div>
      )}

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

      <div className="mt-3 text-xs text-gray-400 dark:text-gray-500 text-center">
        Your side (YES/NO) and order size are FHE-encrypted. Only the price is public.
      </div>
    </div>
  );
}
