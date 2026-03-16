"use client";

import Link from "next/link";
import { useState, useEffect } from "react";
import type { Market } from "../lib/constants";
import { priceToPercent, formatPrice } from "../lib/constants";
import { useBtcPrice } from "../hooks/useBtcPrice";

function formatCountdown(deadline: number): string {
  const now = Math.floor(Date.now() / 1000);
  const diff = deadline - now;
  if (diff <= 0) return "Ended";
  const h = Math.floor(diff / 3600);
  const m = Math.floor((diff % 3600) / 60);
  const s = diff % 60;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m ${s}s`;
}

export default function QuickMarketCard({ market }: { market: Market }) {
  const { price: btcPrice, isLoading: priceLoading } = useBtcPrice();
  const yesPercent = priceToPercent(market.yesPrice);
  const noPercent = priceToPercent(market.noPrice);

  // Auto-update countdown every second
  const [countdown, setCountdown] = useState(formatCountdown(market.deadline));
  useEffect(() => {
    const interval = setInterval(() => {
      setCountdown(formatCountdown(market.deadline));
    }, 1000);
    return () => clearInterval(interval);
  }, [market.deadline]);

  const isEnded = market.deadline <= Math.floor(Date.now() / 1000);

  return (
    <Link href={`/market/${market.id}`}>
      <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm hover:shadow-lg hover:border-blue-300 dark:hover:border-blue-500 p-4 transition-all duration-200 cursor-pointer min-w-[280px] group">
        {/* Title row */}
        <div className="flex items-center justify-between mb-3">
          <span className="text-sm font-medium text-gray-900 dark:text-gray-100 group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors">BTC 1-Hour</span>
          <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
            isEnded
              ? "bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400"
              : "bg-orange-50 dark:bg-orange-900/30 text-orange-600 border border-orange-200"
          }`}>
            {countdown}
          </span>
        </div>

        {/* Live BTC price */}
        <div className="mb-3">
          <div className="text-xs text-gray-400 dark:text-gray-500 mb-0.5">Live BTC/USD</div>
          <div className="text-xl font-bold text-gray-900 dark:text-gray-100">
            {priceLoading ? "..." : `$${btcPrice.toLocaleString(undefined, { maximumFractionDigits: 0 })}`}
          </div>
        </div>

        {/* Resolution status */}
        {market.resolved && (
          <div className="mb-3">
            <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${
              market.outcome
                ? "bg-green-50 dark:bg-green-900/30 text-green-600 border border-green-200"
                : "bg-red-50 dark:bg-red-900/30 text-red-500 border border-red-200"
            }`}>
              {market.outcome ? "UP" : "DOWN"}
            </span>
          </div>
        )}

        {/* YES / NO prices */}
        <div className="flex gap-2">
          <div className="flex-1 bg-green-50 dark:bg-green-900/30 rounded-lg p-2 text-center">
            <div className="text-xs text-green-600 mb-0.5">Yes (Up)</div>
            <div className="text-sm font-bold text-green-700">{formatPrice(market.yesPrice)}</div>
            <div className="text-xs text-green-500">{yesPercent.toFixed(0)}%</div>
          </div>
          <div className="flex-1 bg-red-50 dark:bg-red-900/30 rounded-lg p-2 text-center">
            <div className="text-xs text-red-500 mb-0.5">No (Down)</div>
            <div className="text-sm font-bold text-red-600">{formatPrice(market.noPrice)}</div>
            <div className="text-xs text-red-400">{noPercent.toFixed(0)}%</div>
          </div>
        </div>
      </div>
    </Link>
  );
}
