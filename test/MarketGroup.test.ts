import { expect } from "chai";
import { ethers } from "hardhat";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";

describe("MarketGroup", function () {
  let group: any;
  let market1: any;
  let market2: any;
  let market3: any;
  let deployer: HardhatEthersSigner;
  let alice: HardhatEthersSigner;
  let groupAddress: string;
  let market1Address: string;
  let market2Address: string;
  let market3Address: string;

  beforeEach(async function () {
    const signers = await ethers.getSigners();
    deployer = signers[0];
    alice = signers[1];

    // Deploy MarketGroup
    const MarketGroup = await ethers.getContractFactory("MarketGroup");
    group = await MarketGroup.deploy("Who wins 2028 US Election?", "politics");
    await group.waitForDeployment();
    groupAddress = await group.getAddress();

    // Deploy ConfidentialUSDT for market constructor
    const ConfidentialUSDT = await ethers.getContractFactory("ConfidentialUSDT");
    const token = await ConfidentialUSDT.deploy();
    await token.waitForDeployment();
    const tokenAddress = await token.getAddress();

    // Deploy 3 OpaqueMarkets with MarketGroup as resolver
    const block = await ethers.provider.getBlock("latest");
    const deadline = block!.timestamp + 86400;

    const OpaqueMarket = await ethers.getContractFactory("OpaqueMarket");

    market1 = await OpaqueMarket.deploy(
      "Republican wins 2028?",
      deadline,
      "AP News / Official Results",
      "manual_multisig",
      "Republican candidate wins",
      "politics",
      groupAddress,
      deployer.address,
      tokenAddress,
      deployer.address,
    );
    await market1.waitForDeployment();
    market1Address = await market1.getAddress();

    market2 = await OpaqueMarket.deploy(
      "Democrat wins 2028?",
      deadline,
      "AP News / Official Results",
      "manual_multisig",
      "Democrat candidate wins",
      "politics",
      groupAddress,
      deployer.address,
      tokenAddress,
      deployer.address,
    );
    await market2.waitForDeployment();
    market2Address = await market2.getAddress();

    market3 = await OpaqueMarket.deploy(
      "Independent/Other wins 2028?",
      deadline,
      "AP News / Official Results",
      "manual_multisig",
      "Independent or other candidate wins",
      "politics",
      groupAddress,
      deployer.address,
      tokenAddress,
      deployer.address,
    );
    await market3.waitForDeployment();
    market3Address = await market3.getAddress();

    // Add outcomes to group
    await group.addOutcome("Republican", market1Address);
    await group.addOutcome("Democrat", market2Address);
    await group.addOutcome("Independent/Other", market3Address);
  });

  // ═══════════════════════════════════════
  // DEPLOYMENT
  // ═══════════════════════════════════════

  describe("Deployment", function () {
    it("should set question correctly", async function () {
      expect(await group.question()).to.equal("Who wins 2028 US Election?");
    });

    it("should set category correctly", async function () {
      expect(await group.category()).to.equal("politics");
    });

    it("should set owner correctly", async function () {
      expect(await group.owner()).to.equal(deployer.address);
    });

    it("should not be resolved initially", async function () {
      expect(await group.resolved()).to.equal(false);
    });
  });

  // ═══════════════════════════════════════
  // ADD OUTCOME
  // ═══════════════════════════════════════

  describe("addOutcome", function () {
    it("should track correct outcome count", async function () {
      expect(await group.outcomeCount()).to.equal(3n);
    });

    it("should store outcome labels and markets", async function () {
      const [label0, addr0] = await group.getOutcome(0);
      expect(label0).to.equal("Republican");
      expect(addr0).to.equal(market1Address);

      const [label1, addr1] = await group.getOutcome(1);
      expect(label1).to.equal("Democrat");
      expect(addr1).to.equal(market2Address);

      const [label2, addr2] = await group.getOutcome(2);
      expect(label2).to.equal("Independent/Other");
      expect(addr2).to.equal(market3Address);
    });

    it("should reject addOutcome from non-owner", async function () {
      try {
        await group.connect(alice).addOutcome("Libertarian", market1Address);
        expect.fail("Should have reverted");
      } catch (err: any) {
        expect(err).to.exist;
      }
    });

    it("should reject addOutcome with zero address", async function () {
      await expect(group.addOutcome("Bad", ethers.ZeroAddress)).to.be.revertedWithCustomError(group, "ZeroAddress");
    });

    it("should emit OutcomeAdded event", async function () {
      const newMarketAddress = ethers.Wallet.createRandom().address;
      await expect(group.addOutcome("Libertarian", newMarketAddress))
        .to.emit(group, "OutcomeAdded")
        .withArgs(3n, "Libertarian", newMarketAddress);
    });
  });

  // ═══════════════════════════════════════
  // GET GROUP INFO
  // ═══════════════════════════════════════

  describe("getGroupInfo", function () {
    it("should return correct group info before resolution", async function () {
      const [q, count, isResolved, winner, cat] = await group.getGroupInfo();
      expect(q).to.equal("Who wins 2028 US Election?");
      expect(count).to.equal(3n);
      expect(isResolved).to.equal(false);
      expect(winner).to.equal(0n);
      expect(cat).to.equal("politics");
    });
  });

  // ═══════════════════════════════════════
  // GET OUTCOME
  // ═══════════════════════════════════════

  describe("getOutcome", function () {
    it("should revert for invalid index", async function () {
      await expect(group.getOutcome(99)).to.be.revertedWithCustomError(group, "InvalidIndex");
    });
  });

  // ═══════════════════════════════════════
  // RESOLVE GROUP
  // ═══════════════════════════════════════

  describe("resolveGroup", function () {
    it("should resolve winner=true, losers=false (winner index 0)", async function () {
      // Advance past market deadline
      await ethers.provider.send("evm_increaseTime", [86401]);
      await ethers.provider.send("evm_mine", []);

      await group.resolveGroup(0);

      expect(await group.resolved()).to.equal(true);
      expect(await group.winningIndex()).to.equal(0n);

      // Winner market resolved YES
      expect(await market1.resolved()).to.equal(true);
      expect(await market1.outcome()).to.equal(true);

      // Loser markets resolved NO
      expect(await market2.resolved()).to.equal(true);
      expect(await market2.outcome()).to.equal(false);

      expect(await market3.resolved()).to.equal(true);
      expect(await market3.outcome()).to.equal(false);
    });

    it("should resolve winner=true, losers=false (winner index 1)", async function () {
      await ethers.provider.send("evm_increaseTime", [86401]);
      await ethers.provider.send("evm_mine", []);

      await group.resolveGroup(1);

      expect(await group.winningIndex()).to.equal(1n);

      expect(await market1.outcome()).to.equal(false);
      expect(await market2.outcome()).to.equal(true);
      expect(await market3.outcome()).to.equal(false);
    });

    it("should emit GroupResolved event", async function () {
      await ethers.provider.send("evm_increaseTime", [86401]);
      await ethers.provider.send("evm_mine", []);

      await expect(group.resolveGroup(0)).to.emit(group, "GroupResolved").withArgs(0n, "Republican");
    });

    it("should return updated group info after resolution", async function () {
      await ethers.provider.send("evm_increaseTime", [86401]);
      await ethers.provider.send("evm_mine", []);

      await group.resolveGroup(2);
      const [, , isResolved, winner] = await group.getGroupInfo();
      expect(isResolved).to.equal(true);
      expect(winner).to.equal(2n);
    });

    it("should reject resolveGroup from non-owner", async function () {
      await ethers.provider.send("evm_increaseTime", [86401]);
      await ethers.provider.send("evm_mine", []);

      try {
        await group.connect(alice).resolveGroup(0);
        expect.fail("Should have reverted");
      } catch (err: any) {
        expect(err).to.exist;
      }
    });

    it("should reject double resolution", async function () {
      await ethers.provider.send("evm_increaseTime", [86401]);
      await ethers.provider.send("evm_mine", []);

      await group.resolveGroup(0);

      await expect(group.resolveGroup(1)).to.be.revertedWithCustomError(group, "AlreadyResolved");
    });

    it("should reject invalid winner index", async function () {
      await ethers.provider.send("evm_increaseTime", [86401]);
      await ethers.provider.send("evm_mine", []);

      await expect(group.resolveGroup(99)).to.be.revertedWithCustomError(group, "InvalidIndex");
    });

    it("should reject addOutcome after resolution", async function () {
      await ethers.provider.send("evm_increaseTime", [86401]);
      await ethers.provider.send("evm_mine", []);

      await group.resolveGroup(0);

      await expect(group.addOutcome("Late Entry", ethers.Wallet.createRandom().address)).to.be.revertedWithCustomError(
        group,
        "AlreadyResolved",
      );
    });
  });

  // ═══════════════════════════════════════
  // EDGE CASES
  // ═══════════════════════════════════════

  describe("Edge Cases", function () {
    it("should reject resolveGroup with no outcomes", async function () {
      // Deploy a fresh empty group
      const MarketGroup = await ethers.getContractFactory("MarketGroup");
      const emptyGroup = await MarketGroup.deploy("Empty?", "test");
      await emptyGroup.waitForDeployment();

      await expect(emptyGroup.resolveGroup(0)).to.be.revertedWithCustomError(emptyGroup, "NoOutcomes");
    });
  });
});
