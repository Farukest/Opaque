"use client";

import { useReadContracts } from "wagmi";
import { POLL_INTERVAL } from "../lib/constants";
import type { MarketGroupData } from "../lib/constants";
import { MARKET_GROUP_ABI, OPAQUE_MARKET_ABI } from "../lib/contracts";
import { MARKET_GROUPS } from "../lib/wagmi";
import { seededDemoPrice } from "../lib/demoPrice";

export function useMarketGroups() {
  const groupAddresses = MARKET_GROUPS.map((g) => g.address);

  // Step 1: Read getGroupInfo() for each group
  const groupInfoContracts = groupAddresses.map((addr) => ({
    address: addr,
    abi: MARKET_GROUP_ABI,
    functionName: "getGroupInfo" as const,
  }));

  const { data: groupInfos, isLoading: loadingGroups } = useReadContracts({
    contracts: groupInfoContracts,
    query: { enabled: groupAddresses.length > 0, refetchInterval: POLL_INTERVAL },
  });

  // Step 2: Build outcome read calls based on group info
  const outcomeContracts: {
    address: `0x${string}`;
    abi: typeof MARKET_GROUP_ABI;
    functionName: "getOutcome";
    args: [bigint];
  }[] = [];

  // Track which group each outcome call belongs to
  const outcomeMap: { groupIndex: number; outcomeIndex: number }[] = [];

  if (groupInfos) {
    for (let g = 0; g < groupAddresses.length; g++) {
      const info = groupInfos[g];
      if (info && info.status === "success" && info.result) {
        const r = info.result as readonly [string, bigint, boolean, bigint, string];
        const count = Number(r[1]);
        for (let i = 0; i < count; i++) {
          outcomeContracts.push({
            address: groupAddresses[g],
            abi: MARKET_GROUP_ABI,
            functionName: "getOutcome",
            args: [BigInt(i)],
          });
          outcomeMap.push({ groupIndex: g, outcomeIndex: i });
        }
      }
    }
  }

  const { data: outcomeResults, isLoading: loadingOutcomes } = useReadContracts({
    contracts: outcomeContracts,
    query: { enabled: outcomeContracts.length > 0, refetchInterval: POLL_INTERVAL },
  });

  // Step 3: Read market info + prices for each outcome's sub-market
  const marketAddresses: `0x${string}`[] = [];
  if (outcomeResults) {
    for (const result of outcomeResults) {
      if (result && result.status === "success" && result.result) {
        const [, market] = result.result as readonly [string, string];
        marketAddresses.push(market as `0x${string}`);
      } else {
        marketAddresses.push("0x0000000000000000000000000000000000000000");
      }
    }
  }

  const priceContracts = marketAddresses
    .filter((a) => a !== "0x0000000000000000000000000000000000000000")
    .map((addr) => ({
      address: addr,
      abi: OPAQUE_MARKET_ABI,
      functionName: "getCurrentPrice" as const,
    }));

  const marketInfoContracts = marketAddresses
    .filter((a) => a !== "0x0000000000000000000000000000000000000000")
    .map((addr) => ({
      address: addr,
      abi: OPAQUE_MARKET_ABI,
      functionName: "getMarketInfo" as const,
    }));

  const { data: subMarketData, isLoading: loadingSubMarkets } = useReadContracts({
    contracts: [...marketInfoContracts, ...priceContracts],
    query: { enabled: marketAddresses.length > 0, refetchInterval: POLL_INTERVAL },
  });

  // Step 4: Assemble MarketGroupData[]
  const groups: MarketGroupData[] = [];

  if (groupInfos && outcomeResults) {
    let outcomeIdx = 0;
    const validMarketAddresses = marketAddresses.filter((a) => a !== "0x0000000000000000000000000000000000000000");
    const marketCount = validMarketAddresses.length;

    for (let g = 0; g < groupAddresses.length; g++) {
      const info = groupInfos[g];
      if (!info || info.status !== "success" || !info.result) continue;

      const r = info.result as readonly [string, bigint, boolean, bigint, string];
      const count = Number(r[1]);
      const groupData: MarketGroupData = {
        address: groupAddresses[g],
        question: r[0],
        category: r[4],
        outcomeCount: count,
        resolved: r[2],
        winningIndex: Number(r[3]),
        outcomes: [],
      };

      for (let i = 0; i < count; i++) {
        const outcomeResult = outcomeResults[outcomeIdx];
        let label = `Outcome ${i}`;
        let marketAddr = "";
        let yesPrice = 5000;
        let noPrice = 5000;
        let resolved = false;
        let outcome = false;

        if (outcomeResult && outcomeResult.status === "success" && outcomeResult.result) {
          const [l, m] = outcomeResult.result as readonly [string, string];
          label = l;
          marketAddr = m;

          // Find this market's index in the valid array
          const validIdx = validMarketAddresses.indexOf(m as `0x${string}`);
          if (validIdx >= 0 && subMarketData) {
            const mInfo = subMarketData[validIdx];
            const mPrice = subMarketData[marketCount + validIdx];
            if (mInfo && mInfo.status === "success" && mInfo.result) {
              const mr = mInfo.result as readonly [
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
              resolved = mr[2];
              outcome = mr[3];
            }
            if (mPrice && mPrice.status === "success" && mPrice.result) {
              const pr = mPrice.result as readonly [number, number];
              yesPrice = Number(pr[0]);
              noPrice = Number(pr[1]);
            }
          }
        }

        groupData.outcomes.push({ label, market: marketAddr, yesPrice, noPrice, resolved, outcome });
        outcomeIdx++;
      }

      // Apply seeded demo prices for sub-markets with default 5000/5000
      for (const o of groupData.outcomes) {
        if (o.yesPrice === 5000 && o.noPrice === 5000 && o.market) {
          o.yesPrice = seededDemoPrice(o.market);
          o.noPrice = 10000 - o.yesPrice;
        }
      }

      // Normalize so all outcome YES prices sum to 100% (10000 BPS)
      const totalYes = groupData.outcomes.reduce((sum, o) => sum + o.yesPrice, 0);
      if (groupData.outcomes.length > 1 && totalYes > 0 && totalYes !== 10000) {
        for (const o of groupData.outcomes) {
          o.yesPrice = Math.round(o.yesPrice * 10000 / totalYes);
          o.noPrice = 10000 - o.yesPrice;
        }
      }

      groups.push(groupData);
    }
  }

  return {
    groups,
    isLoading: loadingGroups || loadingOutcomes || loadingSubMarkets,
  };
}
