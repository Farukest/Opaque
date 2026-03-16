import type { DeployFunction } from "hardhat-deploy/types";
import type { HardhatRuntimeEnvironment } from "hardhat/types";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployer } = await hre.getNamedAccounts();

  const factoryDeployment = await hre.deployments.get("MarketFactory");
  const factory = await hre.ethers.getContractAt("MarketFactory", factoryDeployment.address);

  const block = await hre.ethers.provider.getBlock("latest");
  const now = block!.timestamp;

  console.log("Creating sample markets...");

  // CREATION_COOLDOWN = 300 seconds on-chain. Advance time between creations.
  // This deploy script targets hardhat network, so we use evm_increaseTime.

  // Market 1: BTC Price Prediction
  const tx1 = await factory.createMarket(
    "BTC exceeds $200K by Dec 2026?",
    now + 30 * 86400, // 30 days
    "Chainlink BTC/USD Price Feed",
    "onchain_oracle",
    ">= 200000",
    "crypto",
  );
  await tx1.wait();
  console.log("Created: BTC > $200K");

  // Advance time past cooldown
  await hre.ethers.provider.send("evm_increaseTime", [301]);
  await hre.ethers.provider.send("evm_mine", []);

  // Market 2: ETH Price Prediction
  const tx2 = await factory.createMarket(
    "ETH exceeds $10K by Q3 2026?",
    now + 60 * 86400, // 60 days
    "Chainlink ETH/USD Price Feed",
    "onchain_oracle",
    ">= 10000",
    "crypto",
  );
  await tx2.wait();
  console.log("Created: ETH > $10K");

  // Advance time past cooldown
  await hre.ethers.provider.send("evm_increaseTime", [301]);
  await hre.ethers.provider.send("evm_mine", []);

  // Market 3: Gold Price
  const tx3 = await factory.createMarket(
    "Gold exceeds $3000/oz by March 2026?",
    now + 14 * 86400, // 14 days
    "Chainlink XAU/USD Price Feed",
    "onchain_oracle",
    ">= 3000",
    "crypto",
  );
  await tx3.wait();
  console.log("Created: Gold > $3000");

  // Advance time past cooldown
  await hre.ethers.provider.send("evm_increaseTime", [301]);
  await hre.ethers.provider.send("evm_mine", []);

  // Market 4: Manual resolution market
  const tx4 = await factory.createMarket(
    "Will Ethereum implement full danksharding in 2026?",
    now + 90 * 86400, // 90 days
    "ethereum.org/roadmap - Manual verification",
    "manual_multisig",
    "Danksharding live on mainnet",
    "tech",
  );
  await tx4.wait();
  console.log("Created: Ethereum danksharding");

  // Advance time past cooldown
  await hre.ethers.provider.send("evm_increaseTime", [301]);
  await hre.ethers.provider.send("evm_mine", []);

  // Market 5: Crypto market cap
  const tx5 = await factory.createMarket(
    "Total crypto market cap exceeds $5T by June 2026?",
    now + 120 * 86400, // 120 days
    "CoinGecko API - Total Market Cap",
    "api_verifiable",
    ">= 5000000000000",
    "crypto",
  );
  await tx5.wait();
  console.log("Created: Crypto market cap > $5T");

  const count = await factory.getMarketCount();
  console.log(`\nTotal markets created: ${count}`);
};

func.tags = ["SampleMarkets"];
func.dependencies = ["Factory"];
export default func;
