import * as fs from "fs";
import * as path from "path";

interface Deployment {
  network: string;
  chainId: number;
  deployer: string;
  contracts: {
    ConfidentialUSDT: string;
    OracleResolver: string;
    MarketFactory: string;
  };
  deployedAt: string;
}

export function loadDeployment(): Deployment {
  const filePath = path.resolve(__dirname, "../../deployments-sepolia.json");
  if (!fs.existsSync(filePath)) {
    throw new Error("deployments-sepolia.json not found. Run deploy-sepolia.ts first.");
  }
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}
