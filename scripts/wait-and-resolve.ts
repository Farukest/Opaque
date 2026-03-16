import { ethers } from "hardhat";

async function main() {
  const [deployer] = await ethers.getSigners();
  const resolverAddr = "0xcB57DdbDC99CACEB5518aE4E792503Ad657da432";
  const resolver = await ethers.getContractAt("OracleResolver", resolverAddr);

  // Markets to resolve (in deadline order)
  const markets = [
    "0xad748E5d20947eAb82208e9B1Cba63225531Bead", // Market 1 - earliest
    "0x6E42c6a5332695b9cBE2e2677E90f49c5BA23f31", // Market 2
    "0x61263f6220E0B5E7424fdE448a533a71372741f2", // Market 3 (E2E test)
  ];

  for (const addr of markets) {
    const market = await ethers.getContractAt("OpaqueMarket", addr);
    const resolved = await market.resolved();
    if (resolved) {
      console.log(`[SKIP] ${addr} — already resolved`);
      continue;
    }

    const deadline = Number(await market.deadline());
    const now = Math.floor(Date.now() / 1000);

    if (now < deadline) {
      const wait = deadline - now + 15; // 15s buffer
      console.log(`[WAIT] ${addr} — deadline in ${Math.floor(wait / 60)}m ${wait % 60}s, waiting...`);
      await new Promise((r) => setTimeout(r, wait * 1000));
    }

    console.log(`[RESOLVE] ${addr} — resolving YES...`);
    try {
      const tx = await resolver.resolveDirectly(addr, true);
      const receipt = await tx.wait();
      console.log(`[OK] ${addr} resolved YES`);
      console.log(`  TX: ${receipt!.hash}`);
      console.log(`  Gas: ${receipt!.gasUsed.toLocaleString()}`);
    } catch (e: any) {
      console.log(`[ERR] ${addr} — ${e.message?.slice(0, 120)}`);
    }
  }

  console.log("\nAll markets processed.");
}

main().catch(console.error);
