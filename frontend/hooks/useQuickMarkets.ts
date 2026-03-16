"use client";

import { useMemo } from "react";
import { useMarkets } from "./useMarkets";
import type { Market } from "../lib/constants";

/**
 * Filters markets that are hourly BTC quick markets.
 * Returns quick markets sorted by deadline (nearest first).
 */
export function useQuickMarkets() {
  const { markets, isLoading } = useMarkets();

  const quickMarkets: Market[] = useMemo(() => {
    const now = Math.floor(Date.now() / 1000);
    const btcMarkets = markets
      .filter((m) => {
        const q = m.question.toLowerCase();
        return q.includes("btc") && (q.includes("1 hour") || q.includes("hourly"));
      })
      .sort((a, b) => b.deadline - a.deadline); // newest first

    // Show the latest active market, or the most recent one if all expired
    const active = btcMarkets.filter((m) => m.deadline > now && !m.resolved);
    if (active.length > 0) return active;
    // If no active, show only the most recent (resolved or expired)
    return btcMarkets.slice(0, 1);
  }, [markets]);

  return { quickMarkets, isLoading };
}
