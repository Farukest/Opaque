import { ethers } from "hardhat";
import * as fs from "fs";
import { loadDeployment } from "./lib/addresses";

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying MarketFactory with:", deployer.address);

  const balance = await ethers.provider.getBalance(deployer.address);
  console.log("Balance:", ethers.formatEther(balance), "ETH\n");

  const deployment = loadDeployment();
  const tokenAddress = deployment.contracts.ConfidentialUSDT;
  const resolverAddress = deployment.contracts.OracleResolver;

  // Deploy MarketFactory with ZamaEthereumConfig
  console.log("Deploying MarketFactory (with ZamaEthereumConfig)...");
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

  // Mint test tokens to deployer
  console.log("\nMinting 1,000,000 mcUSDT to deployer...");
  const token = await ethers.getContractAt("ConfidentialUSDT", tokenAddress);
  const mintTx = await token.mint(deployer.address, 1_000_000_000_000);
  await mintTx.wait();
  console.log("Minted 1M mcUSDT!");

  // Save deployment
  const newDeployment = {
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

  fs.writeFileSync("deployments-sepolia.json", JSON.stringify(newDeployment, null, 2));
  console.log("\nSaved to deployments-sepolia.json");

  const balanceAfter = await ethers.provider.getBalance(deployer.address);
  console.log("Balance after:", ethers.formatEther(balanceAfter), "ETH");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
