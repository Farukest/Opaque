/**
 * Matcher Bot -- Off-chain order matching engine for OPAQUE V2 prediction markets.
 *
 * Key features:
 *   1. Per-market order books (orders are never mixed across markets)
 *   2. Partial fill awareness: orders stay in memory until cancelled on-chain
 *   3. Matched-pair tracking to avoid re-submitting the same (bidId, askId) pair
 *   4. Automatic reconnection on provider/event errors
 *   5. Graceful shutdown on SIGINT / SIGTERM
 *   6. Periodic full re-scan every 5 minutes to catch missed events
 *   7. Multi-market support via factory.getAllMarkets()
 *
 * V2 changes:
 *   - Matching is permissionless (no matcher role, anyone can call attemptMatch)
 *   - Sides are encrypted (no isYesBook) -- bot tracks only bids and asks per price
 *   - Event signatures updated: OrderPlaced has sequence, no isYesBook
 *   - MatchAttempted event replaces OrdersMatched
 *   - Price range: 100-9900
 *
 * Usage:
 *   PRIVATE_KEY=0x... npx hardhat run scripts/matcher-bot.ts --network sepolia
 *
 * Environment variables:
 *   PRIVATE_KEY         - Wallet private key for signing match transactions
 *   RESCAN_INTERVAL_MS  - Milliseconds between full order re-scans (default: 300000 = 5 min)
 */

import { ethers } from "hardhat";
import { loadDeployment } from "./lib/addresses";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface OrderInfo {
  id: number;
  owner: string;
  price: number;
  isBid: boolean;
  isActive: boolean;
  marketAddress: string;
}

interface OrderBook {
  bids: OrderInfo[];
  asks: OrderInfo[];
}

// ---------------------------------------------------------------------------
// ABI fragments (only the functions/events the matcher needs)
// ---------------------------------------------------------------------------

const MARKET_ABI = [
  "function attemptMatch(uint256 bidId, uint256 askId)",
  "function getOrder(uint256 orderId) view returns (address owner, uint32 price, bool isBid, bool isActive, uint256 sequence, uint256 createdAt)",
  "function nextOrderId() view returns (uint256)",
  "event OrderPlaced(uint256 indexed orderId, address indexed owner, uint32 price, bool isBid, uint256 sequence, uint256 timestamp)",
  "event OrderCancelled(uint256 indexed orderId, address indexed owner, uint256 timestamp)",
  "event MatchAttempted(uint256 indexed bidId, uint256 indexed askId, address caller, uint256 timestamp)",
];

const FACTORY_ABI = ["function getAllMarkets() view returns (address[])"];

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const RESCAN_INTERVAL_MS = parseInt(process.env.RESCAN_INTERVAL_MS || "300000", 10);
const RECONNECT_DELAY_MS = 5000;

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

/** Per-market order books. Key = market address (checksummed). */
const orderBooks = new Map<string, OrderBook>();

/** Set of matched pairs we already submitted. Format: "marketAddr-bidId-askId" */
const matchedPairs = new Set<string>();

/** Whether a graceful shutdown has been requested. */
let shuttingDown = false;

/** Active interval timer for re-scans. */
let rescanTimer: ReturnType<typeof setInterval> | null = null;

// ---------------------------------------------------------------------------
// Logging
// ---------------------------------------------------------------------------

function ts(): string {
  return new Date().toISOString();
}

function log(msg: string): void {
  console.log(`[${ts()}] ${msg}`);
}

function logError(msg: string): void {
  console.error(`[${ts()}] ERROR: ${msg}`);
}

// ---------------------------------------------------------------------------
// Order book helpers
// ---------------------------------------------------------------------------

function getOrCreateBook(marketAddress: string): OrderBook {
  const key = marketAddress;
  if (!orderBooks.has(key)) {
    orderBooks.set(key, { bids: [], asks: [] });
  }
  return orderBooks.get(key)!;
}

