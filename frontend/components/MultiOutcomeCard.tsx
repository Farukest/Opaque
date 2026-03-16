"use client";

import Image from "next/image";
import Link from "next/link";
import type { MarketGroupData } from "../lib/constants";
import { priceToPercent } from "../lib/constants";
import { getOutcomeMeta } from "../lib/outcomeMeta";

export default function MultiOutcomeCard({ group }: { group: MarketGroupData }) {
  return (
    <Link href={`/group/${encodeURIComponent(group.address)}`}>
      <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm hover:shadow-lg hover:border-blue-300 dark:hover:border-blue-500 hover:-translate-y-0.5 p-5 transition-all duration-200 cursor-pointer group/card">
        {/* Header */}
        <div className="flex items-start justify-between mb-4">
          <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100 leading-snug group-hover/card:text-blue-600 dark:group-hover/card:text-blue-400 transition-colors">
            {group.question}
          </h3>
          <div className="flex items-center gap-2 ml-3 shrink-0">
            <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-purple-50 dark:bg-purple-900/30 text-purple-600 border border-purple-200">
              {group.outcomeCount} outcomes
            </span>
            {group.category && (
              <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-blue-50 dark:bg-blue-900/30 text-blue-600 capitalize">
                {group.category}
              </span>
            )}
          </div>
        </div>

        {/* Resolution badge */}
        {group.resolved && (
          <div className="mb-3">
            <span className="px-2.5 py-1 rounded-full text-xs font-bold bg-green-50 dark:bg-green-900/30 text-green-600 border border-green-200">
              Resolved: {group.outcomes[group.winningIndex]?.label || `#${group.winningIndex}`}
            </span>
          </div>
        )}

        {/* Outcome bars */}
        <div className="space-y-2.5">
          {group.outcomes.map((o, i) => {
            const yesPercent = priceToPercent(o.yesPrice);
            const isWinner = group.resolved && i === group.winningIndex;
            const meta = getOutcomeMeta(o.label);
            return (
              <div key={i}>
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-2">
                    {meta.logo && (
                      <Image src={meta.logo} alt={o.label} width={20} height={20} className="rounded" />
                    )}
                    <span className={`text-sm font-medium ${isWinner ? "text-green-600" : meta.color || "text-gray-700 dark:text-gray-300"}`}>
                      {o.label}
                    </span>
                  </div>
                  <span className={`text-sm font-semibold ${isWinner ? "text-green-600" : "text-gray-500 dark:text-gray-400"}`}>
                    {yesPercent.toFixed(0)}%
                  </span>
                </div>
                <div className="h-2 rounded-full bg-gray-100 dark:bg-gray-800 overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all duration-300 ${
                      isWinner ? "bg-green-500" : "bg-blue-400"
                    }`}
                    style={{ width: `${Math.max(yesPercent, 2)}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </Link>
  );
}
