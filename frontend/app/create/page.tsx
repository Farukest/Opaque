"use client";

import MarketCreateForm from "../../components/MarketCreateForm";

export default function CreateMarketPage() {
  return (
    <div className="max-w-2xl mx-auto">
      <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100 mb-2">Create Market</h1>
      <p className="text-sm text-gray-500 dark:text-gray-400 mb-8">
        Create a new prediction market with a mandatory verifiable resolution source.
        All bets placed on your market will be fully encrypted with FHE.
      </p>

      <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl p-6">
        <MarketCreateForm />
      </div>

      {/* Comparison */}
      <div className="mt-8 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-6">
        <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-4">Why Source-Mandatory?</h3>
        <div className="grid md:grid-cols-2 gap-4 text-sm">
          <div className="bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 rounded-lg p-4">
            <div className="font-medium text-red-600 dark:text-red-400 mb-2">Polymarket (No Source Required)</div>
            <ul className="text-gray-600 dark:text-gray-400 space-y-1">
              <li>- UFO market: $16M resolved with no evidence</li>
              <li>- Ukraine deal: $7M whale-manipulated</li>
              <li>- Ambiguous resolution criteria</li>
            </ul>
          </div>
          <div className="bg-green-50 dark:bg-green-900/30 border border-green-200 dark:border-green-800 rounded-lg p-4">
            <div className="font-medium text-green-600 dark:text-green-400 mb-2">Opaque (Source Mandatory)</div>
            <ul className="text-gray-600 dark:text-gray-400 space-y-1">
              <li>+ Every market has verifiable source</li>
              <li>+ Eliminates ~90% of oracle problems</li>
              <li>+ Deterministically verifiable outcomes</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
