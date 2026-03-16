import { ethers } from "hardhat";
import { loadDeployment } from "./lib/addresses";

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Resolving hourly BTC market with account:", deployer.address);

  const deployment = loadDeployment();
  const resolverAddress = process.env.RESOLVER_ADDRESS || deployment.contracts.OracleResolver;

  const marketAddress = process.env.MARKET_ADDRESS;
  if (!marketAddress) {
    console.error("ERROR: Set MARKET_ADDRESS environment variable");
    console.error("Usage: MARKET_ADDRESS=0x... npx hardhat run scripts/resolve-hourly-btc.ts --network sepolia");
    process.exit(1);
  }

  const resolver = await ethers.getContractAt("OracleResolver", resolverAddress);
  const market = await ethers.getContractAt("OpaqueMarket", marketAddress);

  // Check if already resolved
  const isResolved = await market.resolved();
  if (isResolved) {
    const outcome = await market.outcome();
    console.log(`Market already resolved: ${outcome ? "YES (UP)" : "NO (DOWN)"}`);
    return;
  }

  // Check deadline
  const deadline = await market.deadline();
  const block = await ethers.provider.getBlock("latest");
  const now = block!.timestamp;
  if (now < Number(deadline)) {
    const remaining = Number(deadline) - now;
    console.log(`Market deadline not yet passed. ${remaining} seconds remaining.`);
    console.log(`Deadline: ${new Date(Number(deadline) * 1000).toISOString()}`);
    return;
  }

  // Get opening price for comparison
  const openingPrice = await resolver.getOpeningPrice(marketAddress);
  const openingUsd = Number(openingPrice) / 1e8;
  console.log(`Opening BTC price: $${openingUsd.toLocaleString()}`);

  // Resolve via Chainlink
  console.log("\nResolving via Chainlink...");
  try {
    const tx = await resolver.resolveChainlink(marketAddress);
    const receipt = await tx.wait();
    console.log(`TX: ${receipt!.hash}`);

    const outcome = await market.outcome();
    console.log(`\nResult: ${outcome ? "YES — BTC went UP" : "NO — BTC went DOWN"}`);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("StalePriceData")) {
      console.error("Chainlink price data is stale. The feed may not have updated recently.");
    } else {
      console.error(`Resolution failed: ${msg}`);
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
