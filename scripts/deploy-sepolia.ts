import { ethers } from "hardhat";
import * as fs from "fs";

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying contracts with:", deployer.address);

  const balance = await ethers.provider.getBalance(deployer.address);
  console.log("Balance:", ethers.formatEther(balance), "ETH\n");

  // 1. Deploy ConfidentialUSDT
  console.log("Deploying ConfidentialUSDT...");
  const ConfidentialUSDT = await ethers.getContractFactory("ConfidentialUSDT");
  const token = await ConfidentialUSDT.deploy();
  await token.waitForDeployment();
  const tokenAddress = await token.getAddress();
  console.log("ConfidentialUSDT:", tokenAddress);

  // 2. Deploy OracleResolver
  console.log("Deploying OracleResolver...");
  const OracleResolver = await ethers.getContractFactory("OracleResolver");
  const resolver = await OracleResolver.deploy();
  await resolver.waitForDeployment();
  const resolverAddress = await resolver.getAddress();
  console.log("OracleResolver:", resolverAddress);

  // 3. Deploy MarketFactory
  console.log("Deploying MarketFactory...");
  const MarketFactory = await ethers.getContractFactory("MarketFactory");
  const factory = await MarketFactory.deploy(
    resolverAddress,
    deployer.address,
    tokenAddress,
    10_000_000, // creationFee: 10 cUSDT
    3600, // minDuration: 1 hour
    300, // creationCooldown: 5 min
  );
  await factory.waitForDeployment();
  const factoryAddress = await factory.getAddress();
  console.log("MarketFactory:", factoryAddress);

  // 4. Mint test tokens to deployer
  console.log("\nMinting 1,000,000 mcUSDT to deployer...");
  const mintTx = await token.mint(deployer.address, 1_000_000_000_000); // 1M with 6 decimals
  await mintTx.wait();
  console.log("Minted!");

  // 5. Save deployment info
  const deployment = {
    network: "sepolia",
    chainId: 11155111,
    deployer: deployer.address,
    contracts: {
      ConfidentialUSDT: tokenAddress,
      OracleResolver: resolverAddress,
      MarketFactory: factoryAddress,
    },
    deployedAt: new Date().toISOString().split("T")[0],
  };

  fs.writeFileSync("deployments-sepolia.json", JSON.stringify(deployment, null, 2));
  console.log("\nDeployment saved to deployments-sepolia.json");

  const balanceAfter = await ethers.provider.getBalance(deployer.address);
  console.log("Balance after:", ethers.formatEther(balanceAfter), "ETH");
  console.log("Gas used:", ethers.formatEther(balance - balanceAfter), "ETH");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
