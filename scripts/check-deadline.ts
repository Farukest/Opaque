import { ethers } from "hardhat";

async function main() {
  const market = await ethers.getContractAt("OpaqueMarket", "0xad748E5d20947eAb82208e9B1Cba63225531Bead");
  const deadline = await market.deadline();
  const resolved = await market.resolved();
  const now = Math.floor(Date.now() / 1000);

  console.log("Deadline:", Number(deadline), new Date(Number(deadline) * 1000).toISOString());
  console.log("Now:     ", now, new Date(now * 1000).toISOString());
  console.log("Resolved:", resolved);

  if (now > Number(deadline)) {
    console.log("STATUS: Deadline PASSED — ready to resolve");
  } else {
    const remaining = Number(deadline) - now;
    console.log(`STATUS: ${Math.floor(remaining / 60)} min ${remaining % 60}s remaining`);
  }
}

main().catch(console.error);
