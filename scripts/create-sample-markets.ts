import { ethers } from "hardhat";
import { loadDeployment } from "./lib/addresses";

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Creating markets with account:", deployer.address);

  // Get deployed factory address from env or fallback to deployment file
  const deployment = loadDeployment();
  const factoryAddress = process.env.FACTORY_ADDRESS || deployment.contracts.MarketFactory;

  const factory = await ethers.getContractAt("MarketFactory", factoryAddress);

  const block = await ethers.provider.getBlock("latest");
  const now = block!.timestamp;

  const markets = [
    {
      question: "BTC exceeds $200K by Dec 2026?",
      deadline: now + 30 * 86400,
      source: "Chainlink BTC/USD Price Feed",
      sourceType: "onchain_oracle",
      criteria: ">= 200000",
      category: "crypto",
    },
    {
      question: "ETH exceeds $10K by Q3 2026?",
      deadline: now + 60 * 86400,
      source: "Chainlink ETH/USD Price Feed",
      sourceType: "onchain_oracle",
      criteria: ">= 10000",
      category: "crypto",
    },
    {
      question: "Gold exceeds $3000/oz by March 2026?",
      deadline: now + 14 * 86400,
      source: "Chainlink XAU/USD Price Feed",
      sourceType: "onchain_oracle",
      criteria: ">= 3000",
      category: "crypto",
    },
    {
      question: "Will Ethereum implement full danksharding in 2026?",
      deadline: now + 90 * 86400,
      source: "ethereum.org/roadmap - Manual verification",
      sourceType: "manual_multisig",
      criteria: "Danksharding live on mainnet",
      category: "tech",
    },
    {
      question: "Total crypto market cap exceeds $5T by June 2026?",
      deadline: now + 120 * 86400,
      source: "CoinGecko API - Total Market Cap",
      sourceType: "api_verifiable",
      criteria: ">= 5000000000000",
      category: "crypto",
    },
  ];

  // CREATION_COOLDOWN = 300 seconds on-chain. Must wait between creations.
  // Detect network: on hardhat we advance time, on live networks we wait.
  const network = await ethers.provider.getNetwork();
  const isLocalNetwork = Number(network.chainId) === 31337;

  for (let i = 0; i < markets.length; i++) {
    const m = markets[i];
    const tx = await factory.createMarket(m.question, m.deadline, m.source, m.sourceType, m.criteria, m.category);
    const receipt = await tx.wait();
    console.log(`Created: "${m.question}" (tx: ${receipt!.hash})`);

    // Wait for cooldown between market creations (except after the last one)
    if (i < markets.length - 1) {
      if (isLocalNetwork) {
        // Advance time past the 300-second cooldown on hardhat network
        await ethers.provider.send("evm_increaseTime", [301]);
        await ethers.provider.send("evm_mine", []);
        console.log("  [hardhat] Advanced time by 301 seconds for cooldown");
      } else {
        // On live networks, wait 5 seconds between transactions.
        // Note: CREATION_COOLDOWN is 300 seconds. If creating many markets
        // in quick succession, later calls will revert. Space them out or
        // run this script multiple times with 5-minute gaps.
        console.log("  Waiting 5 seconds between creations (cooldown is 300s on-chain)...");
        await new Promise((r) => setTimeout(r, 5000));
      }
    }
  }

  const count = await factory.getMarketCount();
  console.log(`\nTotal markets: ${count}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
