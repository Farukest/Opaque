import { ethers } from "hardhat";
import { loadDeployment } from "./lib/addresses";

// Chainlink BTC/USD Sepolia feed
const CHAINLINK_BTC_USD = "0x1b44F3514812d835EB1BDB0acB33d3fA3351Ee43";

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Creating hourly BTC market with account:", deployer.address);

  const deployment = loadDeployment();
  const factoryAddress = process.env.FACTORY_ADDRESS || deployment.contracts.MarketFactory;
  const resolverAddress = process.env.RESOLVER_ADDRESS || deployment.contracts.OracleResolver;

  const factory = await ethers.getContractAt("MarketFactory", factoryAddress);
  const resolver = await ethers.getContractAt("OracleResolver", resolverAddress);

  // Create market with 1-hour deadline
  const block = await ethers.provider.getBlock("latest");
  const now = block!.timestamp;
  const deadline = now + 3600; // 1 hour

  console.log("\n1. Creating 1-hour BTC market via factory...");
  const tx = await factory.createMarket(
    "BTC Up or Down in 1 Hour?",
    deadline,
    "Chainlink BTC/USD Price Feed (auto-threshold)",
    "onchain_oracle",
    ">= opening price at creation",
    "crypto",
  );
  const receipt = await tx.wait();

  // Extract market address from MarketCreated event
  const event = receipt!.logs.find((log: any) => {
    try {
      return factory.interface.parseLog({ topics: log.topics as string[], data: log.data })?.name === "MarketCreated";
    } catch {
      return false;
    }
  });

  let marketAddress: string;
  if (event) {
    const parsed = factory.interface.parseLog({ topics: event.topics as string[], data: event.data });
    marketAddress = parsed!.args.market;
  } else {
    // Fallback: get the last market from factory
    const count = await factory.getMarketCount();
    marketAddress = await factory.markets(count - 1n);
  }

  console.log(`   Market created: ${marketAddress}`);
  console.log(`   Deadline: ${new Date(deadline * 1000).toISOString()}`);

  // Configure Chainlink auto-threshold (records opening BTC price)
  console.log("\n2. Configuring Chainlink auto-threshold...");
  const configTx = await resolver.configureChainlinkAutoThreshold(
    marketAddress,
    CHAINLINK_BTC_USD,
    true, // thresholdAbove: YES if price >= opening price
    3600, // maxStaleness: 1 hour
  );
  await configTx.wait();

  // Read the recorded opening price
  const openingPrice = await resolver.getOpeningPrice(marketAddress);
  const openingUsd = Number(openingPrice) / 1e8; // Chainlink BTC/USD has 8 decimals
  console.log(`   Opening BTC price: $${openingUsd.toLocaleString()}`);
  console.log(`   Raw threshold: ${openingPrice}`);

  console.log("\n--- Summary ---");
  console.log(`Market: ${marketAddress}`);
  console.log(`Question: BTC Up or Down in 1 Hour?`);
  console.log(`Opening Price: $${openingUsd.toLocaleString()}`);
  console.log(`Deadline: ${new Date(deadline * 1000).toISOString()}`);
  console.log(`\nTo resolve after 1 hour, run:`);
  console.log(`  npx hardhat run scripts/resolve-hourly-btc.ts --network sepolia`);
  console.log(`  (set MARKET_ADDRESS=${marketAddress})`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
