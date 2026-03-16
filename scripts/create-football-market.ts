import { ethers } from "hardhat";
import { loadDeployment } from "./lib/addresses";

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Creating football match market with account:", deployer.address);

  const deployment = loadDeployment();
  const factoryAddress = process.env.FACTORY_ADDRESS || deployment.contracts.MarketFactory;

  const factory = await ethers.getContractAt("MarketFactory", factoryAddress);

  const block = await ethers.provider.getBlock("latest");
  const now = block!.timestamp;
  const deadline = now + 30 * 86400; // 30 days

  // 1. Deploy MarketGroup
  console.log("\n1. Deploying MarketGroup...");
  const MarketGroup = await ethers.getContractFactory("MarketGroup");
  const group = await MarketGroup.deploy(
    "Manchester United vs Manchester City - Premier League",
    "sports",
  );
  await group.waitForDeployment();
  const groupAddress = await group.getAddress();
  console.log(`   MarketGroup: ${groupAddress}`);

  // 2. Create sub-markets via factory with resolver = MarketGroup
  const outcomes = [
    {
      label: "Manchester United Win",
      question: "Manchester United wins vs Manchester City?",
      criteria: "Manchester United wins the Premier League match against Manchester City",
    },
    {
      label: "Draw",
      question: "Manchester United vs Manchester City ends in a draw?",
      criteria: "The Premier League match between Manchester United and Manchester City ends in a draw",
    },
    {
      label: "Manchester City Win",
      question: "Manchester City wins vs Manchester United?",
      criteria: "Manchester City wins the Premier League match against Manchester United",
    },
  ];

  const network = await ethers.provider.getNetwork();
  const isLocalNetwork = Number(network.chainId) === 31337;

  const marketAddresses: string[] = [];

  for (let i = 0; i < outcomes.length; i++) {
    const o = outcomes[i];
    console.log(`\n2.${i + 1}. Creating market: "${o.question}"...`);

    const tx = await factory.createMarketWithResolver(
      o.question,
      deadline,
      "Premier League Official / BBC Sport",
      "api_verifiable",
      o.criteria,
      "sports",
      groupAddress, // resolver = MarketGroup
    );
    const receipt = await tx.wait();

    // Extract market address from event
    const event = receipt!.logs.find((log: any) => {
      try {
        return factory.interface.parseLog({ topics: log.topics as string[], data: log.data })?.name === "MarketCreated";
      } catch {
        return false;
      }
    });

    let marketAddress: string;
    if (event) {
      const parsed = factory.interface.parseLog({ topics: event.topics as string[], data: event.data });
      marketAddress = parsed!.args.market;
    } else {
      const count = await factory.getMarketCount();
      marketAddress = await factory.markets(count - 1n);
    }

    marketAddresses.push(marketAddress);
    console.log(`   Market: ${marketAddress}`);

    // 3. Add outcome to MarketGroup
    const addTx = await group.addOutcome(o.label, marketAddress);
    await addTx.wait();
    console.log(`   Added to group as outcome #${i}`);

    // Wait for cooldown between market creations (except after the last one)
    if (i < outcomes.length - 1) {
      if (isLocalNetwork) {
        await ethers.provider.send("evm_increaseTime", [301]);
        await ethers.provider.send("evm_mine", []);
        console.log("   [hardhat] Advanced time by 301 seconds for cooldown");
      } else {
        console.log("   Waiting 310 seconds for creation cooldown (300s)...");
        for (let s = 310; s > 0; s -= 30) {
          await new Promise((r) => setTimeout(r, 30000));
          console.log(`   ${s - 30}s remaining...`);
        }
      }
    }
  }

  // Summary
  console.log("\n--- Football Match Market Summary ---");
  console.log(`Group: ${groupAddress}`);
  console.log(`Question: Manchester United vs Manchester City - Premier League`);
  console.log(`Deadline: ${new Date(deadline * 1000).toISOString()}`);
  console.log(`Outcomes:`);
  for (let i = 0; i < outcomes.length; i++) {
    console.log(`  [${i}] ${outcomes[i].label}: ${marketAddresses[i]}`);
  }
  console.log(`\nAdd to frontend/lib/wagmi.ts MARKET_GROUPS:`);
  console.log(`  { address: "${groupAddress}", question: "Manchester United vs Manchester City - Premier League" }`);
  console.log(`\nTo resolve: call group.resolveGroup(winnerIndex) from owner account`);
  console.log(`  0 = Man Utd Win, 1 = Draw, 2 = Man City Win`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
