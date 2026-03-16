/**
 * Skeleton loading components — match the exact layout of real components.
 * Uses Tailwind `animate-pulse` with gray-200/gray-800 dark bars.
 */

/* ─── Reusable primitives ─── */

function Bar({ className = "", style }: { className?: string; style?: React.CSSProperties }) {
  return <div className={`rounded bg-gray-200 dark:bg-gray-700/60 ${className}`} style={style} />;
}

/* ─── Home page skeletons ─── */

/** Matches QuickMarketCard: min-w-[280px], title row, BTC price, YES/NO boxes */
export function QuickMarketCardSkeleton() {
  return (
    <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm p-4 min-w-[280px] animate-pulse">
      {/* Title row */}
      <div className="flex items-center justify-between mb-3">
        <Bar className="h-4 w-20" />
        <Bar className="h-5 w-14 rounded-full" />
      </div>
      {/* Live BTC label + price */}
      <div className="mb-3">
        <Bar className="h-3 w-16 mb-1.5" />
        <Bar className="h-7 w-28" />
      </div>
      {/* YES / NO boxes */}
      <div className="flex gap-2">
        <div className="flex-1 bg-green-50 dark:bg-green-900/20 rounded-lg p-2 space-y-1.5">
          <Bar className="h-3 w-12 mx-auto" />
          <Bar className="h-4 w-10 mx-auto" />
          <Bar className="h-3 w-8 mx-auto" />
        </div>
        <div className="flex-1 bg-red-50 dark:bg-red-900/20 rounded-lg p-2 space-y-1.5">
          <Bar className="h-3 w-12 mx-auto" />
          <Bar className="h-4 w-10 mx-auto" />
          <Bar className="h-3 w-8 mx-auto" />
        </div>
      </div>
    </div>
  );
}

/** Matches MarketCard: question, probability bar, metadata row */
export function MarketCardSkeleton() {
  return (
    <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm p-5 animate-pulse">
      {/* Question */}
      <Bar className="h-5 w-3/4 mb-2" />
      <Bar className="h-5 w-1/2 mb-4" />

      {/* Probability bar */}
      <div className="mb-4">
        <div className="flex items-baseline justify-between mb-1.5">
          <Bar className="h-4 w-16" />
        </div>
        <div className="h-2 rounded-full bg-gray-100 dark:bg-gray-800 overflow-hidden">
          <Bar className="h-full w-2/5 rounded-full bg-gray-300 dark:bg-gray-600" />
        </div>
      </div>

      {/* Metadata row */}
      <div className="flex items-center gap-3">
        <Bar className="h-5 w-14 rounded" />
        <Bar className="h-3 w-24" />
        <Bar className="h-3 w-20" />
        <Bar className="h-3 w-14" />
      </div>
    </div>
  );
}

