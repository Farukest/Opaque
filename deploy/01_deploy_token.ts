import type { DeployFunction } from "hardhat-deploy/types";
import type { HardhatRuntimeEnvironment } from "hardhat/types";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployer } = await hre.getNamedAccounts();
  const { deploy } = hre.deployments;

  console.log("Deploying ConfidentialUSDT...");

  const mockToken = await deploy("ConfidentialUSDT", {
    from: deployer,
    args: [],
    log: true,
  });

  console.log(`ConfidentialUSDT deployed at: ${mockToken.address}`);

  // Mint test tokens to deployer
  const ConfidentialUSDT = await hre.ethers.getContractAt("ConfidentialUSDT", mockToken.address);
  const mintTx = await ConfidentialUSDT.mint(deployer, 1000000_000000n); // 1M USDT (6 decimals)
  await mintTx.wait();
  console.log(`Minted 1,000,000 cUSDT to deployer: ${deployer}`);
};

func.tags = ["ConfidentialUSDT"];
export default func;
