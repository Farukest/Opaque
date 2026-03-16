"use client";

import { useReadContract, useReadContracts } from "wagmi";
import { CONTRACTS, POLL_INTERVAL } from "../lib/constants";
import { MARKET_FACTORY_ABI, OPAQUE_MARKET_ABI } from "../lib/contracts";
import type { Market } from "../lib/constants";
import { seededDemoPrice } from "../lib/demoPrice";
import { MARKET_GROUPS } from "../lib/wagmi";

// Sub-markets belonging to groups — exclude from standalone list
const GROUP_ADDRESSES = new Set(MARKET_GROUPS.map((g) => g.address.toLowerCase()));

export function useMarkets() {
  // Step 1: Get all market addresses from factory
  const {
    data: rawAddresses,
    isLoading: loadingAddresses,
    refetch,
  } = useReadContract({
    address: CONTRACTS.MARKET_FACTORY,
    abi: MARKET_FACTORY_ABI,
    functionName: "getAllMarkets",
    query: { refetchInterval: POLL_INTERVAL },
  });

  const marketAddresses = (rawAddresses || []) as readonly `0x${string}`[];

  // Step 2: Batch read getMarketInfo() for each market
  const infoContracts = marketAddresses.map((addr) => ({
    address: addr,
    abi: OPAQUE_MARKET_ABI,
    functionName: "getMarketInfo" as const,
  }));

  // Step 3: Batch read getCurrentPrice() for each market
  const priceContracts = marketAddresses.map((addr) => ({
    address: addr,
    abi: OPAQUE_MARKET_ABI,
    functionName: "getCurrentPrice" as const,
  }));

  // Step 4: Batch read resolver() to filter out group sub-markets
  const resolverContracts = marketAddresses.map((addr) => ({
    address: addr,
    abi: OPAQUE_MARKET_ABI,
    functionName: "resolver" as const,
  }));

  const { data: marketInfos, isLoading: loadingInfos } = useReadContracts({
    contracts: [...infoContracts, ...priceContracts, ...resolverContracts],
    query: { enabled: marketAddresses.length > 0, refetchInterval: POLL_INTERVAL },
  });

  // Parse results into Market[] (excluding group sub-markets)
  const markets: Market[] = [];
  if (marketAddresses.length > 0 && marketInfos) {
    const count = marketAddresses.length;
    for (let i = 0; i < count; i++) {
      // Skip sub-markets whose resolver is a MarketGroup
      const resolverResult = marketInfos[count * 2 + i];
      if (resolverResult && resolverResult.status === "success" && resolverResult.result) {
        const resolverAddr = (resolverResult.result as string).toLowerCase();
        if (GROUP_ADDRESSES.has(resolverAddr)) continue;
      }

      const info = marketInfos[i];
      const price = marketInfos[count + i];
      if (info && info.status === "success" && info.result) {
        const r = info.result as readonly [
          string,
          bigint,
          boolean,
          boolean,
          bigint,
          bigint,
          string,
          string,
          string,
          string,
        ];
        const prices =
          price?.status === "success" && price.result ? (price.result as readonly [number, number]) : undefined;
        const addr = marketAddresses[i];
        const demoPrice = seededDemoPrice(addr);
        const realYes = prices ? Number(prices[0]) : 0;
        const realNo = prices ? Number(prices[1]) : 0;
        const hasRealPrice = realYes > 0 && realNo > 0 && (realYes !== 5000 || realNo !== 5000);
        markets.push({
          id: i.toString(),
          address: addr,
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
        });
      }
    }
  }

  return {
    markets,
    isLoading: loadingAddresses || loadingInfos,
    marketCount: marketAddresses.length,
    refetch,
  };
}
