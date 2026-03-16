"use client";

import { useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { useReadContract, useReadContracts } from "wagmi";
import Image from "next/image";
import { MARKET_GROUP_ABI, OPAQUE_MARKET_ABI } from "../../../lib/contracts";
import { priceToPercent, formatPrice, POLL_INTERVAL } from "../../../lib/constants";
import { seededDemoPrice } from "../../../lib/demoPrice";
import { getOutcomeMeta } from "../../../lib/outcomeMeta";
import { GroupDetailSkeleton } from "../../../components/Skeletons";

function CopyAddress({ address }: { address: string }) {
  const [copied, setCopied] = useState(false);
  const short = `${address.slice(0, 6)}...${address.slice(-4)}`;

  function handleCopy(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    navigator.clipboard.writeText(address);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <button
      onClick={handleCopy}
      className="inline-flex items-center gap-1 font-mono text-gray-400 dark:text-gray-600 hover:text-gray-600 dark:hover:text-gray-400 transition-colors"
      title={address}
    >
      {short}
      {copied ? (
        <svg className="w-3 h-3 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
        </svg>
      ) : (
        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
        </svg>
      )}
    </button>
  );
}

export default function GroupDetailPage() {
  const params = useParams();
  const groupAddress = params.id as `0x${string}`;

  // Read group info
  const { data: groupInfo, isLoading: loadingInfo } = useReadContract({
    address: groupAddress,
    abi: MARKET_GROUP_ABI,
    functionName: "getGroupInfo",
    query: { refetchInterval: POLL_INTERVAL },
  });

  const question = groupInfo ? (groupInfo as readonly [string, bigint, boolean, bigint, string])[0] : "";
  const outcomeCount = groupInfo ? Number((groupInfo as readonly [string, bigint, boolean, bigint, string])[1]) : 0;
  const isResolved = groupInfo ? (groupInfo as readonly [string, bigint, boolean, bigint, string])[2] : false;
  const winningIndex = groupInfo ? Number((groupInfo as readonly [string, bigint, boolean, bigint, string])[3]) : 0;
  const category = groupInfo ? (groupInfo as readonly [string, bigint, boolean, bigint, string])[4] : "";

  // Read all outcomes
  const outcomeContracts = Array.from({ length: outcomeCount }, (_, i) => ({
    address: groupAddress,
    abi: MARKET_GROUP_ABI,
    functionName: "getOutcome" as const,
    args: [BigInt(i)] as const,
  }));

  const { data: outcomeResults, isLoading: loadingOutcomes } = useReadContracts({
    contracts: outcomeContracts,
    query: { enabled: outcomeCount > 0, refetchInterval: POLL_INTERVAL },
  });

  // Extract market addresses from outcomes
  const marketAddresses: `0x${string}`[] = [];
  if (outcomeResults) {
    for (const r of outcomeResults) {
      if (r && r.status === "success" && r.result) {
        const [, market] = r.result as readonly [string, string];
        marketAddresses.push(market as `0x${string}`);
      }
    }
  }

  // Read prices + info for each sub-market
  const priceContracts = marketAddresses.map((addr) => ({
    address: addr,
    abi: OPAQUE_MARKET_ABI,
    functionName: "getCurrentPrice" as const,
  }));

  const infoContracts = marketAddresses.map((addr) => ({
    address: addr,
    abi: OPAQUE_MARKET_ABI,
    functionName: "getMarketInfo" as const,
  }));

  const { data: subMarketData } = useReadContracts({
    contracts: [...infoContracts, ...priceContracts],
    query: { enabled: marketAddresses.length > 0, refetchInterval: POLL_INTERVAL },
  });

  const isLoading = loadingInfo || loadingOutcomes;

  // Parse outcomes with prices
  const outcomes: {
    label: string;
    market: string;
    yesPrice: number;
    noPrice: number;
    totalShares: number;
    resolved: boolean;
    outcome: boolean;
    marketIndex: number;
  }[] = [];

  if (outcomeResults && subMarketData) {
    const mCount = marketAddresses.length;
    for (let i = 0; i < outcomeCount; i++) {
      const oResult = outcomeResults[i];
      if (!oResult || oResult.status !== "success" || !oResult.result) continue;

      const [label, market] = oResult.result as readonly [string, string];
      let yesPrice = 5000;
      let noPrice = 5000;
      let totalShares = 0;
      let resolved = false;
      let outcome = false;

      const mInfo = subMarketData[i];
      const mPrice = subMarketData[mCount + i];

      if (mInfo && mInfo.status === "success" && mInfo.result) {
        const r = mInfo.result as readonly [string, bigint, boolean, boolean, bigint, bigint, string, string, string, string];
        resolved = r[2];
        outcome = r[3];
        totalShares = Number(r[4]);
      }

      if (mPrice && mPrice.status === "success" && mPrice.result) {
        const p = mPrice.result as readonly [number, number];
        yesPrice = Number(p[0]);
        noPrice = Number(p[1]);
      }

      outcomes.push({ label, market, yesPrice, noPrice, totalShares, resolved, outcome, marketIndex: i });
    }

    // Apply seeded demo prices for sub-markets with default 5000/5000
    for (const o of outcomes) {
      if (o.yesPrice === 5000 && o.noPrice === 5000 && o.market) {
        o.yesPrice = seededDemoPrice(o.market);
        o.noPrice = 10000 - o.yesPrice;
      }
    }

    // Normalize so all outcome YES prices sum to 100% (10000 BPS)
    const totalYes = outcomes.reduce((sum, o) => sum + o.yesPrice, 0);
    if (outcomes.length > 1 && totalYes > 0 && totalYes !== 10000) {
      for (const o of outcomes) {
        o.yesPrice = Math.round(o.yesPrice * 10000 / totalYes);
        o.noPrice = 10000 - o.yesPrice;
      }
    }
  }

  return (
    <div>
      {/* Back link */}
      <Link href="/" className="text-blue-600 hover:text-blue-800 text-sm mb-6 inline-block">
        &larr; Back to Markets
      </Link>

      {isLoading ? (
        <GroupDetailSkeleton />
      ) : (
        <>
          {/* Header */}
          <div className="mb-8">
            <h1 className="text-2xl md:text-3xl font-bold text-gray-900 dark:text-gray-100 mb-2">{question}</h1>
            <div className="flex items-center gap-2">
              {category && (
                <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-blue-50 dark:bg-blue-900/30 text-blue-600 capitalize">
                  {category}
                </span>
              )}
              <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-purple-50 dark:bg-purple-900/30 text-purple-600 border border-purple-200">
                {outcomeCount} outcomes
              </span>
              {isResolved && (
                <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-green-50 dark:bg-green-900/30 text-green-600 border border-green-200">
                  Resolved
                </span>
              )}
            </div>
          </div>

          {/* Outcomes */}
          <div className="flex flex-col gap-6">
            {outcomes.map((o, i) => {
              const yesPercent = priceToPercent(o.yesPrice);
              const isWinner = isResolved && i === winningIndex;
              const meta = getOutcomeMeta(o.label);

              return (
                <Link key={i} href={`/market/${o.market}`}>
                  <div className={`bg-white dark:bg-gray-900 rounded-xl border p-5 hover:shadow-md transition-all cursor-pointer ${
                    isWinner ? "border-green-300 bg-green-50/30 dark:bg-green-900/20" : "border-gray-200 dark:border-gray-700"
                  }`}>
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-3">
                        {meta.logo && (
                          <Image src={meta.logo} alt={o.label} width={40} height={40} className="rounded-lg" />
                        )}
                        <h3 className={`text-lg font-medium ${isWinner ? "text-green-700" : meta.color || "text-gray-900 dark:text-gray-100"}`}>
                          {o.label}
                        </h3>
                        {isWinner && (
                          <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-green-100 dark:bg-green-900/30 text-green-700">
                            Winner
                          </span>
                        )}
                        {o.resolved && !isWinner && (
                          <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-red-50 dark:bg-red-900/30 text-red-500">
                            Lost
                          </span>
                        )}
                      </div>
                      <span className={`text-xl font-bold ${isWinner ? "text-green-600" : "text-gray-900 dark:text-gray-100"}`}>
                        {yesPercent.toFixed(0)}%
                      </span>
                    </div>

                    {/* Price bar */}
                    <div className="h-3 rounded-full bg-gray-100 dark:bg-gray-800 overflow-hidden mb-3">
                      <div
                        className={`h-full rounded-full transition-all duration-300 ${
                          isWinner ? "bg-green-500" : "bg-blue-400"
                        }`}
                        style={{ width: `${Math.max(yesPercent, 2)}%` }}
                      />
                    </div>

                    {/* Meta row */}
                    <div className="flex items-center justify-between text-xs text-gray-400 dark:text-gray-500">
                      <div className="flex items-center gap-3">
                        <span className="text-green-600 font-medium">Yes: {formatPrice(o.yesPrice)}</span>
                        <span className="text-red-500 font-medium">No: {formatPrice(o.noPrice)}</span>
                        <span>{o.totalShares} shares</span>
                      </div>
                      <CopyAddress address={o.market} />
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>

          {/* Group address */}
          <div className="mt-8 flex items-center gap-2 text-xs text-gray-400 dark:text-gray-500">
            <span>Group Contract:</span>
            <CopyAddress address={groupAddress} />
          </div>
        </>
      )}
    </div>
  );
}
