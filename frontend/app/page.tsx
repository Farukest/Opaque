"use client";

import { useState, useMemo } from "react";
import MarketCard from "../components/MarketCard";
import QuickMarketCard from "../components/QuickMarketCard";
import MultiOutcomeCard from "../components/MultiOutcomeCard";
import { useMarkets } from "../hooks/useMarkets";
import { useQuickMarkets } from "../hooks/useQuickMarkets";
import { useMarketGroups } from "../hooks/useMarketGroups";
import { SOURCE_TYPE_FILTERS, TOPIC_CATEGORIES, priceToPercent } from "../lib/constants";
import { HomePageSkeleton, MarketListSkeleton } from "../components/Skeletons";

type Tab = "all" | "active" | "ending" | "resolved";
type SortBy = "deadline" | "shares" | "price";

export default function Home() {
  const [tab, setTab] = useState<Tab>("all");
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState<SortBy>("deadline");
  const [sourceFilter, setSourceFilter] = useState("all");
  const [topicCategory, setTopicCategory] = useState("all");
  const { markets, isLoading, marketCount } = useMarkets();
  const { quickMarkets, isLoading: quickLoading } = useQuickMarkets();
  const { groups, isLoading: groupsLoading } = useMarketGroups();

  const filteredMarkets = useMemo(() => {
    const now = Math.floor(Date.now() / 1000);
    const threeDays = 3 * 24 * 60 * 60;

    let result = markets.filter((m) => {
      // Tab filter
      let matchesTab = true;
      if (tab === "active") matchesTab = !m.resolved;
      else if (tab === "resolved") matchesTab = m.resolved;
      else if (tab === "ending") matchesTab = !m.resolved && m.deadline - now < threeDays && m.deadline > now;

      const matchesSearch = m.question.toLowerCase().includes(search.toLowerCase());
      const matchesSource =
        sourceFilter === "all" ||
        (sourceFilter === "crypto" && m.resolutionSourceType === "onchain_oracle") ||
        (sourceFilter === "api" && m.resolutionSourceType === "api_verifiable") ||
        (sourceFilter === "manual" && m.resolutionSourceType === "manual_multisig");
      const matchesTopic = topicCategory === "all" || m.category === topicCategory;
      return matchesTab && matchesSearch && matchesSource && matchesTopic;
    });

    result.sort((a, b) => {
      switch (sortBy) {
        case "deadline":
          return a.deadline - b.deadline;
        case "shares":
          return b.totalSharesMinted - a.totalSharesMinted;
        case "price":
          return Math.abs(priceToPercent(b.yesPrice) - 50) - Math.abs(priceToPercent(a.yesPrice) - 50);
        default:
          return 0;
      }
    });

    return result;
  }, [markets, tab, search, sortBy, sourceFilter, topicCategory]);

  const tabs: { label: string; value: Tab }[] = [
    { label: "All", value: "all" },
    { label: "Active", value: "active" },
    { label: "Ending Soon", value: "ending" },
    { label: "Resolved", value: "resolved" },
  ];

  return (
    <div>
      {/* Hero */}
      <div className="mb-10">
        <h1 className="text-3xl md:text-4xl font-bold text-gray-900 dark:text-gray-100 mb-2">
          Prediction Markets
        </h1>
        <p className="text-gray-500 dark:text-gray-400 text-base">
          Trade on outcomes with encrypted order sizes. Prices are public, positions are private.
        </p>
      </div>

      {/* Quick Markets + Multi-Outcome skeleton while loading */}
      {(quickLoading || groupsLoading) && <HomePageSkeleton />}

      {/* Quick Markets (Hourly BTC) */}
      {!quickLoading && quickMarkets.length > 0 && (
        <div className="mb-8">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-3">Quick Markets</h2>
          <div className="flex gap-3 overflow-x-auto pb-1">
            {quickMarkets.map((m) => (
              <QuickMarketCard key={m.id} market={m} />
            ))}
          </div>
        </div>
      )}

      {/* Multi-Outcome Markets */}
      {!groupsLoading && groups.length > 0 && (
        <div className="mb-8">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-3">Multi-Outcome</h2>
          <div className="flex flex-col gap-3">
            {groups.map((g) => (
              <MultiOutcomeCard key={g.address} group={g} />
            ))}
          </div>
        </div>
      )}

      {/* Search */}
      <div className="mb-6">
        <div className="relative max-w-md">
          <svg
            className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 dark:text-gray-500"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search markets..."
            className="w-full bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded-lg pl-10 pr-4 py-2.5 text-sm text-gray-900 dark:text-gray-100 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 focus:outline-none placeholder-gray-400 dark:placeholder-gray-600"
          />
        </div>
      </div>

      {/* Topic category tabs */}
      <div className="flex items-center gap-1.5 mb-4 overflow-x-auto">
        {TOPIC_CATEGORIES.map((cat) => (
          <button
            key={cat.value}
            onClick={() => setTopicCategory(cat.value)}
            className={`px-3 py-1.5 rounded-full text-sm font-medium whitespace-nowrap transition-colors ${
              topicCategory === cat.value
                ? "bg-blue-600 text-white"
                : "bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700"
            }`}
          >
            {cat.label}
          </button>
        ))}
      </div>

      {/* Filter bar: tabs + source type + sort */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-6 border-b border-gray-200 dark:border-gray-700 pb-4">
        <div className="flex items-center gap-1">
          {tabs.map((t) => (
            <button
              key={t.value}
              onClick={() => setTab(t.value)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                tab === t.value
                  ? "bg-gray-900 text-white dark:bg-white dark:text-gray-900"
                  : "text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-gray-800"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-3">
          {/* Source type filter */}
          <div className="flex items-center gap-1">
            {SOURCE_TYPE_FILTERS.map((cat) => (
              <button
                key={cat.value}
                onClick={() => setSourceFilter(cat.value)}
                className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
                  sourceFilter === cat.value
                    ? "bg-blue-50 dark:bg-blue-900/30 text-blue-600 border border-blue-200"
                    : "text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 border border-transparent"
                }`}
              >
                {cat.label}
              </button>
            ))}
          </div>

          {/* Sort */}
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as SortBy)}
            className="bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-1.5 text-xs text-gray-600 dark:text-gray-400 focus:border-blue-500 focus:outline-none"
          >
            <option value="deadline">Deadline</option>
            <option value="shares">Most Shares</option>
            <option value="price">Most Decisive</option>
          </select>
        </div>
      </div>

      {/* Loading skeleton for market list */}
      {isLoading && <MarketListSkeleton count={4} />}

      {/* Market List — vertical stack */}
      {!isLoading && filteredMarkets.length > 0 && (
        <div className="flex flex-col gap-3">
          {filteredMarkets.map((market) => (
            <MarketCard key={market.id} market={market} />
          ))}
        </div>
      )}

      {/* Empty State */}
      {!isLoading && filteredMarkets.length === 0 && (
        <div className="text-center py-20">
          <div className="w-12 h-12 mx-auto mb-4 rounded-full bg-gray-100 dark:bg-gray-800 flex items-center justify-center">
            <svg className="w-6 h-6 text-gray-400 dark:text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
          </div>
          <p className="text-gray-500 dark:text-gray-400 text-sm">
            {markets.length === 0 ? "No markets deployed yet" : `No ${tab === "all" ? "" : tab} markets found`}
          </p>
        </div>
      )}
    </div>
  );
}
