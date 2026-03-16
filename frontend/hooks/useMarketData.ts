"use client";

import { useReadContract } from "wagmi";
import { CONTRACTS, POLL_INTERVAL } from "../lib/constants";
import { MARKET_FACTORY_ABI, OPAQUE_MARKET_ABI } from "../lib/contracts";
import type { Market } from "../lib/constants";
import { seededDemoPrice } from "../lib/demoPrice";

// Fetch a market address by its index in the factory
export function useMarketAddress(index: number) {
  const { data, isLoading } = useReadContract({
    address: CONTRACTS.MARKET_FACTORY,
    abi: MARKET_FACTORY_ABI,
    functionName: "markets",
    args: [BigInt(index)],
    query: { enabled: index >= 0 },
  });

  return {
    address: data as `0x${string}` | undefined,
    isLoading,
  };
}

// Fetch market data by address
export function useMarketData(address?: string) {
  const { data, isLoading, refetch } = useReadContract({
    address: address as `0x${string}`,
    abi: OPAQUE_MARKET_ABI,
    functionName: "getMarketInfo",
    query: { enabled: !!address, refetchInterval: POLL_INTERVAL },
  });

  const { data: priceData } = useReadContract({
    address: address as `0x${string}`,
    abi: OPAQUE_MARKET_ABI,
    functionName: "getCurrentPrice",
    query: { enabled: !!address, refetchInterval: POLL_INTERVAL },
  });

  let market: Market | null = null;
  if (data && address) {
    const r = data as readonly [string, bigint, boolean, boolean, bigint, bigint, string, string, string, string];
    if (!r || !Array.isArray(r) || r.length < 10) return { market: null, isLoading, refetch };
    const prices = priceData as readonly [number, number] | undefined;
    const demoPrice = seededDemoPrice(address);
    // Use real price only if it has moved from default (5000/5000 = no trades yet)
    const realYes = prices ? Number(prices[0]) : 0;
    const realNo = prices ? Number(prices[1]) : 0;
    const hasRealPrice = realYes > 0 && realNo > 0 && (realYes !== 5000 || realNo !== 5000);
    market = {
      id: address,
      address,
      question: r[0],
      deadline: Number(r[1]),
      resolved: r[2],
      outcome: r[3],
      totalSharesMinted: Number(r[4]),
      activeOrderCount: Number(r[5]),
      resolutionSource: r[6],
      resolutionSourceType: r[7],
      resolutionCriteria: r[8],
      category: r[9],
      yesPrice: hasRealPrice ? realYes : demoPrice,
      noPrice: hasRealPrice ? realNo : 10000 - demoPrice,
    };
  }

  return { market, isLoading, refetch };
}

// Check if user has shares in a market
export function useHasUserShares(marketAddress?: string, userAddress?: string) {
  const { data } = useReadContract({
    address: marketAddress as `0x${string}`,
    abi: OPAQUE_MARKET_ABI,
    functionName: "hasUserShares",
    args: [userAddress as `0x${string}`],
    query: { enabled: !!marketAddress && !!userAddress, refetchInterval: POLL_INTERVAL },
  });

  return data as boolean | undefined;
}
