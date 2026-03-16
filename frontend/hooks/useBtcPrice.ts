"use client";

import { useReadContract } from "wagmi";
import { CHAINLINK_FEED_ABI } from "../lib/contracts";
import { CHAINLINK_BTC_USD_SEPOLIA } from "../lib/wagmi";

const BTC_POLL_INTERVAL = 30_000; // 30 seconds

export function useBtcPrice() {
  const { data, isLoading } = useReadContract({
    address: CHAINLINK_BTC_USD_SEPOLIA,
    abi: CHAINLINK_FEED_ABI,
    functionName: "latestRoundData",
    query: { refetchInterval: BTC_POLL_INTERVAL },
  });

  let price = 0;
  let updatedAt = 0;

  if (data) {
    const [, answer, , updated] = data as readonly [bigint, bigint, bigint, bigint, bigint];
    // Chainlink BTC/USD has 8 decimals
    price = Number(answer) / 1e8;
    updatedAt = Number(updated);
  }

  return { price, updatedAt, isLoading };
}
