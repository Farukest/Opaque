"use client";

import { useReadContract, useReadContracts } from "wagmi";
import { OPAQUE_MARKET_ABI } from "../lib/contracts";
import type { OrderInfo } from "../lib/constants";
import { POLL_INTERVAL } from "../lib/constants";

export function useMyOrders(marketAddress?: string, userAddress?: string) {
  // Get user's order IDs
  const {
    data: orderIds,
    isLoading: loadingIds,
    refetch,
  } = useReadContract({
    address: marketAddress as `0x${string}`,
    abi: OPAQUE_MARKET_ABI,
    functionName: "getUserOrders",
    args: [userAddress as `0x${string}`],
    query: { enabled: !!marketAddress && !!userAddress, refetchInterval: POLL_INTERVAL },
  });

  const ids = (orderIds || []) as readonly bigint[];

  // Batch read getOrder() for each ID
  const contracts = ids.map((id) => ({
    address: marketAddress as `0x${string}`,
    abi: OPAQUE_MARKET_ABI,
    functionName: "getOrder" as const,
    args: [id] as const,
  }));

  const { data: orderResults, isLoading: loadingOrders } = useReadContracts({
    contracts,
    query: { enabled: ids.length > 0, refetchInterval: POLL_INTERVAL },
  });

  // Parse into OrderInfo[]
  const orders: OrderInfo[] = [];
  if (orderResults) {
    for (let i = 0; i < ids.length; i++) {
      const result = orderResults[i];
      if (result && result.status === "success" && result.result) {
        const r = result.result as readonly [string, number, boolean, boolean, bigint, bigint];
        if (!r || !Array.isArray(r) || r.length < 6) continue;
        orders.push({
          id: Number(ids[i]),
          owner: r[0],
          price: Number(r[1]),
          isBid: r[2],
          isActive: r[3],
          sequence: Number(r[4]),
          createdAt: Number(r[5]),
        });
      }
    }
  }

  return {
    orders,
    activeOrders: orders.filter((o) => o.isActive),
    isLoading: loadingIds || loadingOrders,
    refetch,
  };
}