/** Matches MultiOutcomeCard: title + badges, 3 outcome bars */
export function MultiOutcomeCardSkeleton() {
  return (
    <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm p-5 animate-pulse">
      {/* Title row */}
      <div className="flex items-center justify-between mb-4">
        <Bar className="h-5 w-2/3" />
        <div className="flex gap-2">
          <Bar className="h-5 w-16 rounded-full" />
          <Bar className="h-5 w-14 rounded-full" />
        </div>
      </div>

      {/* Outcome rows */}
      {[1, 2, 3].map((i) => (
        <div key={i} className="mb-3 last:mb-0">
          <div className="flex items-center justify-between mb-1">
            <Bar className="h-4 w-28" />
            <Bar className="h-4 w-10" />
          </div>
          <div className="h-3 rounded-full bg-gray-100 dark:bg-gray-800 overflow-hidden">
            <Bar className={`h-full rounded-full bg-gray-300 dark:bg-gray-600`} style={{ width: `${20 + i * 12}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}

/** Full home page skeleton: Quick Markets + Multi-Outcome + MarketCards */
export function HomePageSkeleton() {
  return (
    <div>
      {/* Quick Markets skeleton */}
      <div className="mb-8">
        <Bar className="h-5 w-32 mb-3" />
        <div className="flex gap-3 overflow-hidden">
          <QuickMarketCardSkeleton />
          <QuickMarketCardSkeleton />
          <QuickMarketCardSkeleton />
        </div>
      </div>

      {/* Multi-Outcome skeleton */}
      <div className="mb-8">
        <Bar className="h-5 w-28 mb-3" />
        <div className="flex flex-col gap-3">
          <MultiOutcomeCardSkeleton />
          <MultiOutcomeCardSkeleton />
        </div>
      </div>
    </div>
  );
}

/** Market cards list skeleton */
export function MarketListSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className="flex flex-col gap-3">
      {Array.from({ length: count }).map((_, i) => (
        <MarketCardSkeleton key={i} />
      ))}
    </div>
  );
}

/* ─── Market detail page skeleton ─── */

export function MarketDetailSkeleton() {
  return (
    <div className="max-w-6xl mx-auto animate-pulse">
      {/* Back link */}
      <Bar className="h-4 w-28 mb-6" />

      {/* Question header */}
      <div className="mb-6">
        <Bar className="h-7 w-3/4 mb-2" />
        <Bar className="h-7 w-1/2 mb-3" />
        <Bar className="h-4 w-96 max-w-full" />
      </div>

      {/* YES / NO Probability Cards */}
      <div className="grid grid-cols-2 gap-4 mb-6">
        <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800/30 rounded-xl p-5 text-center space-y-2">
          <Bar className="h-3 w-8 mx-auto" />
          <Bar className="h-10 w-24 mx-auto" />
          <Bar className="h-4 w-12 mx-auto" />
        </div>
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800/30 rounded-xl p-5 text-center space-y-2">
          <Bar className="h-3 w-8 mx-auto" />
          <Bar className="h-10 w-24 mx-auto" />
          <Bar className="h-4 w-12 mx-auto" />
        </div>
      </div>

      {/* Chart placeholder */}
      <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm p-6 mb-6">
        <div className="flex items-center justify-between mb-4">
          <Bar className="h-5 w-28" />
          <div className="flex gap-2">
            <Bar className="h-6 w-10 rounded" />
            <Bar className="h-6 w-10 rounded" />
            <Bar className="h-6 w-10 rounded" />
          </div>
        </div>
        <Bar className="h-4 w-20 mb-2" />
        {/* Chart area */}
        <div className="h-48 bg-gray-100 dark:bg-gray-800 rounded-lg" />
      </div>

      {/* Two column layout */}
      <div className="grid lg:grid-cols-3 gap-6">
        {/* Left column */}
        <div className="lg:col-span-2 space-y-6">
          {/* Order Book */}
          <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm p-6">
            <Bar className="h-5 w-24 mb-4" />
            <div className="space-y-3">
              <div className="flex justify-between"><Bar className="h-3 w-12" /><Bar className="h-3 w-12" /><Bar className="h-3 w-16" /></div>
              <div className="flex justify-between"><Bar className="h-4 w-16" /><Bar className="h-4 w-12" /><Bar className="h-4 w-12" /></div>
              <div className="flex justify-between"><Bar className="h-4 w-16" /><Bar className="h-4 w-12" /><Bar className="h-4 w-12" /></div>
              <div className="flex justify-between"><Bar className="h-4 w-16" /><Bar className="h-4 w-12" /><Bar className="h-4 w-12" /></div>
            </div>
          </div>

          {/* Resolution Details */}
          <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm p-6">
            <Bar className="h-5 w-36 mb-4" />
            <div className="space-y-3">
              {[1, 2, 3, 4].map((i) => (
                <div key={i} className="flex justify-between">
                  <Bar className="h-4 w-20" />
                  <Bar className="h-4 w-32" />
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Right column */}
        <div className="space-y-6">
          {/* Trading Panel */}
          <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm p-5">
            <div className="flex items-center justify-between mb-3">
              <Bar className="h-3 w-16" />
              <Bar className="h-4 w-20" />
            </div>
            <div className="flex gap-2 mb-4 border-b border-gray-200 dark:border-gray-700 pb-3">
              <Bar className="h-8 w-16 rounded-lg" />
              <Bar className="h-8 w-16 rounded-lg" />
            </div>
            <div className="flex gap-2 mb-4">
              <Bar className="h-10 flex-1 rounded-lg" />
              <Bar className="h-10 flex-1 rounded-lg" />
            </div>
            <Bar className="h-4 w-24 mb-2" />
            <Bar className="h-10 w-full rounded-lg mb-3" />
            <Bar className="h-4 w-16 mb-2" />
            <Bar className="h-10 w-full rounded-lg mb-4" />
            <Bar className="h-11 w-full rounded-lg" />
          </div>

          {/* Privacy Info */}
          <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm p-4">
            <div className="flex items-center gap-2">
              <Bar className="h-4 w-4 rounded" />
              <Bar className="h-4 w-40" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─── Group detail page skeleton ─── */

export function GroupDetailSkeleton() {
  return (
    <div className="animate-pulse">
      {/* Header */}
      <div className="mb-8">
        <Bar className="h-8 w-3/4 mb-2" />
        <Bar className="h-8 w-1/2 mb-3" />
        <div className="flex items-center gap-2">
          <Bar className="h-5 w-16 rounded-full" />
          <Bar className="h-5 w-20 rounded-full" />
        </div>
      </div>

      {/* Outcome cards */}
      <div className="space-y-4">
        {[1, 2, 3].map((i) => (
          <div key={i} className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-3">
                <Bar className="h-10 w-10 rounded-lg" />
                <Bar className="h-5 w-36" />
              </div>
              <Bar className="h-6 w-12" />
            </div>
            {/* Price bar */}
            <div className="h-3 rounded-full bg-gray-100 dark:bg-gray-800 overflow-hidden mb-3">
              <Bar className="h-full rounded-full bg-gray-300 dark:bg-gray-600" style={{ width: `${20 + i * 15}%` }} />
            </div>
            {/* Meta row */}
            <div className="flex items-center gap-4">
              <Bar className="h-3 w-16" />
              <Bar className="h-3 w-16" />
              <Bar className="h-3 w-20" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ─── Portfolio page skeleton ─── */

export function PortfolioSkeleton() {
  return (
    <div className="animate-pulse">
      {/* Balance + Summary Grid */}
      <div className="grid lg:grid-cols-4 gap-4 mb-8">
        {/* cUSDT Balance - large card */}
        <div className="lg:col-span-2 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl shadow-sm p-6">
          <div className="flex items-center justify-between mb-1">
            <Bar className="h-3 w-24" />
            <Bar className="h-4 w-20 rounded" />
          </div>
          <div className="flex items-center gap-3 mb-3">
            <Bar className="h-8 w-20" />
            <Bar className="h-5 w-12" />
          </div>
          <Bar className="h-9 w-32 rounded-lg mb-3" />
          <Bar className="h-3 w-64 max-w-full" />
        </div>

        {/* Summary cards */}
        <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl shadow-sm p-4">
          <Bar className="h-3 w-24 mb-2" />
          <Bar className="h-7 w-8" />
        </div>
        <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl shadow-sm p-4">
          <Bar className="h-3 w-16 mb-2" />
          <Bar className="h-7 w-8" />
        </div>
      </div>

      {/* Info box placeholder */}
      <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-100 dark:border-blue-800/30 rounded-xl p-4 mb-8">
        <div className="flex items-start gap-3">
          <Bar className="h-5 w-5 rounded-full shrink-0 mt-0.5" />
          <div className="flex-1 space-y-1.5">
            <Bar className="h-3 w-full" />
            <Bar className="h-3 w-3/4" />
          </div>
        </div>
      </div>

      {/* Active Positions */}
      <Bar className="h-5 w-32 mb-4" />
      <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl shadow-sm divide-y divide-gray-100 dark:divide-gray-800">
        {[1, 2, 3].map((i) => (
          <div key={i} className="px-5 py-4">
            <div className="flex items-center justify-between">
              <div className="flex-1 mr-4">
                <Bar className="h-4 w-3/4 mb-2" />
                <div className="flex items-center gap-3">
                  <Bar className="h-3 w-16" />
                  <Bar className="h-3 w-14" />
                </div>
              </div>
              <Bar className="h-8 w-24 rounded-lg" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