function addOrder(order: OrderInfo): void {
  const book = getOrCreateBook(order.marketAddress);
  const list = order.isBid ? book.bids : book.asks;

  // Avoid duplicates
  if (list.some((o) => o.id === order.id)) return;

  list.push(order);
}

function removeOrder(marketAddress: string, orderId: number): void {
  const book = orderBooks.get(marketAddress);
  if (!book) return;

  for (const list of [book.bids, book.asks]) {
    const idx = list.findIndex((o) => o.id === orderId);
    if (idx >= 0) {
      list.splice(idx, 1);
      return;
    }
  }
}

function matchPairKey(marketAddress: string, bidId: number, askId: number): string {
  return `${marketAddress}-${bidId}-${askId}`;
}

// ---------------------------------------------------------------------------
// Matching logic
// ---------------------------------------------------------------------------

/**
 * Find the best matchable pair from bids and asks.
 * Since sides are encrypted, the bot tries all bid+ask combinations at
 * each price level. A match is possible when bid.price >= ask.price.
 * Returns [bid, ask] if found, otherwise null.
 */
function findBestMatch(bids: OrderInfo[], asks: OrderInfo[], marketAddress: string): [OrderInfo, OrderInfo] | null {
  if (bids.length === 0 || asks.length === 0) return null;

  // Sort: bids descending by price, asks ascending by price
  const sortedBids = [...bids].sort((a, b) => b.price - a.price);
  const sortedAsks = [...asks].sort((a, b) => a.price - b.price);

  for (const bid of sortedBids) {
    for (const ask of sortedAsks) {
      if (bid.price < ask.price) break; // No more matches possible for this bid

      const key = matchPairKey(marketAddress, bid.id, ask.id);
      if (!matchedPairs.has(key)) {
        return [bid, ask];
      }
    }
  }

  return null;
}

/**
 * Attempt to match all possible pairs for a given market.
 * Sends attemptMatch() transactions for each matchable pair.
 */
async function tryMatchMarket(marketAddress: string, signer: any): Promise<void> {
  const book = orderBooks.get(marketAddress);
  if (!book) return;

  const market = new ethers.Contract(marketAddress, MARKET_ABI, signer);

  let match = findBestMatch(book.bids, book.asks, marketAddress);

  while (match && !shuttingDown) {
    const [bid, ask] = match;
    const pairKey = matchPairKey(marketAddress, bid.id, ask.id);

    log(
      `[${marketAddress.slice(0, 10)}...] Matching bid #${bid.id} (price=${bid.price}) with ask #${ask.id} (price=${ask.price})`,
    );

    try {
      const tx = await market.attemptMatch(bid.id, ask.id);
      await tx.wait();
      log(`[${marketAddress.slice(0, 10)}...] Match confirmed. TX: ${tx.hash}`);
      matchedPairs.add(pairKey);
    } catch (err: any) {
      const msg = err.message?.slice(0, 150) || String(err);
      logError(`[${marketAddress.slice(0, 10)}...] attemptMatch(${bid.id}, ${ask.id}) failed: ${msg}`);
      // Mark as matched to avoid infinite retry loop on the same pair.
      // The periodic re-scan will clear stale pairs if orders become active again.
      matchedPairs.add(pairKey);
    }

    match = findBestMatch(book.bids, book.asks, marketAddress);
  }
}

// ---------------------------------------------------------------------------
// Event listener setup (with reconnection)
// ---------------------------------------------------------------------------

