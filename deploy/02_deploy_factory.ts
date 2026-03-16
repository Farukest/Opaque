import type { DeployFunction } from "hardhat-deploy/types";
import type { HardhatRuntimeEnvironment } from "hardhat/types";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployer } = await hre.getNamedAccounts();
  const { deploy } = hre.deployments;

  const tokenDeployment = await hre.deployments.get("ConfidentialUSDT");

  console.log("Deploying OracleResolver...");
  const oracleResolver = await deploy("OracleResolver", {
    from: deployer,
    args: [],
    log: true,
  });
  console.log(`OracleResolver deployed at: ${oracleResolver.address}`);

  console.log("Deploying MarketFactory...");
  const factory = await deploy("MarketFactory", {
    from: deployer,
    args: [
      oracleResolver.address,
      deployer,
      tokenDeployment.address,
      10_000_000, // creationFee: 10 cUSDT
      3600, // minDuration: 1 hour
      300, // creationCooldown: 5 min
    ],
    log: true,
  });
  console.log(`MarketFactory deployed at: ${factory.address}`);
};

func.tags = ["Factory"];
func.dependencies = ["ConfidentialUSDT"];
export default func;
