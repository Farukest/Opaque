import { ethers } from "hardhat";
import * as dotenv from "dotenv";
import { loadDeployment } from "./lib/addresses";

dotenv.config();

const deployment = loadDeployment();

// Chainlink Sepolia Price Feed addresses
const CHAINLINK_FEEDS = {
  "BTC/USD": "0x1b44F3514812d835EB1BDB0acB33d3fA3351Ee43",
  "ETH/USD": "0x694AA1769357215DE4FAC081bf1f309aDC325306",
};

// Sample market configurations
// Maps market addresses to their Chainlink feed config
const MARKET_CONFIGS: {
  market: string;
  feed: string;
  threshold: bigint;
  thresholdAbove: boolean;
  label: string;
}[] = [
  // These should be updated with actual deployed market addresses
  // Example: BTC > $200K market
  // { market: "0x...", feed: CHAINLINK_FEEDS["BTC/USD"], threshold: 20000000000000n, thresholdAbove: true, label: "BTC > $200K" },
];

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Configuring Chainlink feeds with account:", deployer.address);

  const resolver = await ethers.getContractAt("OracleResolver", deployment.contracts.OracleResolver);

  // Verify ownership
  const owner = await resolver.owner();
  console.log("OracleResolver owner:", owner);
  if (owner.toLowerCase() !== deployer.address.toLowerCase()) {
    console.error("ERROR: Deployer is not the owner of OracleResolver");
    return;
  }

  console.log("\nAvailable Chainlink feeds on Sepolia:");
  for (const [pair, address] of Object.entries(CHAINLINK_FEEDS)) {
    console.log(`  ${pair}: ${address}`);
  }

  if (MARKET_CONFIGS.length === 0) {
    console.log("\nNo market configs defined. Add market addresses to MARKET_CONFIGS array.");
    console.log("Example usage:");
    console.log('  { market: "0xMARKET_ADDRESS",');
    console.log(`    feed: "${CHAINLINK_FEEDS["BTC/USD"]}",`);
    console.log("    threshold: 20000000000000n, // $200K with 8 decimals");
    console.log('    thresholdAbove: true, label: "BTC > $200K" }');
    return;
  }

  for (const config of MARKET_CONFIGS) {
    try {
      console.log(`\nConfiguring ${config.label}...`);
      console.log(`  Market: ${config.market}`);
      console.log(`  Feed: ${config.feed}`);
      console.log(`  Threshold: ${config.threshold}`);
      console.log(`  Above: ${config.thresholdAbove}`);

      const tx = await resolver.configureChainlink(
        config.market,
        config.feed,
        config.threshold,
        config.thresholdAbove,
        3600, // maxStaleness: 1 hour
      );
      console.log(`  TX: ${tx.hash}`);
      await tx.wait();
      console.log(`  Configured!`);

      // Verify
      const [sourceType, feedAddr, threshold, above, , isConfigured] = await resolver.getConfig(config.market);
      console.log(`  Verified: type=${sourceType}, feed=${feedAddr}, configured=${isConfigured}`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`  Failed: ${msg}`);
    }
  }

  console.log("\nChainlink configuration complete.");
}

main().catch(console.error);
