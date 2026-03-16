"use client";

import { useState } from "react";

interface ShareButtonProps {
  marketQuestion: string;
  marketId: string;
  yesProbability: number;
}

export default function ShareButton({ marketQuestion, marketId, yesProbability }: ShareButtonProps) {
  const [copied, setCopied] = useState(false);

  const marketUrl = typeof window !== "undefined"
    ? `${window.location.origin}/market/${marketId}`
    : `/market/${marketId}`;

  const tweetText = `${marketQuestion}\n\nCurrently at ${yesProbability.toFixed(1)}% YES on Opaque - the FHE-powered private prediction market.\n\n${marketUrl}`;

  function handleCopyLink() {
    navigator.clipboard.writeText(marketUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  function handleTwitterShare() {
    const url = `https://x.com/intent/tweet?text=${encodeURIComponent(tweetText)}`;
    window.open(url, "_blank", "noopener,noreferrer");
  }

  return (
    <div className="flex items-center gap-2">
      <button
        onClick={handleCopyLink}
        className="flex items-center gap-1.5 px-3 py-1.5 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg text-xs text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white hover:border-gray-300 dark:hover:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors font-medium"
        title="Copy market link"
      >
        {copied ? (
          <>
            <svg className="w-3.5 h-3.5 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
            <span className="text-green-600">Copied!</span>
          </>
        ) : (
          <>
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
            </svg>
            <span>Copy Link</span>
          </>
        )}
      </button>

      <button
        onClick={handleTwitterShare}
        className="flex items-center gap-1.5 px-3 py-1.5 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg text-xs text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white hover:border-gray-300 dark:hover:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors font-medium"
        title="Share on X"
      >
        <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor">
          <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
        </svg>
        <span>Share</span>
      </button>
    </div>
  );
}
