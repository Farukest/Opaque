import { ethers } from "hardhat";
import { loadDeployment } from "./lib/addresses";

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Resolving market with account:", deployer.address);

  const deployment = loadDeployment();
  const marketAddress = process.env.MARKET_ADDRESS;
  const resolverAddress = process.env.RESOLVER_ADDRESS || deployment.contracts.OracleResolver;
  const outcomeStr = process.env.OUTCOME; // "true" or "false"

  if (!marketAddress) {
    console.error("Set MARKET_ADDRESS env variable");
    process.exit(1);
  }

  if (!outcomeStr) {
    console.error("Set OUTCOME env variable (true/false)");
    process.exit(1);
  }

  const outcome = outcomeStr.toLowerCase() === "true";

  const market = await ethers.getContractAt("OpaqueMarket", marketAddress);

  // Check market state
  const resolved = await market.resolved();
  if (resolved) {
    console.error("Market is already resolved");
    process.exit(1);
  }

  const deadline = await market.deadline();
  const block = await ethers.provider.getBlock("latest");
  if (block!.timestamp < deadline) {
    console.log(`Warning: Market deadline not reached yet (deadline: ${deadline}, now: ${block!.timestamp})`);
    console.log("Resolution will fail unless deadline has passed.");
  }

  if (resolverAddress) {
    // Use OracleResolver for direct resolution
    const resolver = await ethers.getContractAt("OracleResolver", resolverAddress);
    console.log(`Resolving via OracleResolver at ${resolverAddress}...`);
    const tx = await resolver.resolveDirectly(marketAddress, outcome);
    await tx.wait();
  } else {
    // Try direct resolution on market (requires msg.sender == resolver)
    console.log(`Resolving market directly...`);
    const tx = await market.resolve(outcome);
    await tx.wait();
  }

  console.log(`Market ${marketAddress} resolved: ${outcome ? "YES" : "NO"}`);

  // Show market state
  // getMarketInfo returns: (question, deadline, resolved, outcome, totalSharesMinted, activeOrderCount, resolutionSource, resolutionSourceType, resolutionCriteria)
  const info = await market.getMarketInfo();
  console.log(`\nMarket: "${info[0]}"`);
  console.log(`Outcome: ${info[3] ? "YES" : "NO"}`);
  console.log(`Total shares minted: ${info[4]}`);
  console.log(`Active orders: ${info[5]}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
