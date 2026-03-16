import { ethers } from "hardhat";
import { loadDeployment } from "./lib/addresses";

const CHAINLINK_BTC_USD = "0x1b44F3514812d835EB1BDB0acB33d3fA3351Ee43";

async function main() {
  const [deployer] = await ethers.getSigners();
  const deployment = loadDeployment();
  const factory = await ethers.getContractAt("MarketFactory", deployment.contracts.MarketFactory);
  const resolver = await ethers.getContractAt("OracleResolver", deployment.contracts.OracleResolver);

  // Fresh block timestamp for deadline
  const block = await ethers.provider.getBlock("latest");
  const now = block!.timestamp;
  const deadline = now + 7200; // 2 hours (> MIN_DURATION of 3600)

  // Check cooldown
  const lastCreation = await factory.lastCreationTime(deployer.address);
  const cooldownEnd = Number(lastCreation) + 300;
  if (now < cooldownEnd) {
    const wait = cooldownEnd - now + 5;
    console.log(`Cooldown active. Waiting ${wait}s...`);
    await new Promise((r) => setTimeout(r, wait * 1000));
  }

  console.log("Creating BTC 1-Hour market...");
  const tx = await factory.createMarket(
    "BTC Up or Down in 1 Hour?",
    deadline,
    "Chainlink BTC/USD Price Feed (auto-threshold)",
    "onchain_oracle",
    ">= opening price at creation",
    "crypto",
    { gasLimit: 15_000_000 }, // bypass fhevm plugin gas estimation
  );
  const receipt = await tx.wait();
  console.log(`TX: ${receipt!.hash}`);

  const count = await factory.getMarketCount();
  const marketAddress = await factory.markets(count - 1n);
  console.log(`Market: ${marketAddress}`);

  // Configure Chainlink auto-threshold
  console.log("Configuring Chainlink auto-threshold...");
  const configTx = await resolver.configureChainlinkAutoThreshold(marketAddress, CHAINLINK_BTC_USD, true, 3600);
  await configTx.wait();

  const openingPrice = await resolver.getOpeningPrice(marketAddress);
  console.log(`Opening BTC: $${(Number(openingPrice) / 1e8).toLocaleString()}`);
  console.log("Done!");
}

main().catch(console.error);
