/**
 * Simulation Bot — Creates fake trading activity on OPAQUE markets.
 *
 * Uses 2 wallets to avoid NoSelfMatch. Places random YES/NO orders at
 * various price levels, then matches them. This moves prices away from 50%
 * and makes the frontend look alive.
 *
 * Usage:
 *   npx hardhat run scripts/sim-bot.ts --network sepolia
 *
 * Runs continuously (Ctrl+C to stop).
 */

import { ethers, fhevm } from "hardhat";
import { loadDeployment } from "./lib/addresses";

const SIDE_YES = 0;
const SIDE_NO = 1;
const ROUND_DELAY_MS = 45_000; // 45 seconds between rounds
const MINT_AMOUNT = 50_000_000n; // 50 shares per mint
const ORDER_SIZE = 5_000_000n; // 5 shares per order

// Price levels that create interesting spreads (in BPS, 100-9900)
const PRICE_RANGE = { min: 2000, max: 8000 };

// Retry config for flaky Sepolia RPC
const MAX_RETRIES = 5;
const BASE_DELAY_MS = 3_000;

let shuttingDown = false;

function ts(): string {
  return new Date().toISOString().slice(11, 19);
}

function log(msg: string): void {
  console.log(`[${ts()}] ${msg}`);
}

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/** Round price to nearest 500 BPS (e.g. 3000, 3500, 4000...) */
function roundPrice(price: number): number {
  return Math.round(price / 500) * 500;
}

/** Retry wrapper with exponential backoff for flaky Sepolia RPC */
async function withRetry<T>(fn: () => Promise<T>, label: string): Promise<T> {
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await fn();
    } catch (e: any) {
      const msg = e.message?.slice(0, 120) || String(e);
      const isRetryable =
        msg.includes("Timeout") ||
        msg.includes("ECONNRESET") ||
        msg.includes("ECONNREFUSED") ||
        msg.includes("ETIMEDOUT") ||
        msg.includes("fetch failed") ||
        msg.includes("network error") ||
        msg.includes("429") ||
        msg.includes("502") ||
        msg.includes("503");

      if (isRetryable && attempt < MAX_RETRIES) {
        const delay = BASE_DELAY_MS * Math.pow(2, attempt - 1) + randomInt(0, 2000);
        log(`  Retry ${attempt}/${MAX_RETRIES} for "${label}" in ${Math.round(delay / 1000)}s — ${msg}`);
        await new Promise((r) => setTimeout(r, delay));
      } else {
        throw e;
      }
    }
  }
  throw new Error(`Unreachable`);
}

function findEvent(contract: any, receipt: any, eventName: string) {
  for (const log of receipt.logs) {
    try {
      const parsed = contract.interface.parseLog({ topics: log.topics, data: log.data });
      if (parsed?.name === eventName) return parsed;
    } catch {}
  }
  return null;
}

async function encryptAndMint(market: any, marketAddr: string, signer: any, amount: bigint): Promise<any> {
  return withRetry(async () => {
    const input = fhevm.createEncryptedInput(marketAddr, await signer.getAddress());
    input.add64(amount);
    const enc = await input.encrypt();
    const tx = await market.connect(signer).mintShares(enc.handles[0], enc.inputProof, { gasLimit: 5_000_000 });
    return tx.wait();
  }, "mintShares");
}

async function encryptAndPlaceOrder(
  market: any,
  marketAddr: string,
  signer: any,
  side: number,
  price: number,
  isBid: boolean,
  amount: bigint,
): Promise<{ receipt: any; orderId: bigint }> {
  return withRetry(async () => {
    const input = fhevm.createEncryptedInput(marketAddr, await signer.getAddress());
    input.add8(side);
    input.add64(amount);
    const enc = await input.encrypt();
    const tx = await market
      .connect(signer)
      .placeOrder(enc.handles[0], price, isBid, enc.handles[1], enc.inputProof, enc.inputProof, {
        gasLimit: 5_000_000,
      });
    const receipt = await tx.wait();
    const event = findEvent(market, receipt, "OrderPlaced");
    return { receipt, orderId: event?.args?.orderId ?? 0n };
  }, "placeOrder");
}

// ─── Market sentiment profiles (creates diverse price action) ───
interface Sentiment {
  label: string;
  yesMin: number;
  yesMax: number;
}