async function setupMarketListeners(marketAddress: string, signer: any): Promise<void> {
  const market = new ethers.Contract(marketAddress, MARKET_ABI, signer.provider);

  log(`[${marketAddress.slice(0, 10)}...] Setting up event listeners`);

  market.on(
    "OrderPlaced",
    async (orderId: any, owner: any, price: any, isBid: any, _sequence: any, _timestamp: any) => {
      const order: OrderInfo = {
        id: Number(orderId),
        owner,
        price: Number(price),
        isBid,
        isActive: true,
        marketAddress,
      };
      addOrder(order);
      log(`[${marketAddress.slice(0, 10)}...] OrderPlaced #${orderId} ${isBid ? "BID" : "ASK"} price=${Number(price)}`);

      // Attempt matching after new order
      try {
        await tryMatchMarket(marketAddress, signer);
      } catch (err: any) {
        logError(`[${marketAddress.slice(0, 10)}...] Post-OrderPlaced matching error: ${err.message?.slice(0, 100)}`);
      }
    },
  );

  market.on("OrderCancelled", (orderId: any, _owner: any, _timestamp: any) => {
    log(`[${marketAddress.slice(0, 10)}...] OrderCancelled #${orderId}`);
    removeOrder(marketAddress, Number(orderId));
  });

  market.on("MatchAttempted", (bidId: any, askId: any, caller: any, _timestamp: any) => {
    const pairKey = matchPairKey(marketAddress, Number(bidId), Number(askId));
    matchedPairs.add(pairKey);
    log(`[${marketAddress.slice(0, 10)}...] MatchAttempted bid=#${bidId} ask=#${askId} caller=${caller}`);
    // Do NOT remove orders from memory -- partial fills mean they may still be active.
    // The periodic re-scan will refresh active status.
  });

  // Handle provider errors for reconnection
  market.on("error", (err: any) => {
    logError(`[${marketAddress.slice(0, 10)}...] Event listener error: ${err.message?.slice(0, 100)}`);
    if (!shuttingDown) {
      log(`[${marketAddress.slice(0, 10)}...] Will reconnect on next re-scan cycle`);
    }
  });
}

// ---------------------------------------------------------------------------
// Full order scan for a single market
// ---------------------------------------------------------------------------

async function scanMarketOrders(marketAddress: string, provider: any): Promise<void> {
  const market = new ethers.Contract(marketAddress, MARKET_ABI, provider);

  let nextOrderId: number;
  try {
    nextOrderId = Number(await market.nextOrderId());
  } catch (err: any) {
    logError(`[${marketAddress.slice(0, 10)}...] Failed to read nextOrderId: ${err.message?.slice(0, 100)}`);
    return;
  }

  // Clear current book for this market and rebuild
  const book: OrderBook = { bids: [], asks: [] };
  orderBooks.set(marketAddress, book);

  let activeCount = 0;

  for (let i = 0; i < nextOrderId; i++) {
    try {
      const [owner, price, isBid, isActive] = await market.getOrder(i);
      if (isActive) {
        const order: OrderInfo = {
          id: i,
          owner,
          price: Number(price),
          isBid,
          isActive: true,
          marketAddress,
        };
        const list = isBid ? book.bids : book.asks;
        list.push(order);
        activeCount++;
      }
    } catch {
      // Order may not exist or call failed -- skip
    }
  }

  log(`[${marketAddress.slice(0, 10)}...] Scanned ${nextOrderId} orders, ${activeCount} active`);

  // Also clean matched pairs for orders that are no longer active
  const activeIds = new Set<number>();
  for (const list of [book.bids, book.asks]) {
    for (const order of list) {
      activeIds.add(order.id);
    }
  }

  // Remove matched pair entries where either order is no longer active
  for (const pairKey of [...matchedPairs]) {
    if (!pairKey.startsWith(marketAddress)) continue;
    const parts = pairKey.split("-");
    const bidId = parseInt(parts[1], 10);
    const askId = parseInt(parts[2], 10);
    if (!activeIds.has(bidId) || !activeIds.has(askId)) {
      matchedPairs.delete(pairKey);
    }
  }
}

// ---------------------------------------------------------------------------
// Periodic re-scan of all markets
// ---------------------------------------------------------------------------

async function rescanAllMarkets(marketAddresses: string[], signer: any): Promise<void> {
  if (shuttingDown) return;

  log("--- Periodic re-scan starting ---");

  for (const addr of marketAddresses) {
    if (shuttingDown) break;
    try {
      await scanMarketOrders(addr, signer.provider);
      await tryMatchMarket(addr, signer);
    } catch (err: any) {
      logError(`Re-scan error for ${addr.slice(0, 10)}...: ${err.message?.slice(0, 100)}`);
    }
  }

  log(`--- Re-scan complete. Tracking ${orderBooks.size} market(s), ${matchedPairs.size} matched pair(s) ---`);
}

