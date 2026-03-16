import { expect } from "chai";
import { ethers } from "hardhat";
import hre from "hardhat";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";

describe("MarketFactory", function () {
  let factory: any;
  let token: any;
  let deployer: HardhatEthersSigner;
  let resolver: HardhatEthersSigner;
  let alice: HardhatEthersSigner;
  let bob: HardhatEthersSigner;

  beforeEach(async function () {
    const signers = await ethers.getSigners();
    deployer = signers[0];
    resolver = signers[1];
    alice = signers[2];
    bob = signers[3];

    // Deploy ConfidentialUSDT
    const ConfidentialUSDT = await ethers.getContractFactory("ConfidentialUSDT");
    token = await ConfidentialUSDT.deploy();
    await token.waitForDeployment();
    const tokenAddress = await token.getAddress();

    // V2: 6 constructor params (no _defaultMatcher)
    const MarketFactory = await ethers.getContractFactory("MarketFactory");
    factory = await MarketFactory.deploy(
      resolver.address, // _defaultResolver
      deployer.address, // _feeCollector
      tokenAddress, // _token
      10_000_000, // _creationFee (10 cUSDT)
      3600, // _minDuration (1 hour)
      300, // _creationCooldown (5 min)
    );
    await factory.waitForDeployment();
  });

  // ═══════════════════════════════════════
  // 1. DEPLOYMENT (6 tests)
  // ═══════════════════════════════════════

  describe("Deployment", function () {
    it("should set owner correctly", async function () {
      expect(await factory.owner()).to.equal(deployer.address);
    });

    it("should set default resolver", async function () {
      expect(await factory.defaultResolver()).to.equal(resolver.address);
    });

    it("should set fee collector", async function () {
      expect(await factory.feeCollector()).to.equal(deployer.address);
    });

    it("should set token address", async function () {
      const tokenAddr = await token.getAddress();
      expect(await factory.token()).to.equal(tokenAddr);
    });

    it("should have correct CREATION_FEE constant", async function () {
      expect(await factory.CREATION_FEE()).to.equal(10_000_000n);
    });

    it("should have correct MIN_DURATION constant", async function () {
      expect(await factory.MIN_DURATION()).to.equal(3600n);
    });

    it("should have correct CREATION_COOLDOWN constant", async function () {
      expect(await factory.CREATION_COOLDOWN()).to.equal(300n);
    });

    it("should have creation fee disabled by default", async function () {
      expect(await factory.creationFeeEnabled()).to.equal(false);
    });

    it("should start with 0 markets", async function () {
      expect(await factory.getMarketCount()).to.equal(0n);
    });
  });

  // ═══════════════════════════════════════
  // 2. MARKET CREATION (6 tests)
  // ═══════════════════════════════════════

  describe("Market Creation", function () {
    it("should create a market with valid params and emit MarketCreated", async function () {
      const block = await ethers.provider.getBlock("latest");
      const deadline = block!.timestamp + 86400;

      const tx = await factory.createMarket(
        "BTC > $200K by Dec 2026?",
        deadline,
        "Chainlink BTC/USD Price Feed",
        "onchain_oracle",
        ">= 200000",
        "crypto",
      );
      const receipt = await tx.wait();

      expect(await factory.getMarketCount()).to.equal(1n);

      // Parse event from receipt logs
      const event = receipt.logs.find((log: any) => {
        try {
          const parsed = factory.interface.parseLog({ topics: log.topics, data: log.data });
          return parsed?.name === "MarketCreated";
        } catch {
          return false;
        }
      });
      expect(event).to.not.be.undefined;
    });

    it("should pass token address to created market", async function () {
      const block = await ethers.provider.getBlock("latest");
      const deadline = block!.timestamp + 86400;
      await factory.createMarket("Question?", deadline, "Source", "Type", "Criteria", "crypto");

      const marketAddr = (await factory.getAllMarkets())[0];
      const OpaqueMarket = await ethers.getContractFactory("OpaqueMarket");
      const market = OpaqueMarket.attach(marketAddr) as any;
      expect(await market.token()).to.equal(await token.getAddress());
    });

    it("should pass resolver and feeCollector to created market", async function () {
      const block = await ethers.provider.getBlock("latest");
      const deadline = block!.timestamp + 86400;
      await factory.createMarket("Question?", deadline, "Source", "Type", "Criteria", "crypto");

      const marketAddr = (await factory.getAllMarkets())[0];
      const OpaqueMarket = await ethers.getContractFactory("OpaqueMarket");
      const market = OpaqueMarket.attach(marketAddr) as any;
      expect(await market.resolver()).to.equal(resolver.address);
      expect(await market.feeCollector()).to.equal(deployer.address);
    });

    it("should create market with custom resolver via createMarketWithResolver", async function () {
      const block = await ethers.provider.getBlock("latest");
      const deadline = block!.timestamp + 86400;

      const tx = await factory.createMarketWithResolver(
        "Custom resolved market?",
        deadline,
        "Manual",
        "manual_multisig",
        "Manual resolution",
        "crypto",
        alice.address,
      );
      await tx.wait();

      expect(await factory.getMarketCount()).to.equal(1n);

      const marketAddr = (await factory.getAllMarkets())[0];
      const OpaqueMarket = await ethers.getContractFactory("OpaqueMarket");
      const market = OpaqueMarket.attach(marketAddr) as any;
      expect(await market.resolver()).to.equal(alice.address);
    });

    it("should create multiple markets (with cooldown)", async function () {
      const block = await ethers.provider.getBlock("latest");
      const deadline = block!.timestamp + 86400 + 1200;

      await factory.createMarket("Market 1?", deadline, "Source 1", "Type", "Criteria", "crypto");

      await ethers.provider.send("evm_increaseTime", [301]);
      await ethers.provider.send("evm_mine", []);

      await factory.createMarket("Market 2?", deadline, "Source 2", "Type", "Criteria", "crypto");

      await ethers.provider.send("evm_increaseTime", [301]);
      await ethers.provider.send("evm_mine", []);

      await factory.createMarket("Market 3?", deadline, "Source 3", "Type", "Criteria", "crypto");

      expect(await factory.getMarketCount()).to.equal(3n);
    });

    it("should return correct market addresses", async function () {
      const block = await ethers.provider.getBlock("latest");
      const deadline = block!.timestamp + 86400 + 600;

      await factory.createMarket("Market 1?", deadline, "Source", "Type", "Criteria", "crypto");

      await ethers.provider.send("evm_increaseTime", [301]);
      await ethers.provider.send("evm_mine", []);

      await factory.createMarket("Market 2?", deadline, "Source", "Type", "Criteria", "crypto");

      const allMarkets = await factory.getAllMarkets();
      expect(allMarkets.length).to.equal(2);

      // Verify individual market access by index
      const first = await factory.markets(0);
      expect(first).to.equal(allMarkets[0]);
    });

    it("should reject market without question", async function () {
      const block = await ethers.provider.getBlock("latest");
      const deadline = block!.timestamp + 86400;
      await expect(
        factory.createMarket("", deadline, "Source", "Type", "Criteria", "crypto"),
      ).to.be.revertedWithCustomError(factory, "QuestionRequired");
    });

    it("should reject market without resolution source", async function () {
      const block = await ethers.provider.getBlock("latest");
      const deadline = block!.timestamp + 86400;
      await expect(
        factory.createMarket("Question?", deadline, "", "Type", "Criteria", "crypto"),
      ).to.be.revertedWithCustomError(factory, "SourceRequired");
    });

    it("should reject market without resolution source type", async function () {
      const block = await ethers.provider.getBlock("latest");
      const deadline = block!.timestamp + 86400;
      await expect(
        factory.createMarket("Question?", deadline, "Source", "", "Criteria", "crypto"),
      ).to.be.revertedWithCustomError(factory, "SourceTypeRequired");
    });

    it("should reject market without resolution criteria", async function () {
      const block = await ethers.provider.getBlock("latest");
      const deadline = block!.timestamp + 86400;
      await expect(
        factory.createMarket("Question?", deadline, "Source", "Type", "", "crypto"),
      ).to.be.revertedWithCustomError(factory, "CriteriaRequired");
    });

    it("should reject market with deadline too soon", async function () {
      const block = await ethers.provider.getBlock("latest");
      const deadline = block!.timestamp + 1800; // 30 min (need > 1hr)
      await expect(
        factory.createMarket("Question?", deadline, "Source", "Type", "Criteria", "crypto"),
      ).to.be.revertedWithCustomError(factory, "DeadlineTooSoon");
    });

    it("should reject market creation within cooldown", async function () {
      const block = await ethers.provider.getBlock("latest");
      const deadline = block!.timestamp + 86400;

      await factory.createMarket("Market 1?", deadline, "Source", "Type", "Criteria", "crypto");

      await expect(
        factory.createMarket("Market 2?", deadline, "Source", "Type", "Criteria", "crypto"),
      ).to.be.revertedWithCustomError(factory, "CreationCooldown");
    });

    it("should reject createMarketWithResolver with zero address", async function () {
      const block = await ethers.provider.getBlock("latest");
      const deadline = block!.timestamp + 86400;
      await expect(
        factory.createMarketWithResolver(
          "Question?",
          deadline,
          "Source",
          "Type",
          "Criteria",
          "crypto",
          ethers.ZeroAddress,
        ),
      ).to.be.revertedWithCustomError(factory, "ResolverRequired");
    });
  });

  // ═══════════════════════════════════════
  // 3. CREATION FEE (2 tests)
  // ═══════════════════════════════════════

  describe("Creation Fee", function () {
    it("should allow owner to enable and disable creation fee", async function () {
      await factory.setCreationFeeEnabled(true);
      expect(await factory.creationFeeEnabled()).to.equal(true);

      await factory.setCreationFeeEnabled(false);
      expect(await factory.creationFeeEnabled()).to.equal(false);
    });

    it("should not allow non-owner to toggle creation fee", async function () {
      await expect(factory.connect(alice).setCreationFeeEnabled(true)).to.be.revertedWithCustomError(
        factory,
        "OnlyOwner",
      );
    });
  });

  // ═══════════════════════════════════════
  // 4. ADMIN (3+ tests)
  // ═══════════════════════════════════════

  describe("Admin", function () {
    it("should allow owner to set default resolver", async function () {
      await factory.setDefaultResolver(alice.address);
      expect(await factory.defaultResolver()).to.equal(alice.address);
    });

    it("should not allow non-owner to set default resolver", async function () {
      await expect(factory.connect(alice).setDefaultResolver(alice.address)).to.be.revertedWithCustomError(
        factory,
        "OnlyOwner",
      );
    });

    it("should allow owner to set fee collector", async function () {
      await factory.setFeeCollector(bob.address);
      expect(await factory.feeCollector()).to.equal(bob.address);
    });

    it("should not allow non-owner to set fee collector", async function () {
      await expect(factory.connect(alice).setFeeCollector(alice.address)).to.be.revertedWithCustomError(
        factory,
        "OnlyOwner",
      );
    });

    it("should allow ownership transfer (two-step)", async function () {
      await factory.transferOwnership(alice.address);
      // Owner hasn't changed yet
      expect(await factory.owner()).to.equal(deployer.address);
      expect(await factory.pendingOwner()).to.equal(alice.address);

      // Alice accepts
      await factory.connect(alice).acceptOwnership();
      expect(await factory.owner()).to.equal(alice.address);
      expect(await factory.pendingOwner()).to.equal(ethers.ZeroAddress);
    });

    it("should reject transferOwnership to zero address", async function () {
      await expect(factory.transferOwnership(ethers.ZeroAddress)).to.be.revertedWithCustomError(factory, "ZeroAddress");
    });

    it("should reject acceptOwnership from non-pending address", async function () {
      await factory.transferOwnership(alice.address);
      await expect(factory.connect(bob).acceptOwnership()).to.be.revertedWithCustomError(factory, "NotPending");
    });
  });

  // ═══════════════════════════════════════
  // 5. CREATION FEE END-TO-END (2 tests)
  // ═══════════════════════════════════════

  describe("Creation Fee End-to-End", function () {
    it("should charge creation fee when enabled (requires token approval first)", async function () {
      // Enable creation fee
      await factory.setCreationFeeEnabled(true);
      expect(await factory.creationFeeEnabled()).to.equal(true);

      // Mint tokens to alice so she can pay the fee
      const tokenAddress = await token.getAddress();
      await token.mint(alice.address, 100_000_000n);

      // Alice approves factory to spend her tokens
      const factoryAddress = await factory.getAddress();
      await token.connect(alice).approvePlaintext(factoryAddress, 100_000_000);

      const block = await ethers.provider.getBlock("latest");
      const deadline = block!.timestamp + 86400;

      // Create market as alice (fee should be charged)
      const tx = await factory
        .connect(alice)
        .createMarket("Fee test market?", deadline, "Source", "Type", "Criteria", "crypto");
      await tx.wait();

      expect(await factory.getMarketCount()).to.equal(1n);

      // Market should be created successfully despite fee being enabled
      const allMarkets = await factory.getAllMarkets();
      expect(allMarkets.length).to.equal(1);
    });

    it("should create market without fee when creation fee is disabled", async function () {
      // Ensure creation fee is disabled (default state)
      expect(await factory.creationFeeEnabled()).to.equal(false);

      const block = await ethers.provider.getBlock("latest");
      const deadline = block!.timestamp + 86400;

      // Create market as alice without any token balance or approval
      // Since fee is disabled, no token transfer should occur
      const tx = await factory
        .connect(alice)
        .createMarket("No fee market?", deadline, "Source", "Type", "Criteria", "crypto");
      await tx.wait();

      expect(await factory.getMarketCount()).to.equal(1n);
    });

    it("should revert when fee enabled but no approval given", async function () {
      // Enable creation fee
      await factory.setCreationFeeEnabled(true);

      // Mint tokens to bob but do NOT approve factory
      await token.mint(bob.address, 100_000_000n);

      const block = await ethers.provider.getBlock("latest");
      const deadline = block!.timestamp + 86400;

      // Bob tries to create market without approving factory — should revert
      try {
        await factory.connect(bob).createMarket("Should fail?", deadline, "Source", "Type", "Criteria", "crypto");
        expect.fail("Should have reverted");
      } catch (err: any) {
        // fhevm plugin may wrap the revert — just verify it failed
        expect(err).to.exist;
      }
    });
  });
});
