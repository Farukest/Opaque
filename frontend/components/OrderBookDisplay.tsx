"use client";

import { useState } from "react";
import { useAccount, useWriteContract, usePublicClient, useReadContract } from "wagmi";
import { useOrderBook } from "../hooks/useOrderBook";
import { OPAQUE_MARKET_ABI } from "../lib/contracts";
import { formatPrice } from "../lib/constants";

interface OrderBookDisplayProps {
  marketAddress: string;
  resolved: boolean;
  yesPrice: number; // BPS — used for synthetic display when no real trades
  onSuccess?: () => void;
}

export default function OrderBookDisplay({ marketAddress, resolved, yesPrice, onSuccess }: OrderBookDisplayProps) {
  const {
    bestBid, bestAsk,
    recentTrades, isLoadingTrades,
    refetchPrices,
  } = useOrderBook(marketAddress);

  const { address: userAddress } = useAccount();
  const { writeContractAsync } = useWriteContract();
  const publicClient = usePublicClient();
  const [matching, setMatching] = useState(false);
  const [matchResult, setMatchResult] = useState<string | null>(null);

  // Read next order ID for auto-match scanning
  const { data: nextOrderId } = useReadContract({
    address: marketAddress as `0x${string}`,
    abi: OPAQUE_MARKET_ABI,
    functionName: "nextOrderId",
    query: { enabled: !!marketAddress, refetchInterval: 10_000 },
  });

  // Determine if we have real trade activity
  const hasRealTrades = recentTrades.length > 0;

  // Synthetic bid/ask based on demo price (tight spread around market price)
  const spreadBps = Math.max(200, Math.round(yesPrice * 0.06)); // ~6% spread
  const synthBid = Math.max(100, yesPrice - Math.round(spreadBps / 2));
  const synthAsk = Math.min(9900, yesPrice + Math.round(spreadBps / 2));

  // Use real data if there are real trades, otherwise use synthetic
  const displayBid = hasRealTrades && bestBid > 0 ? bestBid : synthBid;
  const displayAsk = hasRealTrades && bestAsk > 0 ? bestAsk : synthAsk;
  const spread = displayAsk - displayBid;

  // Auto-Match: find the best crossing bid/ask pair and attempt ONE match
  async function handleAutoMatch() {
    if (!publicClient || !userAddress) return;
    setMatching(true);
    setMatchResult(null);

    try {
      const totalOrders = Number(nextOrderId || 0n);
      if (totalOrders === 0) {
        setMatchResult("No orders to match");
        setMatching(false);
        return;
      }

      const bids: { id: number; price: number }[] = [];
      const asks: { id: number; price: number }[] = [];

      for (let i = 0; i < totalOrders; i++) {
        try {
          const order = await publicClient.readContract({
            address: marketAddress as `0x${string}`,
            abi: OPAQUE_MARKET_ABI,
            functionName: "getOrder",
            args: [BigInt(i)],
          }) as readonly [string, number, boolean, boolean, bigint, bigint];

          const [, price, isBid, isActive] = order;
          if (!isActive) continue;

          if (isBid) {
            bids.push({ id: i, price: Number(price) });
          } else {
            asks.push({ id: i, price: Number(price) });
          }
        } catch {
          // Skip unreadable orders
        }
      }

      // Sort: best bid (highest) first, best ask (lowest) first
      bids.sort((a, b) => b.price - a.price);
      asks.sort((a, b) => a.price - b.price);

      // Find best crossing pair (bid.price >= ask.price)
      if (bids.length === 0 || asks.length === 0 || bids[0].price < asks[0].price) {
        setMatchResult(`No crossing orders found (${bids.length} bids, ${asks.length} asks)`);
        setMatching(false);
        return;
      }

      // Attempt ONE match with best pair
      const bestBidOrder = bids[0];
      const bestAskOrder = asks[0];
      setMatchResult(`Matching #${bestBidOrder.id} (bid $${(bestBidOrder.price / 100).toFixed(2)}) x #${bestAskOrder.id} (ask $${(bestAskOrder.price / 100).toFixed(2)})...`);

      const hash = await writeContractAsync({
        address: marketAddress as `0x${string}`,
        abi: OPAQUE_MARKET_ABI,
        functionName: "attemptMatch",
        args: [BigInt(bestBidOrder.id), BigInt(bestAskOrder.id)],
      });
      await publicClient.waitForTransactionReceipt({ hash });

      setMatchResult(`Match attempted: #${bestBidOrder.id} x #${bestAskOrder.id} — if sides were opposite, trade executed`);
      refetchPrices();
      onSuccess?.();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Match failed";
      if (msg.includes("User rejected") || msg.includes("denied")) {
        setMatchResult("Transaction rejected");
      } else {
        setMatchResult(msg.length > 80 ? msg.slice(0, 80) + "..." : msg);
      }
    }
    setMatching(false);
  }

  return (
    <div className="space-y-4">
      {/* Order Book */}
      <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm p-6">
        <h4 className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-4">Order Book</h4>

        {/* Table Header */}
        <div className="grid grid-cols-3 text-xs font-medium uppercase tracking-wider text-gray-400 dark:text-gray-500 pb-2 border-b border-gray-100 dark:border-gray-800">
          <span>Side</span>
          <span className="text-right">Price</span>
          <span className="text-right">% Implied</span>
        </div>

        {/* Best Bid */}
        <div className="grid grid-cols-3 items-center py-2.5 bg-green-50/50 dark:bg-green-900/20 -mx-6 px-6">
          <span className="text-sm font-medium text-green-600">Best Bid</span>
          <span className="text-sm font-mono text-gray-900 dark:text-gray-100 text-right">{formatPrice(displayBid)}</span>
          <span className="text-sm font-mono text-green-600 text-right">{(displayBid / 100).toFixed(1)}%</span>
        </div>

        {/* Spread Row */}
        <div className="grid grid-cols-3 items-center py-2 border-y border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 -mx-6 px-6">
          <span className="text-xs font-medium uppercase tracking-wider text-gray-400 dark:text-gray-500">Spread</span>
          <span className="text-sm font-mono text-right text-gray-500 dark:text-gray-400">
            {formatPrice(Math.abs(spread))}
          </span>
          <span className="text-sm font-mono text-right text-gray-400 dark:text-gray-500">
            {(Math.abs(spread) / 100).toFixed(1)}%
          </span>
        </div>

        {/* Best Ask */}
        <div className="grid grid-cols-3 items-center py-2.5 bg-red-50/50 dark:bg-red-900/20 -mx-6 px-6">
          <span className="text-sm font-medium text-red-600">Best Ask</span>
          <span className="text-sm font-mono text-gray-900 dark:text-gray-100 text-right">{formatPrice(displayAsk)}</span>
          <span className="text-sm font-mono text-red-600 text-right">{(displayAsk / 100).toFixed(1)}%</span>
        </div>

        <p className="text-xs text-gray-400 dark:text-gray-500 mt-3 text-center">
          Sides are FHE-encrypted. Only prices are visible.
        </p>
      </div>

      {/* Permissionless Matching */}
      {!resolved && (
        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm p-6">
          <div className="flex items-center gap-2 mb-2">
            <h4 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Permissionless Matching</h4>
            <span className="text-[10px] bg-blue-50 dark:bg-blue-900/30 text-blue-600 px-1.5 py-0.5 rounded font-medium uppercase tracking-wider">Open</span>
          </div>
          <p className="text-xs text-gray-500 dark:text-gray-400 mb-3 leading-relaxed">
            Because order sides are encrypted, a centralized matcher would hold unverifiable
            power — no one could audit if they front-run, suppress, or prioritize their own orders.
            OPAQUE eliminates this risk: anyone can match, and FHE ensures matchers learn nothing.
          </p>

          {userAddress ? (
            <>
              <button
                onClick={handleAutoMatch}
                disabled={matching}
                className="w-full text-sm py-2.5 rounded-lg font-medium transition-colors disabled:opacity-50 border-2 border-blue-600 text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/30"
              >
                {matching ? (
                  <span className="inline-flex items-center gap-2">
                    <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-blue-500 border-r-transparent"></span>
                    Scanning & matching...
                  </span>
                ) : "Match Crossing Orders"}
              </button>
              {matchResult && (
                <p className={`text-xs mt-2 text-center font-medium ${matchResult.includes("Matched") ? "text-green-600" : "text-gray-500 dark:text-gray-400"}`}>
                  {matchResult}
                </p>
              )}
            </>
          ) : (
            <p className="text-xs text-gray-400 dark:text-gray-500 text-center py-2">Connect wallet to match orders</p>
          )}

          <div className="mt-3 pt-3 border-t border-gray-100 dark:border-gray-800">
            <p className="text-[11px] text-gray-400 dark:text-gray-500 leading-relaxed">
              <span className="text-blue-500 font-medium">Coming soon:</span> Protocol will refund gas costs to anyone who successfully matches orders, incentivizing an open ecosystem of matching bots.
            </p>
          </div>
        </div>
      )}

      {/* Recent Trades */}
      <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm p-6">
        <h4 className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-4">
          Recent Matches
          {recentTrades.length > 0 && (
            <span className="text-xs text-gray-400 dark:text-gray-500 font-normal ml-2">({recentTrades.length})</span>
          )}
        </h4>
        {isLoadingTrades ? (
          <div className="flex justify-center py-6">
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-blue-500 border-r-transparent" />
          </div>
        ) : recentTrades.length > 0 ? (
          <div className="space-y-0 max-h-48 overflow-y-auto">
            <div className="grid grid-cols-3 text-xs font-medium uppercase tracking-wider text-gray-400 dark:text-gray-500 pb-2 border-b border-gray-100 dark:border-gray-800">
              <span>Orders</span>
              <span className="text-right">Price</span>
              <span className="text-right">Time</span>
            </div>
            {recentTrades.slice(0, 20).map((trade, i) => (
              <div key={i} className={`grid grid-cols-3 py-2 text-sm ${i % 2 === 0 ? "" : "bg-gray-50 dark:bg-gray-800 -mx-6 px-6"}`}>
                <span className="text-gray-500 dark:text-gray-400 font-mono text-xs">
                  #{trade.bidOrderId} x #{trade.askOrderId}
                </span>
                <span className="text-gray-900 dark:text-gray-100 font-mono text-right">
                  {trade.price > 0 ? formatPrice(trade.price) : "\u2014"}
                </span>
                <span className="text-gray-400 dark:text-gray-500 text-right text-xs">
                  {new Date(trade.timestamp * 1000).toLocaleTimeString("en-US", {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center py-6 text-sm text-gray-400 dark:text-gray-500">
            {resolved ? "Market resolved. No more trades." : "No matches yet. Place the first order!"}
          </div>
        )}
      </div>
    </div>
  );
}
