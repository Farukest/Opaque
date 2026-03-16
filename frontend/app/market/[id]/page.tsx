"use client";

import { use } from "react";
import { useAccount, useReadContract } from "wagmi";
import { useMarketAddress, useMarketData } from "../../../hooks/useMarketData";
import { useGroupNormalizedPrice } from "../../../hooks/useGroupNormalizedPrice";
import OrderBookDisplay from "../../../components/OrderBookDisplay";
import TradingPanel from "../../../components/TradingPanel";
import MyOrders from "../../../components/MyOrders";
import RedemptionPanel from "../../../components/RedemptionPanel";
import EmergencyActions from "../../../components/EmergencyActions";
import OddsChart from "../../../components/OddsChart";
import ShareButton from "../../../components/ShareButton";
import { PrivacyInfo } from "../../../components/PrivacyBadge";
import { OPAQUE_MARKET_ABI } from "../../../lib/contracts";
import { priceToPercent, formatPrice } from "../../../lib/constants";
import { MarketDetailSkeleton } from "../../../components/Skeletons";
import Link from "next/link";

function formatDeadline(timestamp: number): string {
  return new Date(timestamp * 1000).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function getSourceTypeLabel(type: string): string {
  switch (type) {
    case "onchain_oracle": return "On-chain Oracle";
    case "api_verifiable": return "API Verifiable";
    case "manual_multisig": return "Manual Multi-sig";
    default: return type;
  }
}

export default function MarketPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const isAddress = /^0x[a-fA-F0-9]{40}$/.test(id);
  const marketIndex = isAddress ? -1 : parseInt(id, 10);
  const isValidIndex = !isAddress && !isNaN(marketIndex) && marketIndex >= 0;

  const { address: userAddress } = useAccount();

  const { address: factoryAddress, isLoading: loadingAddress } = useMarketAddress(isValidIndex ? marketIndex : -1);
  const marketAddress = isAddress ? (id as `0x${string}`) : factoryAddress;
  const { market, isLoading: loadingData, refetch } = useMarketData(marketAddress);

  const { data: marketCreator } = useReadContract({
    address: marketAddress as `0x${string}`,
    abi: OPAQUE_MARKET_ABI,
    functionName: "creator",
    query: { enabled: !!marketAddress },
  });

  // If this market belongs to a group, get normalized prices
  const groupNorm = useGroupNormalizedPrice(marketAddress);

  const isLoading = (isValidIndex ? loadingAddress : false) || loadingData;

  if (isLoading) {
    return <MarketDetailSkeleton />;
  }

  if (!isAddress && !isValidIndex) {
    return (
      <div className="text-center py-20">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-4">Invalid Market ID</h1>
        <p className="text-gray-500 dark:text-gray-400 mb-4">&quot;{id}&quot; is not a valid market index or address.</p>
        <Link href="/" className="text-blue-600 hover:text-blue-500">Back to Markets</Link>
      </div>
    );
  }

  if (!market || !marketAddress) {
    return (
      <div className="text-center py-20">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-4">Market Not Found</h1>
        <p className="text-gray-500 dark:text-gray-400 mb-4">Market #{id} does not exist.</p>
        <Link href="/" className="text-blue-600 hover:text-blue-500">Back to Markets</Link>
      </div>
    );
  }

  const isExpired = market.deadline * 1000 < Date.now();
  // Use group-normalized prices for sub-markets, raw prices for standalone
  const displayYesPrice = groupNorm ? groupNorm.yesPrice : market.yesPrice;
  const displayNoPrice = groupNorm ? groupNorm.noPrice : market.noPrice;
  const yesPercent = priceToPercent(displayYesPrice).toFixed(1);
  const noPercent = priceToPercent(displayNoPrice).toFixed(1);

  return (
    <div className="max-w-6xl mx-auto">
      {/* Back link */}
      <Link href="/" className="inline-flex items-center gap-1.5 text-sm text-gray-500 dark:text-gray-400 hover:text-blue-600 mb-6 transition-colors">
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
        </svg>
        Back to Markets
      </Link>

      {/* Question Header */}
      <div className="mb-6">
        <div className="flex items-start justify-between gap-4 mb-2">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">{market.question}</h1>
          {market.resolved && (
            <span className={`shrink-0 px-3 py-1.5 rounded-full text-sm font-bold ${
              market.outcome
                ? "bg-green-50 dark:bg-green-900/30 text-green-600 border border-green-200"
                : "bg-red-50 dark:bg-red-900/30 text-red-600 border border-red-200"
            }`}>
              Resolved: {market.outcome ? "YES" : "NO"}
            </span>
          )}
        </div>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          {market.resolved ? "Resolved" : isExpired ? "Awaiting resolution" : "Resolves"} {formatDeadline(market.deadline)}
          {" "}&middot;{" "}{getSourceTypeLabel(market.resolutionSourceType)}
          {market.category && (
            <span> &middot; <span className="capitalize">{market.category}</span></span>
          )}
          {!market.resolved && !isExpired && (
            <span> &middot; {market.activeOrderCount} active order{market.activeOrderCount !== 1 ? "s" : ""}</span>
          )}
        </p>
      </div>

      {/* YES / NO Probability Cards */}
      <div className="grid grid-cols-2 gap-4 mb-6">
        <div className="bg-green-50 dark:bg-green-900/30 border border-green-200 rounded-xl p-5 text-center">
          <div className="text-xs font-medium uppercase tracking-wider text-gray-400 dark:text-gray-500 mb-1">Yes</div>
          <div className="text-4xl font-bold text-green-600">{yesPercent}%</div>
          <div className="text-sm text-green-600 mt-1">{formatPrice(displayYesPrice)}</div>
        </div>
        <div className="bg-red-50 dark:bg-red-900/30 border border-red-200 rounded-xl p-5 text-center">
          <div className="text-xs font-medium uppercase tracking-wider text-gray-400 dark:text-gray-500 mb-1">No</div>
          <div className="text-4xl font-bold text-red-600">{noPercent}%</div>
          <div className="text-sm text-red-600 mt-1">{formatPrice(displayNoPrice)}</div>
        </div>
      </div>

      {/* Price Chart - full width */}
      <div className="mb-6">
        <OddsChart yesPrice={displayYesPrice} marketAddress={marketAddress} />
      </div>

      {/* Two Column Layout */}
      <div className="grid lg:grid-cols-3 gap-6">
        {/* Left Column (2/3) */}
        <div className="lg:col-span-2 space-y-6">
          {/* Order Book */}
          <OrderBookDisplay marketAddress={marketAddress} resolved={market.resolved} yesPrice={displayYesPrice} onSuccess={refetch} />

          {/* My Orders */}
          <MyOrders
            marketAddress={marketAddress}
            resolved={market.resolved}
            onSuccess={refetch}
          />

          {/* Resolution Details */}
          <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm p-6">
            <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-4">Resolution Details</h3>
            <div className="space-y-3 text-sm">
              <div className="flex justify-between gap-4">
                <span className="text-gray-500 dark:text-gray-400 shrink-0">Source</span>
                <span className="text-gray-900 dark:text-gray-100 text-right break-all">{market.resolutionSource}</span>
              </div>
              <div className="flex justify-between gap-4">
                <span className="text-gray-500 dark:text-gray-400 shrink-0">Type</span>
                <span className="text-gray-900 dark:text-gray-100">{getSourceTypeLabel(market.resolutionSourceType)}</span>
              </div>
              {market.resolutionCriteria && (
                <div>
                  <span className="text-gray-500 dark:text-gray-400 block mb-1">Criteria</span>
                  <p className="text-gray-900 dark:text-gray-100 text-xs leading-relaxed bg-gray-50 dark:bg-gray-800 rounded-lg px-3 py-2">{market.resolutionCriteria}</p>
                </div>
              )}
              {market.category && (
                <div className="flex justify-between gap-4">
                  <span className="text-gray-500 dark:text-gray-400 shrink-0">Category</span>
                  <span className="text-gray-900 dark:text-gray-100 capitalize">{market.category}</span>
                </div>
              )}
              <div className="flex justify-between gap-4">
                <span className="text-gray-500 dark:text-gray-400 shrink-0">Shares Minted</span>
                <span className="text-gray-900 dark:text-gray-100 font-semibold">{market.totalSharesMinted}</span>
              </div>
            </div>
          </div>

          {/* Contract Info */}
          <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm p-6">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-medium uppercase tracking-wider text-gray-400 dark:text-gray-500">Contract</span>
              <a
                href={`https://sepolia.etherscan.io/address/${marketAddress}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-blue-600 hover:text-blue-500 font-mono"
              >
                {marketAddress}
              </a>
            </div>
            <div className="flex items-center justify-between pt-3 border-t border-gray-100 dark:border-gray-800">
              <span className="text-xs font-medium uppercase tracking-wider text-gray-400 dark:text-gray-500">Share</span>
              <ShareButton
                marketQuestion={market.question}
                marketId={id}
                yesProbability={priceToPercent(displayYesPrice)}
              />
            </div>
          </div>
        </div>

        {/* Right Column (1/3) */}
        <div className="space-y-6">
          {/* Trading Panel */}
          <TradingPanel
            marketAddress={marketAddress}
            resolved={market.resolved}
            yesPrice={displayYesPrice}
            noPrice={displayNoPrice}
            onSuccess={refetch}
          />

          {/* Redeem Winnings */}
          <RedemptionPanel
            marketAddress={marketAddress}
            resolved={market.resolved}
            outcome={market.outcome}
          />

          {/* Emergency Actions */}
          <EmergencyActions
            marketAddress={marketAddress}
            resolved={market.resolved}
            deadline={market.deadline}
            totalSharesMinted={market.totalSharesMinted}
            creator={(marketCreator as string) || ""}
          />

          <PrivacyInfo />
        </div>
      </div>
    </div>
  );
}