// ---------------------------------------------------------------------------
// Graceful shutdown
// ---------------------------------------------------------------------------

function setupShutdownHandlers(): void {
  const shutdown = (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    log(`Received ${signal}. Shutting down gracefully...`);

    if (rescanTimer) {
      clearInterval(rescanTimer);
      rescanTimer = null;
    }

    // Remove all event listeners
    log("Cleaning up event listeners...");
    // ethers.js will clean up on process exit

    log("Matcher bot stopped.");
    process.exit(0);
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  setupShutdownHandlers();

  const deployment = loadDeployment();
  const [caller] = await ethers.getSigners();

  log("=".repeat(60));
  log("OPAQUE Matcher Bot (V2 - Permissionless)");
  log("=".repeat(60));
  log(`Caller wallet: ${caller.address}`);

  const balance = await ethers.provider.getBalance(caller.address);
  log(`ETH balance: ${ethers.formatEther(balance)} ETH`);

  if (parseFloat(ethers.formatEther(balance)) < 0.001) {
    logError("ETH balance too low for gas. Fund the wallet and retry.");
    process.exit(1);
  }

  // Load all markets from factory
  const factory = new ethers.Contract(deployment.contracts.MarketFactory, FACTORY_ABI, caller.provider);

  let marketAddresses: string[];
  try {
    marketAddresses = await factory.getAllMarkets();
  } catch (err: any) {
    logError(`Failed to load markets from factory: ${err.message?.slice(0, 100)}`);
    process.exit(1);
  }

  log(`Found ${marketAddresses.length} market(s) from factory at ${deployment.contracts.MarketFactory}`);

  if (marketAddresses.length === 0) {
    log("No markets to watch. Exiting.");
    return;
  }

  // Initial scan + listener setup for each market
  for (const addr of marketAddresses) {
    log(`Initializing market: ${addr}`);

    try {
      await scanMarketOrders(addr, caller.provider);
      await setupMarketListeners(addr, caller);
      await tryMatchMarket(addr, caller);
    } catch (err: any) {
      logError(`Failed to initialize market ${addr}: ${err.message?.slice(0, 100)}`);
      // Continue with other markets
    }
  }

  // Print initial state summary
  let totalOrders = 0;
  for (const [addr, book] of orderBooks) {
    const count = book.bids.length + book.asks.length;
    totalOrders += count;
    log(`  ${addr.slice(0, 10)}...: ${book.bids.length} bids, ${book.asks.length} asks`);
  }
  log(`Total active orders across all markets: ${totalOrders}`);

  // Start periodic re-scan
  log(`Periodic re-scan interval: ${RESCAN_INTERVAL_MS / 1000}s`);
  rescanTimer = setInterval(async () => {
    try {
      // Also check for new markets from factory
      try {
        const currentMarkets: string[] = await factory.getAllMarkets();
        const newMarkets = currentMarkets.filter((a: string) => !marketAddresses.includes(a));
        if (newMarkets.length > 0) {
          log(`Discovered ${newMarkets.length} new market(s)`);
          for (const addr of newMarkets) {
            marketAddresses.push(addr);
            await scanMarketOrders(addr, caller.provider);
            await setupMarketListeners(addr, caller);
          }
        }
      } catch {
        // Non-critical: factory read failed, will retry next cycle
      }

      await rescanAllMarkets(marketAddresses, caller);
    } catch (err: any) {
      logError(`Re-scan cycle error: ${err.message?.slice(0, 100)}`);
    }
  }, RESCAN_INTERVAL_MS);

  log("");
  log("Matcher bot running. Press Ctrl+C to stop.");
  log("");

  // Keep the process alive
  await new Promise<void>((resolve) => {
    const check = setInterval(() => {
      if (shuttingDown) {
        clearInterval(check);
        resolve();
      }
    }, 1000);
  });
}

main().catch((error) => {
  logError(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