const SENTIMENTS: Sentiment[] = [
  { label: "Strong YES", yesMin: 6500, yesMax: 8000 },
  { label: "Lean YES", yesMin: 5500, yesMax: 7000 },
  { label: "Neutral", yesMin: 4500, yesMax: 5500 },
  { label: "Lean NO", yesMin: 3000, yesMax: 4500 },
  { label: "Strong NO", yesMin: 2000, yesMax: 3500 },
];

// Per-market persistent sentiment (drifts slowly)
const marketSentiment = new Map<string, number>();

function getSentiment(marketAddr: string): Sentiment {
  let idx = marketSentiment.get(marketAddr);
  if (idx === undefined) {
    idx = randomInt(0, SENTIMENTS.length - 1);
    marketSentiment.set(marketAddr, idx);
  }

  // 30% chance to drift sentiment by 1
  if (Math.random() < 0.3) {
    const drift = Math.random() < 0.5 ? -1 : 1;
    idx = Math.max(0, Math.min(SENTIMENTS.length - 1, idx + drift));
    marketSentiment.set(marketAddr, idx);
  }

  return SENTIMENTS[idx];
}

// ─── Main ───

async function main() {
  process.on("SIGINT", () => {
    shuttingDown = true;
    log("Shutting down...");
  });
  process.on("SIGTERM", () => {
    shuttingDown = true;
  });

  // Prevent undici ConnectTimeoutError from killing the process
  process.on("uncaughtException", (err: any) => {
    log(`Uncaught exception (ignored): ${err.message?.slice(0, 100)}`);
  });
  process.on("unhandledRejection", (reason: any) => {
    log(`Unhandled rejection (ignored): ${reason?.message?.slice(0, 100) || String(reason).slice(0, 100)}`);
  });

  log("Initializing fhEVM...");
  try {
    await fhevm.initializeCLIApi();
    log("fhEVM initialized");
  } catch (e: any) {
    log(`fhEVM init warning: ${e.message?.slice(0, 80)}`);
  }

  const deployment = loadDeployment();
  const [deployer] = await ethers.getSigners();

  // Create bot wallet (deterministic)
  const botKey = ethers.keccak256(ethers.toUtf8Bytes("opaque-sim-bot-v3"));
  const bot = new ethers.Wallet(botKey, ethers.provider);
  log(`Deployer (A): ${deployer.address}`);
  log(`Bot (B):      ${bot.address}`);

  const token = await ethers.getContractAt("ConfidentialUSDT", deployment.contracts.ConfidentialUSDT);
  const factory = await ethers.getContractAt("MarketFactory", deployment.contracts.MarketFactory);

  // Fund bot wallet with ETH if needed
  const botBal = await withRetry(() => ethers.provider.getBalance(bot.address), "getBalance");
  if (botBal < ethers.parseEther("0.1")) {
    log("Funding bot with 0.3 ETH...");
    await withRetry(async () => {
      const tx = await deployer.sendTransaction({ to: bot.address, value: ethers.parseEther("0.3") });
      await tx.wait();
    }, "fundBot");
  }

  // Mint cUSDT to both wallets
  log("Minting cUSDT...");
  await withRetry(async () => (await token.mint(deployer.address, 500_000_000_000n)).wait(), "mintUSDT-A");
  await withRetry(async () => (await token.mint(bot.address, 500_000_000_000n)).wait(), "mintUSDT-B");
  log("Both wallets funded with 500K cUSDT");

  // Track which markets have been set up (approved + shares minted)
  const setupMarkets = new Set<string>();

  let round = 0;
  log("\n=== Simulation Bot Running ===\n");

  while (!shuttingDown) {
    round++;
    try {
      // Get all active markets
      const allMarkets: string[] = await withRetry(() => factory.getAllMarkets(), "getAllMarkets");
      const block = await withRetry(() => ethers.provider.getBlock("latest"), "getBlock");
      const now = block!.timestamp;

      // Filter to active (not resolved, not expired) markets
      const activeMarkets: string[] = [];
      for (const addr of allMarkets) {
        try {
          const market = await ethers.getContractAt("OpaqueMarket", addr);
          const resolved = await withRetry(() => market.resolved(), "resolved");
          const deadline = await withRetry(() => market.deadline(), "deadline");
          if (!resolved && Number(deadline) > now) {
            activeMarkets.push(addr);
          }
        } catch {}
      }

      if (activeMarkets.length === 0) {
        log("No active markets. Waiting...");
        await new Promise((r) => setTimeout(r, 60_000));
        continue;
      }

      // Pick a random market
      const marketAddr = activeMarkets[randomInt(0, activeMarkets.length - 1)];
      const market = await ethers.getContractAt("OpaqueMarket", marketAddr);
      const question = (await withRetry(() => market.getMarketInfo(), "getMarketInfo"))[0] as string;
      const shortQ = question.length > 40 ? question.slice(0, 40) + "..." : question;

      log(`Round ${round} | ${shortQ}`);

      // Setup market if first time (approve + mint shares)
      if (!setupMarkets.has(marketAddr)) {
        log("  Setting up market (approve + mint)...");
        try {
          await withRetry(async () => (await token.approvePlaintext(marketAddr, 100_000_000_000n)).wait(), "approveA");
          await withRetry(
            async () => (await token.connect(bot).approvePlaintext(marketAddr, 100_000_000_000n)).wait(),
            "approveB",
          );
          await encryptAndMint(market, marketAddr, deployer, MINT_AMOUNT);
          await encryptAndMint(market, marketAddr, bot, MINT_AMOUNT);
          setupMarkets.add(marketAddr);
          log("  Setup complete");
        } catch (e: any) {
          log(`  Setup failed: ${e.message?.slice(0, 80)}`);
          await new Promise((r) => setTimeout(r, 10_000));
          continue;
        }
      }

      // Get sentiment for this market
      const sentiment = getSentiment(marketAddr);
      const yesPrice = roundPrice(randomInt(sentiment.yesMin, sentiment.yesMax));
      // Clamp to valid range
      const price = Math.max(500, Math.min(9500, yesPrice));

      log(`  Sentiment: ${sentiment.label} | Price: ${price} (${(price / 100).toFixed(0)}%)`);

      // Strategy: Wallet A places a bid, Wallet B places an ask at same price
      // Random who gets YES vs NO
      const aIsYes = Math.random() > 0.5;
      const aSide = aIsYes ? SIDE_YES : SIDE_NO;
      const bSide = aIsYes ? SIDE_NO : SIDE_YES;

      try {
        // Place bid (Wallet A)
        const { orderId: bidId } = await encryptAndPlaceOrder(
          market,
          marketAddr,
          deployer,
          aSide,
          price,
          true,
          ORDER_SIZE,
        );
        log(`  A placed bid #${bidId} (${aIsYes ? "YES" : "NO"} @ ${price})`);

        // Place ask (Wallet B)
        const { orderId: askId } = await encryptAndPlaceOrder(market, marketAddr, bot, bSide, price, false, ORDER_SIZE);
        log(`  B placed ask #${askId} (${bSide === SIDE_YES ? "YES" : "NO"} @ ${price})`);

        // Match them
        await withRetry(async () => {
          const matchTx = await market.attemptMatch(bidId, askId, { gasLimit: 3_000_000 });
          await matchTx.wait();
        }, "attemptMatch");
        log(`  Matched #${bidId} x #${askId}`);

        // Log current prices
        const [yp, np] = await withRetry(() => market.getCurrentPrice(), "getCurrentPrice");
        log(`  Prices → YES: ${Number(yp) / 100}% | NO: ${Number(np) / 100}%`);
      } catch (e: any) {
        const msg = e.message?.slice(0, 100) || String(e);
        log(`  Order/match failed: ${msg}`);

        // If shares ran out, mint more
        if (msg.includes("revert") || msg.includes("insufficient")) {
          log("  Re-minting shares...");
          try {
            await encryptAndMint(market, marketAddr, deployer, MINT_AMOUNT);
            await encryptAndMint(market, marketAddr, bot, MINT_AMOUNT);
          } catch {}
        }
      }
    } catch (e: any) {
      log(`Round ${round} error: ${e.message?.slice(0, 100)}`);
      // Extra cooldown after round-level failure (likely persistent RPC issue)
      log("  Cooling down 60s after round error...");
      await new Promise((r) => setTimeout(r, 60_000));
      continue;
    }

    // Wait between rounds
    const delay = ROUND_DELAY_MS + randomInt(-10_000, 10_000);
    log(`  Next round in ${Math.round(delay / 1000)}s\n`);
    await new Promise((r) => setTimeout(r, delay));
  }

  log("Simulation bot stopped.");
}

main().catch((err) => {
  console.error("Fatal:", err.message || err);
  process.exit(1);
});
