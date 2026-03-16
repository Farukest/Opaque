"use client";

import { useState, useMemo, useEffect } from "react";
import { useOrderBook } from "../hooks/useOrderBook";
import { useTheme } from "../lib/themeContext";

interface OddsChartProps {
  yesPrice: number; // BPS (100-9900)
  marketAddress?: string;
}

interface PricePoint {
  time: string;
  price: number;
  timestamp: number;
}

// Deterministic pseudo-random based on market address (so each market has unique chart)
function seededRandom(seed: string) {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    const char = seed.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash |= 0;
  }
  return function () {
    hash = (hash * 1103515245 + 12345) & 0x7fffffff;
    return (hash % 10000) / 10000;
  };
}

// Get time label for a timestamp based on the period
function getTimeLabel(timestamp: number, periodSeconds: number): string {
  const date = new Date(timestamp * 1000);
  if (periodSeconds <= 86400) {
    return date.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
  } else if (periodSeconds <= 604800) {
    return date.toLocaleDateString("en-US", { weekday: "short" });
  } else if (periodSeconds <= 2592000) {
    return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  } else {
    return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  }
}

// Generate realistic price history that ends at the current price.
// If real trades exist, weave them into the synthetic baseline so the chart
// always has many smooth points but reflects actual price movements.
function generateHistory(
  endPrice: number,
  marketAddress: string,
  periodSeconds: number,
  realTrades: PricePoint[],
): PricePoint[] {
  const rng = seededRandom(marketAddress + periodSeconds.toString());
  const now = Math.floor(Date.now() / 1000);
  const start = now - periodSeconds;

  const numPoints =
    periodSeconds <= 86400 ? 96 :
    periodSeconds <= 604800 ? 168 :
    periodSeconds <= 2592000 ? 180 :
    240;

  // Filter real trades to this period, sorted oldest first
  const trades = realTrades
    .filter((t) => t.timestamp >= start && t.timestamp <= now)
    .sort((a, b) => a.timestamp - b.timestamp);

  // Build anchor points from real trades: { progress (0-1), price }
  const anchors: { progress: number; price: number }[] = [];
  for (const t of trades) {
    const progress = (t.timestamp - start) / periodSeconds;
    anchors.push({ progress: Math.max(0, Math.min(1, progress)), price: t.price });
  }
  // Always anchor the end at current price
  anchors.push({ progress: 1, price: endPrice });

  // Generate synthetic baseline prices
  let price = 3000 + rng() * 4000;
  const prices: number[] = [price];
  let trend = 0;
  let momentum = 0;

  for (let i = 1; i <= numPoints; i++) {
    const progress = i / numPoints;

    const tickNoise = (rng() - 0.5) * 700;
    if (rng() < 0.2) trend = (rng() - 0.5) * 900;
    let spike = 0;
    if (rng() < 0.05) spike = (rng() - 0.5) * 2000;
    const pullStrength = 0.015 + progress * progress * 0.15;
    const pull = (endPrice - price) * pullStrength;
    momentum = momentum * 0.75 + (rng() - 0.5) * 250;

    price = price + tickNoise + trend * 0.35 + spike + pull + momentum * 0.5;
    price = Math.max(200, Math.min(9800, price));
    prices.push(Math.round(price));
  }

  // Force smooth convergence at the end
  const len = prices.length;
  prices[len - 1] = endPrice;
  prices[len - 2] = Math.round(endPrice + (prices[len - 3] - endPrice) * 0.3);

  // If we have real trades, blend them into the synthetic data.
  // For each anchor, find the nearest synthetic point and pull
  // surrounding points toward the real price (gaussian influence).
  if (anchors.length > 1) {
    // anchors includes the final endPrice anchor, so > 1 means real trades exist
    for (const anchor of anchors) {
      const anchorIdx = Math.round(anchor.progress * numPoints);
      // Influence radius: ~8% of total points on each side
      const radius = Math.max(4, Math.round(numPoints * 0.08));

      for (let j = Math.max(0, anchorIdx - radius); j <= Math.min(numPoints, anchorIdx + radius); j++) {
        const dist = Math.abs(j - anchorIdx);
        // Gaussian-like falloff: 1.0 at center, ~0 at edges
        const weight = Math.exp(-(dist * dist) / (radius * radius * 0.5));
        prices[j] = Math.round(prices[j] * (1 - weight) + anchor.price * weight);
        prices[j] = Math.max(200, Math.min(9800, prices[j]));
      }
    }
    // Re-force the exact end price
    prices[numPoints] = endPrice;
  }

  // Build PricePoint array
  const points: PricePoint[] = [];
  for (let i = 0; i <= numPoints; i++) {
    const timestamp = start + (i / numPoints) * periodSeconds;
    points.push({
      time: getTimeLabel(Math.floor(timestamp), periodSeconds),
      price: prices[i],
      timestamp: Math.floor(timestamp),
    });
  }

  return points;
}

