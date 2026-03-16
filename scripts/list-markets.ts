import { ethers } from "hardhat";

async function main() {
  const factory = await ethers.getContractAt("MarketFactory", "0x45F72C9c523DE5bB66F8B73317a5046Ca22fC2CD");
  const markets = await factory.getAllMarkets();
  const now = Math.floor(Date.now() / 1000);
  console.log("Total markets:", markets.length);
  for (let i = 0; i < markets.length; i++) {
    const m = await ethers.getContractAt("OpaqueMarket", markets[i]);
    const d = await m.deadline();
    const r = await m.resolved();
    const rem = Number(d) - now;
    console.log(
      `Market ${i}: ${markets[i]} | deadline: ${new Date(Number(d) * 1000).toISOString()} | resolved: ${r} | ${rem > 0 ? Math.floor(rem / 60) + "m left" : "PASSED (" + Math.abs(Math.floor(rem / 60)) + "m ago)"}`,
    );
  }
}

main().catch(console.error);
