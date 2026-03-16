import { ethers } from "hardhat";
import { loadDeployment } from "./lib/addresses";

/**
 * Full Sepolia deployment script:
 * 1. Create 4 remaining sample markets (1st was already created)
 * 2. Create hourly BTC market
 * 3. Create multi-outcome election market
 *
 * Handles 300-second creation cooldown between markets.
 */

const CHAINLINK_BTC_USD = "0x1b44F3514812d835EB1BDB0acB33d3fA3351Ee43";
const COOLDOWN = 310; // seconds to wait (300s cooldown + buffer)

async function waitCooldown(seconds: number) {
  console.log(`  Waiting ${seconds}s for cooldown...`);
  for (let i = seconds; i > 0; i -= 30) {
    await new Promise((r) => setTimeout(r, Math.min(30, i) * 1000));
    if (i > 30) console.log(`  ${i - 30}s remaining...`);
  }
}

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Account:", deployer.address);

  const deployment = loadDeployment();
  const factory = await ethers.getContractAt("MarketFactory", deployment.contracts.MarketFactory);
  const resolver = await ethers.getContractAt("OracleResolver", deployment.contracts.OracleResolver);

  const block = await ethers.provider.getBlock("latest");
  const now = block!.timestamp;

  // Check how many markets already exist
  const existingCount = await factory.getMarketCount();
  console.log(`Existing markets: ${existingCount}\n`);

  // ═══════════════════════════════════════
  // SAMPLE MARKETS (remaining 4)
  // ═══════════════════════════════════════

  const sampleMarkets = [
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

  // Wait for cooldown from first market creation
  console.log("=== SAMPLE MARKETS ===");
  await waitCooldown(COOLDOWN);

  for (let i = 0; i < sampleMarkets.length; i++) {
    const m = sampleMarkets[i];
    console.log(`\nCreating [${i + 2}/5]: "${m.question}"`);
    try {
      const tx = await factory.createMarket(m.question, m.deadline, m.source, m.sourceType, m.criteria, m.category);
      const receipt = await tx.wait();
      console.log(`  TX: ${receipt!.hash}`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`  FAILED: ${msg.slice(0, 200)}`);
    }

    if (i < sampleMarkets.length - 1) {
      await waitCooldown(COOLDOWN);
    }
  }

  // ═══════════════════════════════════════
  // HOURLY BTC MARKET
  // ═══════════════════════════════════════

  console.log("\n\n=== HOURLY BTC MARKET ===");
  await waitCooldown(COOLDOWN);

  const btcDeadline = now + 3600;
  console.log("Creating BTC 1-Hour market...");
  let btcMarketAddress = "";
  try {
    const tx = await factory.createMarket(
      "BTC Up or Down in 1 Hour?",
      btcDeadline,
      "Chainlink BTC/USD Price Feed (auto-threshold)",
      "onchain_oracle",
      ">= opening price at creation",
      "crypto",
    );
    const receipt = await tx.wait();
    console.log(`  TX: ${receipt!.hash}`);

    // Get market address
    const count = await factory.getMarketCount();
    btcMarketAddress = await factory.markets(count - 1n);
    console.log(`  Market: ${btcMarketAddress}`);

    // Configure Chainlink auto-threshold
    console.log("  Configuring Chainlink auto-threshold...");
    const configTx = await resolver.configureChainlinkAutoThreshold(btcMarketAddress, CHAINLINK_BTC_USD, true, 3600);
    await configTx.wait();

    const openingPrice = await resolver.getOpeningPrice(btcMarketAddress);
    console.log(`  Opening BTC: $${(Number(openingPrice) / 1e8).toLocaleString()}`);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`  FAILED: ${msg.slice(0, 200)}`);
  }

  // ═══════════════════════════════════════
  // MULTI-OUTCOME ELECTION MARKET
  // ═══════════════════════════════════════

  console.log("\n\n=== MULTI-OUTCOME MARKET ===");

  // Deploy MarketGroup contract
  console.log("Deploying MarketGroup...");
  const MarketGroup = await ethers.getContractFactory("MarketGroup");
  const group = await MarketGroup.deploy("Who wins 2028 US Presidential Election?", "politics");
  await group.waitForDeployment();
  const groupAddress = await group.getAddress();
  console.log(`  MarketGroup: ${groupAddress}`);

  const electionDeadline = now + 180 * 86400;
  const outcomes = [
    { label: "Republican", question: "Republican wins 2028 US Election?" },
    { label: "Democrat", question: "Democrat wins 2028 US Election?" },
    { label: "Independent/Other", question: "Independent/Other wins 2028 US Election?" },
  ];

  const electionMarketAddresses: string[] = [];

  await waitCooldown(COOLDOWN);

  for (let i = 0; i < outcomes.length; i++) {
    const o = outcomes[i];
    console.log(`\nCreating outcome [${i}]: "${o.question}"`);
    try {
      const tx = await factory.createMarketWithResolver(
        o.question,
        electionDeadline,
        "AP News / Official Election Results",
        "manual_multisig",
        `${o.label} candidate wins the 2028 US Presidential Election`,
        "politics",
        groupAddress,
      );
      const receipt = await tx.wait();
      console.log(`  TX: ${receipt!.hash}`);

      const count = await factory.getMarketCount();
      const addr = await factory.markets(count - 1n);
      electionMarketAddresses.push(addr);
      console.log(`  Market: ${addr}`);

      // Add to group
      const addTx = await group.addOutcome(o.label, addr);
      await addTx.wait();
      console.log(`  Added to group`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`  FAILED: ${msg.slice(0, 200)}`);
    }

    if (i < outcomes.length - 1) {
      await waitCooldown(COOLDOWN);
    }
  }

  // ═══════════════════════════════════════
  // SUMMARY
  // ═══════════════════════════════════════

  const totalMarkets = await factory.getMarketCount();
  const balanceAfter = await ethers.provider.getBalance(deployer.address);

  console.log("\n\n========== DEPLOYMENT SUMMARY ==========");
  console.log(`ConfidentialUSDT: ${deployment.contracts.ConfidentialUSDT}`);
  console.log(`OracleResolver:   ${deployment.contracts.OracleResolver}`);
  console.log(`MarketFactory:    ${deployment.contracts.MarketFactory}`);
  console.log(`MarketGroup:      ${groupAddress}`);
  console.log(`Total markets:    ${totalMarkets}`);
  console.log(`BTC 1-Hour:       ${btcMarketAddress}`);
  console.log(`Election outcomes:`);
  for (let i = 0; i < electionMarketAddresses.length; i++) {
    console.log(`  [${i}] ${outcomes[i].label}: ${electionMarketAddresses[i]}`);
  }
  console.log(`\nBalance: ${ethers.formatEther(balanceAfter)} ETH`);
  console.log("=========================================");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
