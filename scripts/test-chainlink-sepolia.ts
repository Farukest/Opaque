/**
 * Chainlink E2E Test on Ethereum Sepolia
 *
 * Tests:
 *   1. Create a market with Chainlink oracle type
 *   2. Configure Chainlink BTC/USD feed on OracleResolver
 *   3. Attempt resolveChainlink (will succeed if BTC price > threshold)
 *
 * Usage: npx hardhat run scripts/test-chainlink-sepolia.ts --network sepolia
 *
 * Chainlink Sepolia Price Feeds:
 *   BTC/USD: 0x1b44F3514812d835EB1BDB0acB33d3fA3351Ee43
 *   ETH/USD: 0x694AA1769357215DE4FAC081bf1f309aDC325306
 */

import { ethers } from "hardhat";
import { loadDeployment } from "./lib/addresses";

const deployment = loadDeployment();

// Chainlink Sepolia feeds (8 decimals)
const BTC_USD_FEED = "0x1b44F3514812d835EB1BDB0acB33d3fA3351Ee43";

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("=== Chainlink E2E Test on Sepolia ===\n");
  console.log("Account:", deployer.address);

  const factory = await ethers.getContractAt("MarketFactory", deployment.contracts.MarketFactory);
  const resolver = await ethers.getContractAt("OracleResolver", deployment.contracts.OracleResolver);

  // ========================================================
  // STEP 1: Read current BTC/USD price from Chainlink
  // ========================================================
  console.log("\n--- Step 1: Read BTC/USD Price ---");

  // Chainlink AggregatorV3Interface
  const feedAbi = [
    "function latestRoundData() external view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)",
    "function decimals() external view returns (uint8)",
    "function description() external view returns (string)",
  ];
  const feed = new ethers.Contract(BTC_USD_FEED, feedAbi, deployer);

  const [, price, , updatedAt] = await feed.latestRoundData();
  const decimals = await feed.decimals();
  const desc = await feed.description();

  const priceUsd = Number(price) / 10 ** Number(decimals);
  const latestBlock = await ethers.provider.getBlock("latest");
  const blockTimestamp = latestBlock!.timestamp;
  const staleness = blockTimestamp - Number(updatedAt);
  console.log(`Feed: ${desc}`);
  console.log(`Price: $${priceUsd.toLocaleString()}`);
  console.log(`Updated: ${staleness}s ago (${staleness < 3600 ? "FRESH" : "STALE"})`);

  // ========================================================
  // STEP 2: Create a test market
  // ========================================================
  console.log("\n--- Step 2: Create Chainlink Market ---");

  // Set threshold to current price - $1000 (so it resolves YES immediately)
  const thresholdPrice = BigInt(Math.floor(priceUsd - 1000)) * BigInt(10 ** Number(decimals));

  const now = blockTimestamp;
  const deadline = now + 120; // 2 minutes

  const question = `BTC > $${(Number(thresholdPrice) / 1e8).toLocaleString()} (Chainlink test ${new Date().toISOString()})`;
  console.log("Question:", question);
  console.log("Threshold:", Number(thresholdPrice) / 1e8, "USD");

  const createTx = await factory.createMarket(
    question,
    deadline,
    `Chainlink BTC/USD (${BTC_USD_FEED})`,
    "onchain_oracle",
    `>= ${Number(thresholdPrice) / 1e8}`,
    "crypto",
  );
  const createReceipt = await createTx.wait();
  console.log("✓ Market created. TX:", createTx.hash);

  // Find market address from event
  let marketAddress = "";
  for (const log of createReceipt!.logs) {
    try {
      const parsed = factory.interface.parseLog({ topics: [...log.topics], data: log.data });
      if (parsed?.name === "MarketCreated") {
        marketAddress = parsed.args.market;
        break;
      }
    } catch {
      // skip
    }
  }
  console.log("Market:", marketAddress);

  // ========================================================
  // STEP 3: Configure Chainlink feed on OracleResolver
  // ========================================================
  console.log("\n--- Step 3: Configure Chainlink Feed ---");

  const configTx = await resolver.configureChainlink(
    marketAddress,
    BTC_USD_FEED,
    thresholdPrice,
    true, // threshold above = YES when price >= threshold
    3600, // maxStaleness: 1 hour
  );
  await configTx.wait();
  console.log("✓ Chainlink feed configured. TX:", configTx.hash);

  // Verify config
  const config = await resolver.getConfig(marketAddress);
  console.log("Config verified:", {
    sourceType: Number(config[0]),
    feedAddress: config[1],
    threshold: Number(config[2]) / 1e8,
    thresholdAbove: config[3],
  });

  // ========================================================
  // STEP 4: Wait for deadline + resolve via Chainlink
  // ========================================================
  console.log("\n--- Step 4: Wait + Resolve via Chainlink ---");

  const currentBlock = await ethers.provider.getBlock("latest");
  const timeUntilDeadline = deadline - currentBlock!.timestamp;
  if (timeUntilDeadline > 0) {
    console.log(`Waiting ${timeUntilDeadline} seconds until deadline...`);
    await new Promise((resolve) => setTimeout(resolve, (timeUntilDeadline + 5) * 1000));
  }

  console.log("Calling resolveChainlink...");
  try {
    const resolveTx = await resolver.resolveChainlink(marketAddress);
    await resolveTx.wait();
    console.log("✓ Market resolved via Chainlink! TX:", resolveTx.hash);

    const market = await ethers.getContractAt("OpaqueMarket", marketAddress);
    const resolved = await market.resolved();
    const outcome = await market.outcome();
    console.log(`Resolved: ${resolved} | Outcome: ${outcome ? "YES" : "NO"}`);
    console.log(
      `(BTC price $${priceUsd.toLocaleString()} ${outcome ? ">=" : "<"} $${(Number(thresholdPrice) / 1e8).toLocaleString()})`,
    );
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("✗ resolveChainlink failed:", msg);
    if (msg.includes("Stale price data")) {
      console.log("  The Chainlink feed data is stale (>1 hour old).");
    }
  }

  // ========================================================
  // SUMMARY
  // ========================================================
  console.log("\n=== Chainlink E2E Test Summary ===");
  console.log("✓ Step 1: Read BTC/USD price — OK");
  console.log("✓ Step 2: Create market — OK");
  console.log("✓ Step 3: Configure Chainlink feed — OK");
  console.log("✓ Step 4: Resolve via Chainlink — Check above");
}

main().catch(console.error);
