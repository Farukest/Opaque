import { run } from "hardhat";
import { loadDeployment } from "./lib/addresses";

async function main() {
  const deployment = loadDeployment();
  const DEPLOYED = deployment.contracts;
  const DEPLOYER = deployment.deployer;

  console.log("Verifying contracts on Sepolia Etherscan...\n");
  console.log("Using addresses from deployments-sepolia.json:");
  console.log("  ConfidentialUSDT:", DEPLOYED.ConfidentialUSDT);
  console.log("  OracleResolver:", DEPLOYED.OracleResolver);
  console.log("  MarketFactory:", DEPLOYED.MarketFactory);
  console.log();

  // 1. Verify ConfidentialUSDT (no constructor args)
  try {
    console.log("Verifying ConfidentialUSDT...");
    await run("verify:verify", {
      address: DEPLOYED.ConfidentialUSDT,
      constructorArguments: [],
    });
    console.log("ConfidentialUSDT verified!\n");
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("Already Verified")) {
      console.log("ConfidentialUSDT already verified.\n");
    } else {
      console.error("ConfidentialUSDT verification failed:", msg, "\n");
    }
  }

  // 2. Verify OracleResolver (no constructor args)
  try {
    console.log("Verifying OracleResolver...");
    await run("verify:verify", {
      address: DEPLOYED.OracleResolver,
      constructorArguments: [],
    });
    console.log("OracleResolver verified!\n");
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("Already Verified")) {
      console.log("OracleResolver already verified.\n");
    } else {
      console.error("OracleResolver verification failed:", msg, "\n");
    }
  }

  // 3. Verify MarketFactory (6 constructor args)
  try {
    console.log("Verifying MarketFactory...");
    await run("verify:verify", {
      address: DEPLOYED.MarketFactory,
      constructorArguments: [
        DEPLOYED.OracleResolver,
        DEPLOYER,
        DEPLOYED.ConfidentialUSDT,
        10_000_000, // creationFee: 10 cUSDT
        3600, // minDuration: 1 hour
        300, // creationCooldown: 5 min
      ],
    });
    console.log("MarketFactory verified!\n");
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("Already Verified")) {
      console.log("MarketFactory already verified.\n");
    } else {
      console.error("MarketFactory verification failed:", msg, "\n");
    }
  }

  console.log("Verification complete.");
}

main().catch(console.error);
