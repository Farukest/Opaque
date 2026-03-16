"use client";

import { useState } from "react";

export function PrivacyBadge({ type }: { type: "encrypted" | "hidden" | "public" }) {
  const config = {
    encrypted: { label: "Encrypted", bg: "bg-green-50 dark:bg-green-900/30", text: "text-green-700", border: "border-green-200" },
    hidden: { label: "Hidden", bg: "bg-blue-50 dark:bg-blue-900/30", text: "text-blue-700", border: "border-blue-200" },
    public: { label: "Public", bg: "bg-amber-50 dark:bg-amber-900/30", text: "text-amber-700", border: "border-amber-200" },
  };

  const c = config[type];

  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium ${c.bg} ${c.text} border ${c.border}`}>
      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        {type === "encrypted" && (
          <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
        )}
        {type === "hidden" && (
          <path strokeLinecap="round" strokeLinejoin="round" d="M3.98 8.223A10.477 10.477 0 001.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.45 10.45 0 0112 4.5c4.756 0 8.773 3.162 10.065 7.498a10.523 10.523 0 01-4.293 5.774M6.228 6.228L3 3m3.228 3.228l3.65 3.65m7.894 7.894L21 21m-3.228-3.228l-3.65-3.65m0 0a3 3 0 10-4.243-4.243m4.242 4.242L9.88 9.88" />
        )}
        {type === "public" && (
          <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" />
        )}
      </svg>
      {c.label}
    </span>
  );
}

export function PrivacyInfo() {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden">
      {/* Collapsed: subtle badge */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
      >
        <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400">
          <svg className="w-4 h-4 text-gray-400 dark:text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
          </svg>
          <span className="font-medium">Orders encrypted via FHE</span>
        </div>
        <svg
          className={`w-4 h-4 text-gray-400 dark:text-gray-500 transition-transform ${expanded ? "rotate-180" : ""}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* Expanded: privacy details */}
      {expanded && (
        <div className="px-4 pb-4 space-y-2 border-t border-gray-200 dark:border-gray-700 pt-3">
          <h4 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Privacy Guarantees</h4>
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm">
              <svg className="w-4 h-4 text-green-600 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
              <span className="text-gray-700 dark:text-gray-300">Your bet direction: </span>
              <PrivacyBadge type="encrypted" />
            </div>
            <div className="flex items-center gap-2 text-sm">
              <svg className="w-4 h-4 text-green-600 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
              <span className="text-gray-700 dark:text-gray-300">Your bet amount: </span>
              <PrivacyBadge type="encrypted" />
            </div>
            <div className="flex items-center gap-2 text-sm">
              <svg className="w-4 h-4 text-green-600 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
              <span className="text-gray-700 dark:text-gray-300">Order sides: </span>
              <PrivacyBadge type="hidden" />
            </div>
            <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400 mt-1">
              <svg className="w-4 h-4 text-blue-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12V8.25z" />
              </svg>
              <span>Only YOU can see your position via view key</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
