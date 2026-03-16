"use client";

import { useState } from "react";
import Link from "next/link";
import WalletConnect from "./WalletConnect";

export default function MobileNav() {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className="md:hidden">
      {/* Hamburger Button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white transition-colors"
        aria-label="Menu"
      >
        {isOpen ? (
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        ) : (
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        )}
      </button>

      {/* Mobile Menu Backdrop + Dropdown */}
      {isOpen && (
        <>
        <div className="fixed inset-0 z-40" onClick={() => setIsOpen(false)} />
        <div className="absolute top-16 left-0 right-0 bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700 shadow-lg z-50 p-4 space-y-4">
          <nav className="flex flex-col gap-1">
            <Link
              href="/"
              onClick={() => setIsOpen(false)}
              className="text-sm font-medium text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white py-2 px-3 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
            >
              Markets
            </Link>
            <Link
              href="/portfolio"
              onClick={() => setIsOpen(false)}
              className="text-sm font-medium text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white py-2 px-3 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
            >
              Portfolio
            </Link>
            <Link
              href="/create"
              onClick={() => setIsOpen(false)}
              className="text-sm font-medium text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white py-2 px-3 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
            >
              Create
            </Link>
          </nav>

          {/* Wallet on mobile */}
          <div className="pt-3 border-t border-gray-100 dark:border-gray-800">
            <WalletConnect />
          </div>
        </div>
        </>
      )}
    </div>
  );
}
