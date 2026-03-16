import { ethers, fhevm } from "hardhat";
import { loadDeployment } from "./lib/addresses";

/**
 * Hourly BTC market cycle script.
 * 1. Finds the latest hourly BTC market from the factory
 * 2. Resolves it via Chainlink (if within grace period)
 * 3. Creates a new 1-hour BTC market with fresh opening price
 *
 * Run manually or via cron every hour:
 *   npx hardhat run scripts/cycle-hourly-btc.ts --network sepolia
 */

const CHAINLINK_BTC_USD = "0x1b44F3514812d835EB1BDB0acB33d3fA3351Ee43";

async function main() {
  await fhevm.initializeCLIApi();
  const [deployer] = await ethers.getSigners();
  console.log("Cycling hourly BTC market with account:", deployer.address);

  const deployment = loadDeployment();
  const factoryAddress = process.env.FACTORY_ADDRESS || deployment.contracts.MarketFactory;
  const resolverAddress = process.env.RESOLVER_ADDRESS || deployment.contracts.OracleResolver;

  const factory = await ethers.getContractAt("MarketFactory", factoryAddress);
  const resolver = await ethers.getContractAt("OracleResolver", resolverAddress);

  // ────────────────────────────────────────────────────
  // Step 1: Find latest hourly BTC market
  // ────────────────────────────────────────────────────
  const marketCount = await factory.getMarketCount();
  console.log(`\nTotal markets in factory: ${marketCount}`);

  let latestBtcMarket: string | null = null;
  let latestBtcDeadline = 0;

  for (let i = Number(marketCount) - 1; i >= 0; i--) {
    const addr = await factory.markets(i);
    const market = await ethers.getContractAt("OpaqueMarket", addr);
    const question = await market.question();
    const q = question.toLowerCase();
    if (q.includes("btc") && (q.includes("1 hour") || q.includes("hourly"))) {
      const deadline = Number(await market.deadline());
      if (deadline > latestBtcDeadline) {
        latestBtcMarket = addr;
        latestBtcDeadline = deadline;
      }
      break; // Factory orders by creation, so last match = latest
    }
  }

  // ────────────────────────────────────────────────────
  // Step 2: Resolve the old market (if possible)
  // ────────────────────────────────────────────────────
  if (latestBtcMarket) {
    const market = await ethers.getContractAt("OpaqueMarket", latestBtcMarket);
    const isResolved = await market.resolved();
    const block = await ethers.provider.getBlock("latest");
    const now = block!.timestamp;
    const gracePeriod = Number(await market.GRACE_PERIOD());

    if (isResolved) {
      const outcome = await market.outcome();
      console.log(`\nPrevious market ${latestBtcMarket} already resolved: ${outcome ? "UP" : "DOWN"}`);
    } else if (now < latestBtcDeadline) {
      const remaining = latestBtcDeadline - now;
      console.log(`\nPrevious market still active. ${remaining}s remaining. Skipping resolution.`);
    } else if (now > latestBtcDeadline + gracePeriod) {
      console.log(`\nPrevious market ${latestBtcMarket} — grace period expired. Cannot resolve.`);
    } else {
      // Within resolution window — resolve it
      console.log(`\nResolving previous market ${latestBtcMarket}...`);
      try {
        const openingPrice = await resolver.getOpeningPrice(latestBtcMarket);
        const openingUsd = Number(openingPrice) / 1e8;
        console.log(`  Opening price: $${openingUsd.toLocaleString()}`);

        const tx = await resolver.resolveChainlink(latestBtcMarket);
        await tx.wait();

        const outcome = await market.outcome();
        console.log(`  Resolved: ${outcome ? "YES — BTC went UP" : "NO — BTC went DOWN"}`);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes("StalePriceData")) {
          console.log("  Chainlink price data is stale — skipping resolution.");
        } else {
          console.log(`  Resolution failed: ${msg.slice(0, 100)}`);
        }
      }
    }
  } else {
    console.log("\nNo previous hourly BTC market found.");
  }

  // ────────────────────────────────────────────────────
  // Step 3: Check cooldown before creating
  // ────────────────────────────────────────────────────
  const cooldown = Number(await factory.CREATION_COOLDOWN());
  const lastCreation = Number(await factory.lastCreationTime(deployer.address));
  const block = await ethers.provider.getBlock("latest");
  const now = block!.timestamp;

  if (lastCreation > 0 && now - lastCreation < cooldown) {
    const wait = cooldown - (now - lastCreation);
    console.log(`\nCooldown active. Wait ${wait}s before creating a new market.`);
    console.log("Exiting without creating new market.");
    return;
  }

  // ────────────────────────────────────────────────────
  // Step 4: Create new 1-hour BTC market
  // ────────────────────────────────────────────────────
  // deadline must be > block.timestamp + MIN_DURATION (3600)
  // Add 120s buffer so tx doesn't revert due to block timestamp advancing
  const deadline = now + 3600 + 120;
  console.log("\nCreating new 1-hour BTC market...");

  const createTx = await factory.createMarket(
    "BTC Up or Down in 1 Hour?",
    deadline,
    "Chainlink BTC/USD Price Feed (auto-threshold)",
    "onchain_oracle",
    ">= opening price at creation",
    "crypto",
  );
  const receipt = await createTx.wait();

  // Extract market address from event
  let newMarketAddress: string;
  const event = receipt!.logs.find((log: any) => {
    try {
      return factory.interface.parseLog({ topics: log.topics as string[], data: log.data })?.name === "MarketCreated";
    } catch {
      return false;
    }
  });

  if (event) {
    const parsed = factory.interface.parseLog({ topics: event.topics as string[], data: event.data });
    newMarketAddress = parsed!.args.market;
  } else {
    const count = await factory.getMarketCount();
    newMarketAddress = await factory.markets(count - 1n);
  }

  console.log(`  Market created: ${newMarketAddress}`);

  // Configure Chainlink auto-threshold
  console.log("  Configuring Chainlink auto-threshold...");
  const configTx = await resolver.configureChainlinkAutoThreshold(
    newMarketAddress,
    CHAINLINK_BTC_USD,
    true,
    3600,
  );
  await configTx.wait();

  const openingPrice = await resolver.getOpeningPrice(newMarketAddress);
  const openingUsd = Number(openingPrice) / 1e8;

  console.log("\n--- New Market ---");
  console.log(`Address:  ${newMarketAddress}`);
  console.log(`Opening:  $${openingUsd.toLocaleString()}`);
  console.log(`Deadline: ${new Date(deadline * 1000).toISOString()}`);
  console.log(`\nNext cycle: run this script again after ${new Date(deadline * 1000).toISOString()}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