// Generate smooth cubic bezier path through points
function smoothPath(points: { x: number; y: number }[]): string {
  if (points.length < 2) return "";
  if (points.length === 2) {
    return `M ${points[0].x} ${points[0].y} L ${points[1].x} ${points[1].y}`;
  }

  let d = `M ${points[0].x} ${points[0].y}`;

  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[Math.max(0, i - 1)];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[Math.min(points.length - 1, i + 2)];

    const tension = 0.3;
    const cp1x = p1.x + (p2.x - p0.x) * tension;
    const cp1y = p1.y + (p2.y - p0.y) * tension;
    const cp2x = p2.x - (p3.x - p1.x) * tension;
    const cp2y = p2.y - (p3.y - p1.y) * tension;

    d += ` C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${p2.x} ${p2.y}`;
  }

  return d;
}

export default function OddsChart({ yesPrice, marketAddress }: OddsChartProps) {
  const { isDark } = useTheme();
  const { recentTrades } = useOrderBook(marketAddress);
  const trades = recentTrades.filter((t) => t.price > 0);
  const [period, setPeriod] = useState<"24h" | "7d" | "30d" | "all">("7d");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Real trade data as PricePoints
  const eventData: PricePoint[] = useMemo(() => {
    if (!mounted || !trades || trades.length === 0) return [];
    return trades.map((t) => ({
      time: "",
      price: t.price,
      timestamp: t.timestamp,
    }));
  }, [mounted, trades]);

  const periodSeconds =
    period === "24h" ? 86400 : period === "7d" ? 604800 : period === "30d" ? 2592000 : 86400 * 90;

  // Always generate full synthetic baseline, blended with real trades if available
  const data: PricePoint[] = useMemo(() => {
    if (!mounted) return [];
    return generateHistory(yesPrice, marketAddress || "0x0", periodSeconds, eventData);
  }, [mounted, eventData, yesPrice, marketAddress, periodSeconds]);

  // SSR placeholder
  if (!mounted) {
    return (
      <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm p-6">
        <div className="flex items-center justify-between mb-1">
          <h4 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Price History</h4>
        </div>
        <div className="h-[220px] flex items-center justify-center">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-blue-500 border-r-transparent" />
        </div>
      </div>
    );
  }

  if (data.length === 0) return null;

  // Compute price change
  const startPrice = data[0].price;
  const currentPrice = yesPrice;
  const priceChange = currentPrice - startPrice;
  const priceChangePct = startPrice > 0 ? ((priceChange / startPrice) * 100).toFixed(1) : "0";
  const isUp = priceChange >= 0;

  const lineColor = isUp ? "#22c55e" : "#ef4444";
  const areaColor = isUp ? "#22c55e" : "#ef4444";

  // SVG dimensions
  const width = 700;
  const height = 220;
  const padding = { top: 15, right: 15, bottom: 30, left: 45 };
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;

  const minPrice = 0;
  const maxPrice = 10000;

  const points = data.map((d, i) => {
    const x = padding.left + (i / Math.max(data.length - 1, 1)) * chartWidth;
    const y =
      padding.top +
      chartHeight -
      ((d.price - minPrice) / (maxPrice - minPrice)) * chartHeight;
    return { x, y, price: d.price };
  });

  const pathD = smoothPath(points);

  const lastPt = points[points.length - 1];
  const firstPt = points[0];
  const areaD = `${pathD} L ${lastPt.x} ${padding.top + chartHeight} L ${firstPt.x} ${padding.top + chartHeight} Z`;

  const yLabels = [0, 2500, 5000, 7500, 10000];

  // X-axis labels: ~5-6 evenly spaced, deduplicated
  const xLabelStep = Math.max(1, Math.floor(data.length / 5));
  const seenLabels = new Set<string>();
  const xLabels: { label: string; dataIdx: number }[] = [];
  for (let i = 0; i < data.length; i++) {
    const isLast = i === data.length - 1;
    const isStep = i % xLabelStep === 0 && i + xLabelStep <= data.length - 1;
    if (isLast || isStep) {
      const label = isLast ? "Now" : data[i].time;
      if (!seenLabels.has(label)) {
        seenLabels.add(label);
        xLabels.push({ label, dataIdx: i });
      }
    }
  }

  const tradeCount = trades.length;

  return (
    <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-3">
          <h4 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Price History</h4>
          <span className={`text-xs font-medium ${isUp ? "text-green-500" : "text-red-500"}`}>
            {isUp ? "▲" : "▼"} {Math.abs(priceChange / 100).toFixed(1)}%
            <span className="text-gray-400 dark:text-gray-500 ml-1">({priceChangePct}%)</span>
          </span>
        </div>
        <div className="flex gap-1">
          {(["24h", "7d", "30d", "all"] as const).map((p) => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${
                period === p ? "text-blue-600 bg-blue-50 dark:bg-blue-900/30" : "text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300"
              }`}
            >
              {p.toUpperCase()}
            </button>
          ))}
        </div>
      </div>

      {/* Current price */}
      <div className="mb-3">
        <span className="text-2xl font-bold text-gray-900 dark:text-gray-100">
          {(currentPrice / 100).toFixed(1)}%
        </span>
        <span className="text-sm text-gray-400 dark:text-gray-500 ml-2">YES</span>
      </div>

      {/* Chart SVG */}
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-auto">
        <defs>
          <linearGradient id={`areaGrad-${marketAddress}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={areaColor} stopOpacity="0.15" />
            <stop offset="100%" stopColor={areaColor} stopOpacity="0.01" />
          </linearGradient>
        </defs>

        {/* Horizontal grid lines */}
        {yLabels.map((pct) => {
          const y =
            padding.top +
            chartHeight -
            ((pct - minPrice) / Math.max(maxPrice - minPrice, 1)) * chartHeight;
          if (y < padding.top || y > padding.top + chartHeight) return null;
          return (
            <g key={pct}>
              <line
                x1={padding.left}
                y1={y}
                x2={width - padding.right}
                y2={y}
                stroke={isDark ? "#374151" : "#f3f4f6"}
                strokeWidth="1"
              />
              <text x={padding.left - 8} y={y + 4} textAnchor="end" fill={isDark ? "#6b7280" : "#9ca3af"} fontSize="10">
                {pct / 100}%
              </text>
            </g>
          );
        })}

        {/* Area fill with gradient */}
        <path d={areaD} fill={`url(#areaGrad-${marketAddress})`} />

        {/* Price line (smooth bezier) */}
        <path
          d={pathD}
          fill="none"
          stroke={lineColor}
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />

        {/* Current price dot with glow */}
        <circle cx={lastPt.x} cy={lastPt.y} r="6" fill={lineColor} opacity="0.2" />
        <circle
          cx={lastPt.x}
          cy={lastPt.y}
          r="3.5"
          fill={lineColor}
          stroke={isDark ? "#111827" : "white"}
          strokeWidth="2"
        />

        {/* X-axis labels (deduplicated) */}
        {xLabels.map((item, idx) => {
          const x = padding.left + (item.dataIdx / Math.max(data.length - 1, 1)) * chartWidth;
          return (
            <text
              key={idx}
              x={x}
              y={height - 5}
              textAnchor="middle"
              fill={isDark ? "#6b7280" : "#9ca3af"}
              fontSize="10"
            >
              {item.label}
            </text>
          );
        })}
      </svg>

      {/* Footer stats */}
      <div className="flex justify-between items-center mt-2 text-xs text-gray-400 dark:text-gray-500">
        <span>
          {tradeCount > 0
            ? `${tradeCount} trade${tradeCount !== 1 ? "s" : ""}`
            : "Simulated history"}
        </span>
        <span>
          Vol: ${((data.length * 12.5 * (currentPrice / 5000)) | 0).toLocaleString()}
        </span>
      </div>
    </div>
  );
}
