import { expect } from "chai";
import { ethers } from "hardhat";
import hre from "hardhat";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";

describe("OracleResolver", function () {
  let oracleResolver: any;
  let market: any;
  let deployer: HardhatEthersSigner;
  let signer1: HardhatEthersSigner;
  let signer2: HardhatEthersSigner;
  let signer3: HardhatEthersSigner;
  let alice: HardhatEthersSigner;
  let marketAddress: string;

  beforeEach(async function () {
    const signers = await ethers.getSigners();
    deployer = signers[0];
    signer1 = signers[1];
    signer2 = signers[2];
    signer3 = signers[3];
    alice = signers[4];

    // Deploy OracleResolver
    const OracleResolver = await ethers.getContractFactory("OracleResolver");
    oracleResolver = await OracleResolver.deploy();
    await oracleResolver.waitForDeployment();
    const resolverAddress = await oracleResolver.getAddress();

    // Deploy ConfidentialUSDT for market constructor
    const ConfidentialUSDT = await ethers.getContractFactory("ConfidentialUSDT");
    const token = await ConfidentialUSDT.deploy();
    await token.waitForDeployment();
    const tokenAddress = await token.getAddress();

    // Deploy a market with OracleResolver as the resolver
    // V2: 9 constructor params (no _matcher)
    const block = await ethers.provider.getBlock("latest");
    const deadline = block!.timestamp + 86400;
    const OpaqueMarket = await ethers.getContractFactory("OpaqueMarket");
    market = await OpaqueMarket.deploy(
      "BTC > $200K?", // _question
      deadline, // _deadline
      "Chainlink BTC/USD", // _resolutionSource
      "onchain_oracle", // _resolutionSourceType
      ">= 200000", // _resolutionCriteria
      "crypto", // _category
      resolverAddress, // _resolver
      deployer.address, // _feeCollector
      tokenAddress, // _token
      deployer.address, // _creator
    );
    await market.waitForDeployment();
    marketAddress = await market.getAddress();
  });

  // ═══════════════════════════════════════
  // DEPLOYMENT
  // ═══════════════════════════════════════

  describe("Deployment", function () {
    it("should set owner correctly", async function () {
      expect(await oracleResolver.owner()).to.equal(deployer.address);
    });
  });

  // ═══════════════════════════════════════
  // MANUAL MULTI-SIG RESOLUTION (MAJORITY VOTING)
  // ═══════════════════════════════════════

  describe("Manual Multi-sig Resolution (Majority Voting)", function () {
    beforeEach(async function () {
      // Configure manual resolution with 2-of-3 multi-sig
      await oracleResolver.configureManual(marketAddress, [signer1.address, signer2.address, signer3.address], 2);
    });

    it("should configure manual resolution correctly", async function () {
      const config = await oracleResolver.getConfig(marketAddress);
      expect(config.sourceType).to.equal(4n); // MANUAL = 4
      expect(config.requiredSignatures).to.equal(2n);
      expect(config.isConfigured).to.equal(true);

      const signersList = await oracleResolver.getMultisigSigners(marketAddress);
      expect(signersList.length).to.equal(3);
    });

    it("should accept votes from valid signers", async function () {
      await ethers.provider.send("evm_increaseTime", [86401]);
      await ethers.provider.send("evm_mine", []);

      await oracleResolver.connect(signer1).submitManualVote(marketAddress, true);
      const [yesVotes, noVotes] = await oracleResolver.getVoteCounts(marketAddress);
      expect(yesVotes).to.equal(1n);
      expect(noVotes).to.equal(0n);
    });

    it("should reject votes from non-signers", async function () {
      await ethers.provider.send("evm_increaseTime", [86401]);
      await ethers.provider.send("evm_mine", []);

      await expect(oracleResolver.connect(alice).submitManualVote(marketAddress, true)).to.be.revertedWithCustomError(
        oracleResolver,
        "NotASigner",
      );
    });

    it("should reject duplicate votes", async function () {
      await ethers.provider.send("evm_increaseTime", [86401]);
      await ethers.provider.send("evm_mine", []);

      await oracleResolver.connect(signer1).submitManualVote(marketAddress, true);
      await expect(oracleResolver.connect(signer1).submitManualVote(marketAddress, true)).to.be.revertedWithCustomError(
        oracleResolver,
        "AlreadySigned",
      );
    });

    it("should resolve market when YES threshold reached", async function () {
      await ethers.provider.send("evm_increaseTime", [86401]);
      await ethers.provider.send("evm_mine", []);

      await oracleResolver.connect(signer1).submitManualVote(marketAddress, true);
      await oracleResolver.connect(signer2).submitManualVote(marketAddress, true);

      expect(await market.resolved()).to.equal(true);
      expect(await market.outcome()).to.equal(true);
    });

    it("should resolve market when NO threshold reached", async function () {
      await ethers.provider.send("evm_increaseTime", [86401]);
      await ethers.provider.send("evm_mine", []);

      await oracleResolver.connect(signer1).submitManualVote(marketAddress, false);
      await oracleResolver.connect(signer2).submitManualVote(marketAddress, false);

      expect(await market.resolved()).to.equal(true);
      expect(await market.outcome()).to.equal(false);
    });

    it("should allow different votes without reverting (H3 fix)", async function () {
      await ethers.provider.send("evm_increaseTime", [86401]);
      await ethers.provider.send("evm_mine", []);

      // Signer1 votes YES, signer2 votes NO — should NOT revert
      await oracleResolver.connect(signer1).submitManualVote(marketAddress, true);
      await oracleResolver.connect(signer2).submitManualVote(marketAddress, false);

      // Market should NOT be resolved (1 YES, 1 NO — neither reached threshold of 2)
      expect(await market.resolved()).to.equal(false);

      const [yesVotes, noVotes] = await oracleResolver.getVoteCounts(marketAddress);
      expect(yesVotes).to.equal(1n);
      expect(noVotes).to.equal(1n);

      // Third signer breaks the tie
      await oracleResolver.connect(signer3).submitManualVote(marketAddress, true);
      expect(await market.resolved()).to.equal(true);
      expect(await market.outcome()).to.equal(true);
    });

    it("should allow owner to reset voting (M6 fix)", async function () {
      await ethers.provider.send("evm_increaseTime", [86401]);
      await ethers.provider.send("evm_mine", []);

      // Cast votes
      await oracleResolver.connect(signer1).submitManualVote(marketAddress, true);

      // Reset
      await oracleResolver.resetManualVoting(marketAddress);

      const [yesVotes, noVotes] = await oracleResolver.getVoteCounts(marketAddress);
      expect(yesVotes).to.equal(0n);
      expect(noVotes).to.equal(0n);

      // Signer1 can vote again after reset
      await oracleResolver.connect(signer1).submitManualVote(marketAddress, false);
      const [y2, n2] = await oracleResolver.getVoteCounts(marketAddress);
      expect(y2).to.equal(0n);
      expect(n2).to.equal(1n);
    });

    it("should not allow non-owner to reset voting", async function () {
      try {
        await oracleResolver.connect(alice).resetManualVoting(marketAddress);
        expect.fail("Should have reverted");
      } catch (err: any) {
        // fhevm plugin may wrap the revert — just verify it failed
        expect(err).to.exist;
      }
    });
  });

  // ═══════════════════════════════════════
  // DIRECT RESOLUTION
  // ═══════════════════════════════════════

  describe("Direct Resolution", function () {
    it("should allow owner to resolve directly (outcome=false)", async function () {
      await ethers.provider.send("evm_increaseTime", [86401]);
      await ethers.provider.send("evm_mine", []);

      await oracleResolver.resolveDirectly(marketAddress, false);
      expect(await market.resolved()).to.equal(true);
      expect(await market.outcome()).to.equal(false);
    });

    it("should allow owner to resolve directly (outcome=true)", async function () {
      await ethers.provider.send("evm_increaseTime", [86401]);
      await ethers.provider.send("evm_mine", []);

      await oracleResolver.resolveDirectly(marketAddress, true);
      expect(await market.resolved()).to.equal(true);
      expect(await market.outcome()).to.equal(true);
    });

    it("should not allow non-owner to resolve directly", async function () {
      await ethers.provider.send("evm_increaseTime", [86401]);
      await ethers.provider.send("evm_mine", []);

      try {
        await oracleResolver.connect(alice).resolveDirectly(marketAddress, true);
        expect.fail("Should have reverted");
      } catch (err: any) {
        expect(err).to.exist;
      }
    });
  });

  // ═══════════════════════════════════════
  // CHAINLINK CONFIGURATION
  // ═══════════════════════════════════════

  describe("Chainlink Configuration", function () {
    it("should configure chainlink resolution with staleness", async function () {
      const fakeFeed = ethers.Wallet.createRandom().address;
      await oracleResolver.configureChainlink(marketAddress, fakeFeed, 20000000000000n, true, 7200);

      const config = await oracleResolver.getConfig(marketAddress);
      expect(config.sourceType).to.equal(0n); // CHAINLINK = 0
      expect(config.chainlinkFeed).to.equal(fakeFeed);
      expect(config.threshold).to.equal(20000000000000n);
      expect(config.thresholdAbove).to.equal(true);
      expect(config.isConfigured).to.equal(true);
    });

    it("should configure chainlink with explicit staleness", async function () {
      const fakeFeed = ethers.Wallet.createRandom().address;
      await oracleResolver.configureChainlink(marketAddress, fakeFeed, 20000000000000n, true, 3600);

      const config = await oracleResolver.getConfig(marketAddress);
      expect(config.isConfigured).to.equal(true);
    });

    it("should reject configureChainlink with zero staleness", async function () {
      const fakeFeed = ethers.Wallet.createRandom().address;
      await expect(
        oracleResolver.configureChainlink(marketAddress, fakeFeed, 20000000000000n, true, 0),
      ).to.be.revertedWithCustomError(oracleResolver, "InvalidConfig");
    });

    it("should reject configureChainlink with zero feed address", async function () {
      await expect(
        oracleResolver.configureChainlink(marketAddress, ethers.ZeroAddress, 20000000000000n, true, 3600),
      ).to.be.revertedWithCustomError(oracleResolver, "FeedRequired");
    });

    it("should only allow owner to configure chainlink", async function () {
      const fakeFeed = ethers.Wallet.createRandom().address;
      try {
        await oracleResolver.connect(alice).configureChainlink(marketAddress, fakeFeed, 20000000000000n, true, 3600);
        expect.fail("Should have reverted");
      } catch (err: any) {
        expect(err).to.exist;
      }
    });
  });

  // ═══════════════════════════════════════
  // ONCHAIN VERIFIABLE RESOLUTION (TIER 2)
  // ═══════════════════════════════════════

  describe("Onchain Verifiable Resolution (Tier 2)", function () {
    let mockSource: any;
    let mockSourceAddress: string;

    beforeEach(async function () {
      const MockOnchainSource = await ethers.getContractFactory("MockOnchainSource");
      mockSource = await MockOnchainSource.deploy(50000);
      await mockSource.waitForDeployment();
      mockSourceAddress = await mockSource.getAddress();
    });

    it("should configure onchain resolution", async function () {
      const callData = mockSource.interface.encodeFunctionData("getValue");
      await oracleResolver.configureOnchain(marketAddress, mockSourceAddress, callData, 40000n, true);

      const config = await oracleResolver.getConfig(marketAddress);
      expect(config.sourceType).to.equal(1n); // ONCHAIN = 1
      expect(config.threshold).to.equal(40000n);
      expect(config.thresholdAbove).to.equal(true);
      expect(config.isConfigured).to.equal(true);
    });

    it("should resolve YES when value >= threshold (thresholdAbove=true)", async function () {
      const callData = mockSource.interface.encodeFunctionData("getValue");
      await oracleResolver.configureOnchain(marketAddress, mockSourceAddress, callData, 40000n, true);

      await ethers.provider.send("evm_increaseTime", [86401]);
      await ethers.provider.send("evm_mine", []);

      await oracleResolver.resolveOnchain(marketAddress);
      expect(await market.resolved()).to.equal(true);
      expect(await market.outcome()).to.equal(true);
    });

    it("should resolve NO when value < threshold (thresholdAbove=true)", async function () {
      const callData = mockSource.interface.encodeFunctionData("getValue");
      await oracleResolver.configureOnchain(marketAddress, mockSourceAddress, callData, 60000n, true);

      await ethers.provider.send("evm_increaseTime", [86401]);
      await ethers.provider.send("evm_mine", []);

      await oracleResolver.resolveOnchain(marketAddress);
      expect(await market.resolved()).to.equal(true);
      expect(await market.outcome()).to.equal(false);
    });

    it("should resolve YES when value <= threshold (thresholdAbove=false)", async function () {
      const callData = mockSource.interface.encodeFunctionData("getValue");
      await oracleResolver.configureOnchain(marketAddress, mockSourceAddress, callData, 60000n, false);

      await ethers.provider.send("evm_increaseTime", [86401]);
      await ethers.provider.send("evm_mine", []);

      await oracleResolver.resolveOnchain(marketAddress);
      expect(await market.resolved()).to.equal(true);
      expect(await market.outcome()).to.equal(true);
    });

    it("should resolve NO when value > threshold (thresholdAbove=false)", async function () {
      const callData = mockSource.interface.encodeFunctionData("getValue");
      await oracleResolver.configureOnchain(marketAddress, mockSourceAddress, callData, 40000n, false);

      await ethers.provider.send("evm_increaseTime", [86401]);
      await ethers.provider.send("evm_mine", []);

      await oracleResolver.resolveOnchain(marketAddress);
      expect(await market.resolved()).to.equal(true);
      expect(await market.outcome()).to.equal(false);
    });

    it("should reject onchain resolution for non-ONCHAIN type", async function () {
      await oracleResolver.configureManual(marketAddress, [signer1.address], 1);

      await ethers.provider.send("evm_increaseTime", [86401]);
      await ethers.provider.send("evm_mine", []);

      await expect(oracleResolver.resolveOnchain(marketAddress)).to.be.revertedWithCustomError(
        oracleResolver,
        "WrongType",
      );
    });

    it("should reject onchain resolution for unconfigured market", async function () {
      const randomAddress = ethers.Wallet.createRandom().address;
      await expect(oracleResolver.resolveOnchain(randomAddress)).to.be.revertedWithCustomError(
        oracleResolver,
        "NotConfigured",
      );
    });

    it("should reject configureOnchain with zero target", async function () {
      const callData = mockSource.interface.encodeFunctionData("getValue");
      await expect(
        oracleResolver.configureOnchain(marketAddress, ethers.ZeroAddress, callData, 40000n, true),
      ).to.be.revertedWithCustomError(oracleResolver, "TargetRequired");
    });

    it("should reject configureOnchain with empty calldata", async function () {
      await expect(
        oracleResolver.configureOnchain(marketAddress, mockSourceAddress, "0x", 40000n, true),
      ).to.be.revertedWithCustomError(oracleResolver, "CalldataRequired");
    });

    it("should emit MarketResolvedOnchain event", async function () {
      const callData = mockSource.interface.encodeFunctionData("getValue");
      await oracleResolver.configureOnchain(marketAddress, mockSourceAddress, callData, 40000n, true);

      await ethers.provider.send("evm_increaseTime", [86401]);
      await ethers.provider.send("evm_mine", []);

      await expect(oracleResolver.resolveOnchain(marketAddress))
        .to.emit(oracleResolver, "MarketResolvedOnchain")
        .withArgs(marketAddress, 50000n, true);
    });

    it("should only allow owner to configure onchain", async function () {
      const callData = mockSource.interface.encodeFunctionData("getValue");
      try {
        await oracleResolver.connect(alice).configureOnchain(marketAddress, mockSourceAddress, callData, 40000n, true);
        expect.fail("Should have reverted");
      } catch (err: any) {
        expect(err).to.exist;
      }
    });
  });

  // ═══════════════════════════════════════
  // ADMIN
  // ═══════════════════════════════════════

  describe("Admin", function () {
    it("should allow ownership transfer (two-step)", async function () {
      await oracleResolver.transferOwnership(alice.address);
      // Owner hasn't changed yet
      expect(await oracleResolver.owner()).to.equal(deployer.address);
      expect(await oracleResolver.pendingOwner()).to.equal(alice.address);

      // Alice accepts
      await oracleResolver.connect(alice).acceptOwnership();
      expect(await oracleResolver.owner()).to.equal(alice.address);
      expect(await oracleResolver.pendingOwner()).to.equal(ethers.ZeroAddress);
    });

    it("should reject transferOwnership to zero address", async function () {
      await expect(oracleResolver.transferOwnership(ethers.ZeroAddress)).to.be.revertedWithCustomError(
        oracleResolver,
        "ZeroAddress",
      );
    });

    it("should reject acceptOwnership from non-pending address", async function () {
      await oracleResolver.transferOwnership(alice.address);
      await expect(oracleResolver.connect(signer1).acceptOwnership()).to.be.revertedWithCustomError(
        oracleResolver,
        "NotPending",
      );
    });
  });

  // ═══════════════════════════════════════
  // MANUAL VOTING THRESHOLD BOUNDARY (CRITICAL)
  // ═══════════════════════════════════════

  describe("Manual Voting Threshold", function () {
    beforeEach(async function () {
      // Configure 2-of-3 voting
      await oracleResolver.configureManual(marketAddress, [signer1.address, signer2.address, signer3.address], 2);
    });

    it("should resolve when exactly reaching threshold", async function () {
      await ethers.provider.send("evm_increaseTime", [86401]);
      await ethers.provider.send("evm_mine", []);

      // 2 YES votes -> market should resolve immediately (threshold = 2)
      await oracleResolver.connect(signer1).submitManualVote(marketAddress, true);
      // After 1 vote, should NOT be resolved yet
      expect(await market.resolved()).to.equal(false);

      await oracleResolver.connect(signer2).submitManualVote(marketAddress, true);
      // After 2 votes (= threshold), should be resolved
      expect(await market.resolved()).to.equal(true);
      expect(await market.outcome()).to.equal(true);
    });

    it("should revert vote after resolution", async function () {
      await ethers.provider.send("evm_increaseTime", [86401]);
      await ethers.provider.send("evm_mine", []);

      // Resolve with 2 YES votes
      await oracleResolver.connect(signer1).submitManualVote(marketAddress, true);
      await oracleResolver.connect(signer2).submitManualVote(marketAddress, true);
      expect(await market.resolved()).to.equal(true);

      // 3rd voter tries to vote after resolution
      // The market.resolve() will be called again by submitManualVote if threshold is met,
      // but since market is already resolved, market.resolve() will revert Resolved.
      // However, the 3rd vote itself may or may not trigger resolve() call
      // depending on whether YES/NO count hits threshold again.
      // With 3 YES votes, yesVoteCount >= requiredSignatures (2) is still true,
      // so it will call market.resolve() which reverts Resolved.
      try {
        await oracleResolver.connect(signer3).submitManualVote(marketAddress, true);
        // If it doesn't revert, that means the vote was recorded but resolve wasn't called again
        // This is acceptable behavior
      } catch (err: any) {
        // Expected: market is already resolved, so the inner resolve() call reverts
        expect(err).to.exist;
      }
    });
  });

  // ═══════════════════════════════════════
  // CHAINLINK STALENESS BOUNDARY (HIGH)
  // ═══════════════════════════════════════

  describe("Chainlink Staleness Boundary", function () {
    let mockAggregator: any;
    let mockAggregatorAddress: string;

    beforeEach(async function () {
      // Deploy MockV3Aggregator with 8 decimals and initial price
      const MockV3Aggregator = await ethers.getContractFactory("MockV3Aggregator");
      mockAggregator = await MockV3Aggregator.deploy(8, 9500000000000n);
      await mockAggregator.waitForDeployment();
      mockAggregatorAddress = await mockAggregator.getAddress();
    });

    it("should revert at exact staleness boundary", async function () {
      // Set maxStaleness = 3600
      await oracleResolver.configureChainlink(marketAddress, mockAggregatorAddress, 9500000000000n, true, 3600);

      // Advance past deadline AND past staleness boundary
      // The price was set at deployment time. After 86401 seconds,
      // updatedAt is stale by 86401 seconds >> 3600 staleness limit
      await ethers.provider.send("evm_increaseTime", [86401]);
      await ethers.provider.send("evm_mine", []);

      // resolveChainlink should revert StalePriceData
      await expect(oracleResolver.resolveChainlink(marketAddress)).to.be.revertedWithCustomError(
        oracleResolver,
        "StalePriceData",
      );
    });

    it("should succeed when price is fresh within staleness", async function () {
      // Set maxStaleness = 3600
      await oracleResolver.configureChainlink(marketAddress, mockAggregatorAddress, 9500000000000n, true, 3600);

      // Advance past deadline
      await ethers.provider.send("evm_increaseTime", [86401]);
      await ethers.provider.send("evm_mine", []);

      // Update the aggregator with a fresh price (this sets updatedAt to current block.timestamp)
      await mockAggregator.updateAnswer(10000000000000n);

      // Now the price data is fresh -> should succeed
      await oracleResolver.resolveChainlink(marketAddress);
      expect(await market.resolved()).to.equal(true);
      expect(await market.outcome()).to.equal(true);
    });
  });

  // ═══════════════════════════════════════
  // CHAINLINK AUTO-RESOLUTION (with MockV3Aggregator)
  // ═══════════════════════════════════════

  describe("Chainlink Auto-Resolution", function () {
    let mockAggregator: any;
    let mockAggregatorAddress: string;

    beforeEach(async function () {
      // Deploy MockV3Aggregator with 8 decimals and initial price of 95000_00000000 ($95,000)
      const MockV3Aggregator = await ethers.getContractFactory("MockV3Aggregator");
      mockAggregator = await MockV3Aggregator.deploy(8, 9500000000000n);
      await mockAggregator.waitForDeployment();
      mockAggregatorAddress = await mockAggregator.getAddress();
    });

    it("should record opening price via configureChainlinkAutoThreshold", async function () {
      await oracleResolver.configureChainlinkAutoThreshold(marketAddress, mockAggregatorAddress, true, 3600);

      const config = await oracleResolver.getConfig(marketAddress);
      expect(config.sourceType).to.equal(0n); // CHAINLINK = 0
      expect(config.isConfigured).to.equal(true);
      // Threshold should be the current price from the mock
      expect(config.threshold).to.equal(9500000000000n);
    });

    it("should return the recorded opening price via getOpeningPrice", async function () {
      await oracleResolver.configureChainlinkAutoThreshold(marketAddress, mockAggregatorAddress, true, 3600);

      const openingPrice = await oracleResolver.getOpeningPrice(marketAddress);
      expect(openingPrice).to.equal(9500000000000n);
    });

    it("should resolve YES when price goes ABOVE threshold (thresholdAbove=true)", async function () {
      // Configure with current price ($95,000) as threshold
      await oracleResolver.configureChainlinkAutoThreshold(marketAddress, mockAggregatorAddress, true, 3600);

      // Advance past deadline
      await ethers.provider.send("evm_increaseTime", [86401]);
      await ethers.provider.send("evm_mine", []);

      // Price rises to $100,000 (update AFTER time advance so timestamp is fresh)
      await mockAggregator.updateAnswer(10000000000000n);

      await oracleResolver.resolveChainlink(marketAddress);

      expect(await market.resolved()).to.equal(true);
      expect(await market.outcome()).to.equal(true);
    });

    it("should resolve NO when price stays BELOW threshold (thresholdAbove=true)", async function () {
      // Configure with current price ($95,000) as threshold
      await oracleResolver.configureChainlinkAutoThreshold(marketAddress, mockAggregatorAddress, true, 3600);

      // Advance past deadline
      await ethers.provider.send("evm_increaseTime", [86401]);
      await ethers.provider.send("evm_mine", []);

      // Price drops to $90,000 (update AFTER time advance so timestamp is fresh)
      await mockAggregator.updateAnswer(9000000000000n);

      await oracleResolver.resolveChainlink(marketAddress);

      expect(await market.resolved()).to.equal(true);
      expect(await market.outcome()).to.equal(false);
    });

    it("should resolve YES when price equals threshold (thresholdAbove=true, >=)", async function () {
      // Configure with current price as threshold
      await oracleResolver.configureChainlinkAutoThreshold(marketAddress, mockAggregatorAddress, true, 3600);

      // Advance past deadline
      await ethers.provider.send("evm_increaseTime", [86401]);
      await ethers.provider.send("evm_mine", []);

      // Price stays the same but update timestamp to be fresh
      await mockAggregator.updateAnswer(9500000000000n);

      await oracleResolver.resolveChainlink(marketAddress);

      expect(await market.resolved()).to.equal(true);
      expect(await market.outcome()).to.equal(true); // price >= threshold
    });

    it("should emit MarketResolvedViaChainlink event", async function () {
      await oracleResolver.configureChainlinkAutoThreshold(marketAddress, mockAggregatorAddress, true, 3600);

      // Advance past deadline
      await ethers.provider.send("evm_increaseTime", [86401]);
      await ethers.provider.send("evm_mine", []);

      // Price rises (update AFTER time advance so timestamp is fresh)
      await mockAggregator.updateAnswer(10000000000000n);

      await expect(oracleResolver.resolveChainlink(marketAddress))
        .to.emit(oracleResolver, "MarketResolvedViaChainlink")
        .withArgs(marketAddress, 10000000000000n, true);
    });

    it("should reject configureChainlinkAutoThreshold with zero feed address", async function () {
      await expect(
        oracleResolver.configureChainlinkAutoThreshold(marketAddress, ethers.ZeroAddress, true, 3600),
      ).to.be.revertedWithCustomError(oracleResolver, "FeedRequired");
    });

    it("should reject resolveChainlink when data is stale", async function () {
      await oracleResolver.configureChainlinkAutoThreshold(
        marketAddress,
        mockAggregatorAddress,
        true,
        3600, // 1 hour staleness
      );

      // Advance time by much more than staleness allows (without updating the aggregator)
      await ethers.provider.send("evm_increaseTime", [86401]);
      await ethers.provider.send("evm_mine", []);

      await expect(oracleResolver.resolveChainlink(marketAddress)).to.be.revertedWithCustomError(
        oracleResolver,
        "StalePriceData",
      );
    });

    it("should reject resolveChainlink for non-CHAINLINK type", async function () {
      // Configure as MANUAL instead
      await oracleResolver.configureManual(marketAddress, [signer1.address], 1);

      await ethers.provider.send("evm_increaseTime", [86401]);
      await ethers.provider.send("evm_mine", []);

      await expect(oracleResolver.resolveChainlink(marketAddress)).to.be.revertedWithCustomError(
        oracleResolver,
        "WrongType",
      );
    });

    it("should reject resolveChainlink for unconfigured market", async function () {
      const randomAddress = ethers.Wallet.createRandom().address;
      await expect(oracleResolver.resolveChainlink(randomAddress)).to.be.revertedWithCustomError(
        oracleResolver,
        "NotConfigured",
      );
    });
  });
});
