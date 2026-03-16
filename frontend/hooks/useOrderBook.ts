"use client";

import { useState, useEffect } from "react";
import { usePublicClient, useReadContract } from "wagmi";
import { OPAQUE_MARKET_ABI } from "../lib/contracts";
import { parseAbiItem } from "viem";

export interface Trade {
  bidOrderId: number;
  askOrderId: number;
  price: number;
  timestamp: number;
}

const MATCH_ATTEMPTED_EVENT = parseAbiItem(
  "event MatchAttempted(uint256 indexed bidId, uint256 indexed askId, address indexed caller, uint256 timestamp)",
);

export function useOrderBook(marketAddress?: string) {
  const [recentTrades, setRecentTrades] = useState<Trade[]>([]);
  const [isLoadingTrades, setIsLoadingTrades] = useState(false);
  const publicClient = usePublicClient();

  // Read best prices
  const { data: bestPrices, refetch: refetchPrices } = useReadContract({
    address: marketAddress as `0x${string}`,
    abi: OPAQUE_MARKET_ABI,
    functionName: "getBestPrices",
    query: { enabled: !!marketAddress, refetchInterval: 10_000 },
  });

  // Read current price
  const { data: currentPrice } = useReadContract({
    address: marketAddress as `0x${string}`,
    abi: OPAQUE_MARKET_ABI,
    functionName: "getCurrentPrice",
    query: { enabled: !!marketAddress },
  });

  // Fetch recent MatchAttempted events + resolve ask prices (H-FE4 fix)
  useEffect(() => {
    if (!publicClient || !marketAddress) return;

    async function fetchTrades() {
      setIsLoadingTrades(true);
      try {
        const currentBlock = await publicClient!.getBlockNumber();
        const fromBlock = currentBlock > 50000n ? currentBlock - 50000n : 0n;

        const logs = await publicClient!.getLogs({
          address: marketAddress as `0x${string}`,
          event: MATCH_ATTEMPTED_EVENT,
          fromBlock,
          toBlock: "latest",
        });

        // Fetch ask order prices for display
        const trades: Trade[] = await Promise.all(
          logs.map(async (log) => {
            const askId = Number(log.args.askId || 0n);
            let askPrice = 0;
            try {
              const order = (await publicClient!.readContract({
                address: marketAddress as `0x${string}`,
                abi: OPAQUE_MARKET_ABI,
                functionName: "getOrder",
                args: [BigInt(askId)],
              })) as readonly [string, number, boolean, boolean, bigint, bigint];
              askPrice = Number(order[1]); // price field
            } catch {
              // Order read failed, leave price as 0
            }
            return {
              bidOrderId: Number(log.args.bidId || 0n),
              askOrderId: askId,
              price: askPrice,
              timestamp: Number(log.args.timestamp || 0n),
            };
          }),
        );

        setRecentTrades(trades.reverse()); // Most recent first
      } catch {
        setRecentTrades([]);
      }
      setIsLoadingTrades(false);
    }

    fetchTrades();

    // Re-fetch trades every 30 seconds
    const interval = setInterval(fetchTrades, 30_000);
    return () => clearInterval(interval);
  }, [publicClient, marketAddress]);

  const parsed = bestPrices as readonly [number, number] | undefined;
  const prices = currentPrice as readonly [number, number] | undefined;

  return {
    bestBid: parsed ? Number(parsed[0]) : 0,
    bestAsk: parsed ? Number(parsed[1]) : 0,
    yesPrice: prices ? Number(prices[0]) : 5000,
    noPrice: prices ? Number(prices[1]) : 5000,
    recentTrades,
    isLoadingTrades,
    refetchPrices,
  };
}
