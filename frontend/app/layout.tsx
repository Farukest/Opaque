import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Image from "next/image";
import Link from "next/link";
import WalletConnect from "../components/WalletConnect";
import Web3Provider from "../components/Web3Provider";
import MobileNav from "../components/MobileNav";
import ErrorBoundary from "../components/ErrorBoundary";
import ThemeToggle from "../components/ThemeToggle";
import { ThemeProvider } from "../lib/themeContext";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "OPAQUE - Private Prediction Markets",
  description: "FHE-powered dark pool prediction market. Where bets are private but odds are public.",
  icons: {
    icon: "/opaquelogo.png",
    apple: "/opaquelogo.png",
  },
  openGraph: {
    title: "OPAQUE - Private Prediction Markets",
    description: "FHE-powered dark pool prediction market. Where bets are private but odds are public.",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "OPAQUE - Private Prediction Markets",
    description: "FHE-powered dark pool prediction market. Where bets are private but odds are public.",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem("opaque-theme");if(t==="dark"||(!t&&window.matchMedia("(prefers-color-scheme:dark)").matches)){document.documentElement.classList.add("dark")}}catch(e){}})();`,
          }}
        />
      </head>
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased min-h-screen bg-white dark:bg-[#0a0a0f] text-gray-900 dark:text-gray-100 transition-colors duration-200`}>
        <ThemeProvider>
          <Web3Provider>
            {/* Header */}
            <header className="bg-white/80 dark:bg-[#0a0a0f]/80 backdrop-blur-md border-b border-gray-100 dark:border-gray-800 sticky top-0 z-50 transition-colors duration-200">
              <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                <div className="flex items-center justify-between h-16">
                  {/* Logo */}
                  <Link href="/" className="flex items-center gap-2">
                    <Image
                      src="/opaquelogo.png"
                      alt="OPAQUE"
                      width={36}
                      height={36}
                      className="rounded-lg"
                    />
                    <span className="text-xl font-bold text-gray-900 dark:text-white tracking-tight">
                      OPAQUE
                    </span>
                  </Link>

                  {/* Desktop Nav */}
                  <nav className="hidden md:flex items-center gap-1">
                    <Link
                      href="/"
                      className="text-sm font-medium text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg px-3 py-2 transition-colors"
                    >
                      Markets
                    </Link>
                    <Link
                      href="/portfolio"
                      className="text-sm font-medium text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg px-3 py-2 transition-colors"
                    >
                      Portfolio
                    </Link>
                    <Link
                      href="/create"
                      className="text-sm font-medium text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg px-3 py-2 transition-colors"
                    >
                      Create
                    </Link>
                  </nav>

                  {/* Right: Theme Toggle + Wallet + Mobile Menu */}
                  <div className="flex items-center gap-2">
                    <ThemeToggle />
                    <div className="hidden sm:block">
                      <WalletConnect />
                    </div>
                    <MobileNav />
                  </div>
                </div>
              </div>
            </header>

            {/* Main */}
            <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
              <ErrorBoundary>
                {children}
              </ErrorBoundary>
            </main>

            {/* Footer */}
            <footer className="border-t border-gray-100 dark:border-gray-800 mt-16 transition-colors">
              <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
                <div className="flex flex-col sm:flex-row items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Image src="/opaquelogo.png" alt="OPAQUE" width={20} height={20} className="rounded" />
                    <span className="text-sm text-gray-400 dark:text-gray-500">
                      Opaque — FHE-Powered Private Prediction Markets
                    </span>
                  </div>
                  <span className="text-xs text-gray-400 dark:text-gray-600">
                    Powered by Zama fhEVM
                  </span>
                </div>
              </div>
            </footer>
          </Web3Provider>
        </ThemeProvider>
      </body>
    </html>
  );
}
