import { DEPLOYED } from "./wagmi";

// Consistent polling interval for all hooks (10 seconds)
export const POLL_INTERVAL = 10_000;

// Contract addresses from Sepolia deployment
export const CONTRACTS = {
  MARKET_FACTORY: DEPLOYED.MarketFactory,
  ORACLE_RESOLVER: DEPLOYED.OracleResolver,
  CUSDT: DEPLOYED.ConfidentialUSDT,
};

// Source type filters (based on resolution source type)
export const SOURCE_TYPE_FILTERS = [
  { label: "All", value: "all" },
  { label: "Oracle", value: "crypto" },
  { label: "API", value: "api" },
  { label: "Multi-sig", value: "manual" },
];

// Topic categories (stored on-chain per market)
export const TOPIC_CATEGORIES = [
  { label: "All", value: "all" },
  { label: "Crypto", value: "crypto" },
  { label: "Politics", value: "politics" },
  { label: "Sports", value: "sports" },
  { label: "Tech", value: "tech" },
  { label: "Entertainment", value: "entertainment" },
  { label: "Science", value: "science" },
];

// Standard price levels for order book display ($0.05 - $0.95 in 5c increments)
// V2 price range: 100-9900 (BPS=10000), so 500 = $0.05, 9500 = $0.95
export const PRICE_LEVELS = [
  500, 1000, 1500, 2000, 2500, 3000, 3500, 4000, 4500, 5000, 5500, 6000, 6500, 7000, 7500, 8000, 8500, 9000, 9500,
];

// Market data interface (matches OpaqueMarket.getMarketInfo() + getCurrentPrice())
export interface Market {
  id: string;
  address: string;
  question: string;
  deadline: number;
  resolved: boolean;
  outcome: boolean;
  totalSharesMinted: number;
  activeOrderCount: number;
  resolutionSource: string;
  resolutionSourceType: string;
  resolutionCriteria: string;
  category: string;
  // Prices from getCurrentPrice() — BPS (100-9900)
  yesPrice: number;
  noPrice: number;
}

// Multi-outcome market group data
export interface MarketGroupData {
  address: string;
  question: string;
  category: string;
  outcomeCount: number;
  resolved: boolean;
  winningIndex: number;
  outcomes: {
    label: string;
    market: string;
    yesPrice: number;
    noPrice: number;
    resolved: boolean;
    outcome: boolean;
  }[];
}

// Order data from getOrder()
export interface OrderInfo {
  id: number;
  owner: string;
  price: number;
  isBid: boolean;
  isActive: boolean;
  sequence: number;
  createdAt: number;
}

// Format price from BPS to dollar string (V2: 100-9900, BPS=10000)
export function formatPrice(price: number): string {
  return `$${(price / 10_000).toFixed(2)}`;
}

// Format price as percentage (V2: 5000 → 50.0%)
export function priceToPercent(price: number): number {
  return price / 100;
}
