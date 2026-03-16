"use client";

import { useReadContract, useReadContracts } from "wagmi";
import { OPAQUE_MARKET_ABI, MARKET_GROUP_ABI } from "../lib/contracts";
import { MARKET_GROUPS } from "../lib/wagmi";
import { seededDemoPrice } from "../lib/demoPrice";
import { POLL_INTERVAL } from "../lib/constants";

const GROUP_ADDRESSES = new Set(MARKET_GROUPS.map((g) => g.address.toLowerCase()));

/**
 * For a sub-market that belongs to a MarketGroup, returns the normalized
 * YES/NO prices so they sum to 100% across all sibling outcomes.
 * Returns null if the market is not part of a group.
 */
export function useGroupNormalizedPrice(marketAddress?: string) {
  // Step 1: Read resolver of this market
  const { data: resolverAddr } = useReadContract({
    address: marketAddress as `0x${string}`,
    abi: OPAQUE_MARKET_ABI,
    functionName: "resolver",
    query: { enabled: !!marketAddress, refetchInterval: POLL_INTERVAL },
  });

  const resolverStr = resolverAddr ? (resolverAddr as string).toLowerCase() : "";
  const isGroupMember = resolverStr !== "" && GROUP_ADDRESSES.has(resolverStr);
  const groupAddress = isGroupMember ? (resolverStr as `0x${string}`) : undefined;

  // Step 2: Read group info (outcome count)
  const { data: groupInfo } = useReadContract({
    address: groupAddress,
    abi: MARKET_GROUP_ABI,
    functionName: "getGroupInfo",
    query: { enabled: !!groupAddress, refetchInterval: POLL_INTERVAL },
  });

  const outcomeCount = groupInfo
    ? Number((groupInfo as readonly [string, bigint, boolean, bigint, string])[1])
    : 0;

  // Step 3: Read all outcomes from the group
  const outcomeContracts = Array.from({ length: outcomeCount }, (_, i) => ({
    address: groupAddress!,
    abi: MARKET_GROUP_ABI,
    functionName: "getOutcome" as const,
    args: [BigInt(i)] as const,
  }));

  const { data: outcomeResults } = useReadContracts({
    contracts: outcomeContracts,
    query: { enabled: outcomeCount > 0, refetchInterval: POLL_INTERVAL },
  });

  // Extract sibling market addresses
  const siblingAddresses: `0x${string}`[] = [];
  if (outcomeResults) {
    for (const r of outcomeResults) {
      if (r && r.status === "success" && r.result) {
        const [, market] = r.result as readonly [string, string];
        siblingAddresses.push(market as `0x${string}`);
      }
    }
  }

  // Step 4: Read prices for all siblings
  const priceContracts = siblingAddresses.map((addr) => ({
    address: addr,
    abi: OPAQUE_MARKET_ABI,
    functionName: "getCurrentPrice" as const,
  }));

  const { data: siblingPrices } = useReadContracts({
    contracts: priceContracts,
    query: { enabled: siblingAddresses.length > 0, refetchInterval: POLL_INTERVAL },
  });

  // Step 5: Normalize
  if (!isGroupMember || siblingAddresses.length === 0 || !siblingPrices) {
    return null;
  }

  // Collect raw yes prices for each sibling
  const rawYesPrices: number[] = [];
  for (let i = 0; i < siblingAddresses.length; i++) {
    const p = siblingPrices[i];
    let yesPrice = 5000;
    if (p && p.status === "success" && p.result) {
      const pr = p.result as readonly [number, number];
      yesPrice = Number(pr[0]);
    }
    // Apply demo price for defaults
    if (yesPrice === 5000) {
      yesPrice = seededDemoPrice(siblingAddresses[i]);
    }
    rawYesPrices.push(yesPrice);
  }

  // Normalize so all sum to 10000
  const totalYes = rawYesPrices.reduce((sum, p) => sum + p, 0);
  if (totalYes <= 0) return null;

  const normalizedPrices = rawYesPrices.map((p) => Math.round((p * 10000) / totalYes));

  // Find which sibling is the current market
  const myIndex = siblingAddresses.findIndex(
    (addr) => addr.toLowerCase() === marketAddress?.toLowerCase()
  );

  if (myIndex < 0) return null;

  const normalizedYes = normalizedPrices[myIndex];
  const normalizedNo = 10000 - normalizedYes;

  return {
    yesPrice: normalizedYes,
    noPrice: normalizedNo,
    groupAddress: groupAddress!,
    siblingCount: siblingAddresses.length,
  };
}
