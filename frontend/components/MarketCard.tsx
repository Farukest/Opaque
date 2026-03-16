"use client";

import Link from "next/link";
import type { Market } from "../lib/constants";
import { priceToPercent, formatPrice } from "../lib/constants";

function formatDeadline(timestamp: number): string {
  const date = new Date(timestamp * 1000);
  const now = new Date();
  const diff = date.getTime() - now.getTime();

  if (diff < 0) return "Ended";
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h left`;
  if (diff < 2592000000) return `${Math.floor(diff / 86400000)}d left`;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function getSourceLabel(type: string): string {
  switch (type) {
    case "onchain_oracle": return "Oracle";
    case "api_verifiable": return "API";
    case "manual_multisig": return "Manual";
    default: return "Other";
  }
}

export default function MarketCard({ market }: { market: Market }) {
  const yesPercent = priceToPercent(market.yesPrice);
  const yesPercentDisplay = yesPercent.toFixed(0);
  const deadlineLabel = formatDeadline(market.deadline);

  return (
    <Link href={`/market/${market.id}`}>
      <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm hover:shadow-lg hover:border-blue-300 dark:hover:border-blue-500 hover:-translate-y-0.5 p-5 transition-all duration-200 cursor-pointer group">
        {/* Question */}
        <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100 leading-snug mb-4 group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors">
          {market.question}
        </h3>

        {/* Probability bar */}
        <div className="mb-4">
          <div className="flex items-baseline justify-between mb-1.5">
            <span className="text-sm font-semibold text-green-600">
              {yesPercentDisplay}% Yes
            </span>
            {market.resolved && (
              <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${
                market.outcome
                  ? "bg-green-50 dark:bg-green-900/30 text-green-600 border border-green-200"
                  : "bg-red-50 dark:bg-red-900/30 text-red-500 border border-red-200"
              }`}>
                Resolved: {market.outcome ? "YES" : "NO"}
              </span>
            )}
          </div>
          <div className="h-2 rounded-full bg-gray-100 dark:bg-gray-800 overflow-hidden">
            <div
              className="h-full rounded-full bg-green-500 transition-all duration-300"
              style={{ width: `${yesPercent}%` }}
            />
          </div>
        </div>

        {/* Metadata row */}
        <div className="flex items-center gap-2 text-xs text-gray-400 dark:text-gray-500">
          {market.category && (
            <>
              <span className="px-1.5 py-0.5 rounded bg-blue-50 dark:bg-blue-900/30 text-blue-600 font-medium capitalize">{market.category}</span>
              <span className="text-gray-300 dark:text-gray-600">-</span>
            </>
          )}
          <span>{market.totalSharesMinted} shares minted</span>
          <span className="text-gray-300 dark:text-gray-600">-</span>
          <span>Ends {deadlineLabel}</span>
          <span className="text-gray-300 dark:text-gray-600">-</span>
          <span>{getSourceLabel(market.resolutionSourceType)}</span>
          {market.activeOrderCount > 0 && (
            <>
              <span className="text-gray-300 dark:text-gray-600">-</span>
              <span>{market.activeOrderCount} orders</span>
            </>
          )}
        </div>
      </div>
    </Link>
  );
}
