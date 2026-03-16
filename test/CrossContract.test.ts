import { expect } from "chai";
import { ethers } from "hardhat";
import { fhevm } from "hardhat";
import { FhevmType } from "@fhevm/hardhat-plugin";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";

describe("CrossContract", function () {
  let factory: any;
  let token: any;
  let resolver: any;
  let group: any;
  let deployer: HardhatEthersSigner;
  let alice: HardhatEthersSigner;
  let bob: HardhatEthersSigner;
  let carol: HardhatEthersSigner;
  let signer1: HardhatEthersSigner;
  let signer2: HardhatEthersSigner;
  let signer3: HardhatEthersSigner;
  let feeCollector: HardhatEthersSigner;
  let tokenAddress: string;
  let resolverAddress: string;

  const SIDE_YES = 0;
  const SIDE_NO = 1;

  // ═══════════════════════════════════════
  // HELPERS
  // ═══════════════════════════════════════

  function findEvent(receipt: any, contract: any, eventName: string) {
    for (const log of receipt.logs) {
      try {
        const parsed = contract.interface.parseLog({ topics: log.topics, data: log.data });
        if (parsed?.name === eventName) return parsed;
      } catch {}
    }
    return null;
  }

  async function createMarketViaFactory(question: string, deadlineOffset = 86400): Promise<string> {
    const block = await ethers.provider.getBlock("latest");
    const deadline = block!.timestamp + deadlineOffset;
    const tx = await factory.createMarket(question, deadline, "Source", "onchain_oracle", "Criteria", "crypto");
    const receipt = await tx.wait();
    const event = findEvent(receipt, factory, "MarketCreated");
    return event!.args.market;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async function getMarketContract(addr: string): Promise<any> {
    const OpaqueMarket = await ethers.getContractFactory("OpaqueMarket");
    return OpaqueMarket.attach(addr);
  }

  async function mintShares(market: any, signer: HardhatEthersSigner, amount: bigint) {
    const marketAddress = await market.getAddress();
    const input = fhevm.createEncryptedInput(marketAddress, signer.address);
    input.add64(amount);
    const encrypted = await input.encrypt();
    return market.connect(signer).mintShares(encrypted.handles[0], encrypted.inputProof);
  }

  async function placeOrder(
    market: any,
    signer: HardhatEthersSigner,
    side: number,
    price: number,
    isBid: boolean,
    amount: bigint,
  ) {
    const marketAddress = await market.getAddress();
    const input = fhevm.createEncryptedInput(marketAddress, signer.address);
    input.add8(side);
    input.add64(amount);
    const encrypted = await input.encrypt();
    return market.connect(signer).placeOrder(
      encrypted.handles[0],
      price,
      isBid,
      encrypted.handles[1],
      encrypted.inputProof,
      encrypted.inputProof,
    );
  }

  async function fundAndApprove(signer: HardhatEthersSigner, marketAddress: string, amount: bigint) {
    await token.mint(signer.address, amount);
    await token.connect(signer).approvePlaintext(marketAddress, amount);
  }

  async function decryptTokenBalance(signer: HardhatEthersSigner): Promise<bigint> {
    const encBal = await token.balanceOf(signer.address);
    return fhevm.userDecryptEuint(FhevmType.euint64, encBal, tokenAddress, signer);
  }

  async function decryptShares(
    market: any,
    signer: HardhatEthersSigner,
  ): Promise<{ yes: bigint; no: bigint }> {
    const marketAddress = await market.getAddress();
    const [yesHandle, noHandle] = await market.connect(signer).getMyShares();
    const yes = await fhevm.userDecryptEuint(FhevmType.euint64, yesHandle, marketAddress, signer);
    const no = await fhevm.userDecryptEuint(FhevmType.euint64, noHandle, marketAddress, signer);
    return { yes, no };
  }

  async function advancePastDeadline() {
    await ethers.provider.send("evm_increaseTime", [86401]);
    await ethers.provider.send("evm_mine", []);
  }

  // ═══════════════════════════════════════
  // FIXTURE
  // ═══════════════════════════════════════

  beforeEach(async function () {
    const signers = await ethers.getSigners();
    deployer = signers[0];
    alice = signers[1];
    bob = signers[2];
    carol = signers[3];
    signer1 = signers[4];
    signer2 = signers[5];
    signer3 = signers[6];
    feeCollector = signers[7];

    // Deploy ConfidentialUSDT
    const ConfidentialUSDT = await ethers.getContractFactory("ConfidentialUSDT");
    token = await ConfidentialUSDT.deploy();
    await token.waitForDeployment();
    tokenAddress = await token.getAddress();

    // Deploy OracleResolver
    const OracleResolver = await ethers.getContractFactory("OracleResolver");
    resolver = await OracleResolver.deploy();
    await resolver.waitForDeployment();
    resolverAddress = await resolver.getAddress();

    // Deploy MarketFactory (6 constructor params)
    const MarketFactory = await ethers.getContractFactory("MarketFactory");
    factory = await MarketFactory.deploy(
      resolverAddress,
      feeCollector.address,
      tokenAddress,
      10_000_000,
      3600,
      300,
    );
    await factory.waitForDeployment();
  });

  // ═══════════════════════════════════════════════════════════════
  // 1. FACTORY -> MARKET CREATION FLOW (8 tests)
  // ═══════════════════════════════════════════════════════════════

  describe("Factory -> Market creation flow", function () {
    it("should create market via factory with correct token", async function () {
      const marketAddr = await createMarketViaFactory("BTC > $100K?");
      const market = await getMarketContract(marketAddr);
      expect(await market.token()).to.equal(tokenAddress);
    });

    it("should create market via factory with correct resolver", async function () {
      const marketAddr = await createMarketViaFactory("BTC > $100K?");
      const market = await getMarketContract(marketAddr);
      expect(await market.resolver()).to.equal(resolverAddress);
    });

    it("should store question, deadline, and source correctly", async function () {
      const block = await ethers.provider.getBlock("latest");
      const deadline = block!.timestamp + 86400;
      const tx = await factory.createMarket(
        "ETH > $10K?",
        deadline,
        "Chainlink ETH/USD",
        "onchain_oracle",
        ">= 10000",
        "crypto",
      );
      await tx.wait();

      const marketAddr = (await factory.getAllMarkets())[0];
      const market = await getMarketContract(marketAddr);
      expect(await market.question()).to.equal("ETH > $10K?");
      expect(await market.resolutionSource()).to.equal("Chainlink ETH/USD");
      expect(await market.resolutionSourceType()).to.equal("onchain_oracle");
      expect(await market.resolutionCriteria()).to.equal(">= 10000");
      expect(await market.category()).to.equal("crypto");
    });

    it("should create multiple markets from same factory", async function () {
      const block = await ethers.provider.getBlock("latest");
      const deadline = block!.timestamp + 86400 + 1200;

      await factory.createMarket("Market 1?", deadline, "Source", "Type", "Criteria", "crypto");

      await ethers.provider.send("evm_increaseTime", [301]);
      await ethers.provider.send("evm_mine", []);

      await factory.createMarket("Market 2?", deadline, "Source", "Type", "Criteria", "crypto");

      await ethers.provider.send("evm_increaseTime", [301]);
      await ethers.provider.send("evm_mine", []);

      await factory.createMarket("Market 3?", deadline, "Source", "Type", "Criteria", "crypto");

      expect(await factory.getMarketCount()).to.equal(3n);
      const allMarkets = await factory.getAllMarkets();
      expect(allMarkets.length).to.equal(3);
    });

    it("should emit MarketCreated event with correct address", async function () {
      const block = await ethers.provider.getBlock("latest");
      const deadline = block!.timestamp + 86400;
      const tx = await factory.createMarket("Event test?", deadline, "Source", "Type", "Criteria", "crypto");
      const receipt = await tx.wait();

      const event = findEvent(receipt, factory, "MarketCreated");
      expect(event).to.not.be.null;
      expect(event!.args.market).to.not.equal(ethers.ZeroAddress);
      expect(event!.args.creator).to.equal(deployer.address);
      expect(event!.args.question).to.equal("Event test?");
      expect(event!.args.marketIndex).to.equal(0n);
    });

    it("should create a functional market that can mint shares", async function () {
      const marketAddr = await createMarketViaFactory("Functional test?");
      const market = await getMarketContract(marketAddr);

      await fundAndApprove(alice, marketAddr, 100_000_000n);
      await mintShares(market, alice, 10_000_000n);

      expect(await market.totalSharesMinted()).to.equal(1n);
      expect(await market.hasUserShares(alice.address)).to.equal(true);
    });

    it("should revert creation with deadline too soon", async function () {
      const block = await ethers.provider.getBlock("latest");
      const deadline = block!.timestamp + 1800; // 30 min (need > 1hr)
      await expect(
        factory.createMarket("Too soon?", deadline, "Source", "Type", "Criteria", "crypto"),
      ).to.be.revertedWithCustomError(factory, "DeadlineTooSoon");
    });

    it("should revert creation with empty question", async function () {
      const block = await ethers.provider.getBlock("latest");
      const deadline = block!.timestamp + 86400;
      await expect(
        factory.createMarket("", deadline, "Source", "Type", "Criteria", "crypto"),
      ).to.be.revertedWithCustomError(factory, "QuestionRequired");
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // 2. FACTORY -> MARKET -> TOKEN INTEGRATION (6 tests)
  // ═══════════════════════════════════════════════════════════════

  describe("Factory -> Market -> Token integration", function () {
    it("should decrease token balance after minting shares via factory-created market", async function () {
      const marketAddr = await createMarketViaFactory("Token test 1?");
      const market = await getMarketContract(marketAddr);

      await fundAndApprove(alice, marketAddr, 100_000_000n);
      const balBefore = await decryptTokenBalance(alice);

      await mintShares(market, alice, 10_000_000n);

      const balAfter = await decryptTokenBalance(alice);
      expect(balBefore - balAfter).to.equal(10_000_000n);
    });

    it("should escrow tokens when placing order on factory-created market", async function () {
      const marketAddr = await createMarketViaFactory("Token test 2?");
      const market = await getMarketContract(marketAddr);

      await fundAndApprove(alice, marketAddr, 100_000_000n);
      const balBefore = await decryptTokenBalance(alice);

      // Bid YES at 6000, 5 shares. Escrow = 6000 * 100 * 5 = 3_000_000
      await placeOrder(market, alice, SIDE_YES, 6000, true, 5n);

      const balAfter = await decryptTokenBalance(alice);
      expect(balBefore - balAfter).to.equal(3_000_000n);
      expect(await market.activeOrderCount()).to.equal(1n);
    });

    it("should restore balance after mint -> burn on factory-created market", async function () {
      const marketAddr = await createMarketViaFactory("Burn test?");
      const market = await getMarketContract(marketAddr);

      await fundAndApprove(alice, marketAddr, 100_000_000n);
      const balBefore = await decryptTokenBalance(alice);

      await mintShares(market, alice, 10_000_000n);

      const balAfterMint = await decryptTokenBalance(alice);
      expect(balBefore - balAfterMint).to.equal(10_000_000n);

      // Burn shares back
      const input = fhevm.createEncryptedInput(marketAddr, alice.address);
      input.add64(10_000_000n);
      const enc = await input.encrypt();
      await market.connect(alice).burnShares(enc.handles[0], enc.inputProof);

      const balAfterBurn = await decryptTokenBalance(alice);
      expect(balAfterBurn).to.equal(balBefore);
    });

    it("should use correct token address for all operations on factory market", async function () {
      const marketAddr = await createMarketViaFactory("Token addr test?");
      const market = await getMarketContract(marketAddr);

      // Verify token is the one from factory
      expect(await market.token()).to.equal(tokenAddress);
      expect(await factory.token()).to.equal(tokenAddress);
    });

    it("should allow multiple markets to share the same token", async function () {
      const market1Addr = await createMarketViaFactory("Multi-token 1?");

      await ethers.provider.send("evm_increaseTime", [301]);
      await ethers.provider.send("evm_mine", []);

      const market2Addr = await createMarketViaFactory("Multi-token 2?");

      const market1 = await getMarketContract(market1Addr);
      const market2 = await getMarketContract(market2Addr);

      expect(await market1.token()).to.equal(tokenAddress);
      expect(await market2.token()).to.equal(tokenAddress);
      expect(await market1.token()).to.equal(await market2.token());
    });

    it("should keep token balance consistent across factory-created markets", async function () {
      const market1Addr = await createMarketViaFactory("Consistent 1?");

      await ethers.provider.send("evm_increaseTime", [301]);
      await ethers.provider.send("evm_mine", []);

      const market2Addr = await createMarketViaFactory("Consistent 2?");

      const market1 = await getMarketContract(market1Addr);
      const market2 = await getMarketContract(market2Addr);

      // Fund alice and approve both markets
      await token.mint(alice.address, 100_000_000n);
      await token.connect(alice).approvePlaintext(market1Addr, 50_000_000);
      await token.connect(alice).approvePlaintext(market2Addr, 50_000_000);

      const balBefore = await decryptTokenBalance(alice);

      // Mint shares on market 1
      await mintShares(market1, alice, 5_000_000n);
      // Mint shares on market 2
      await mintShares(market2, alice, 3_000_000n);

      const balAfter = await decryptTokenBalance(alice);
      expect(balBefore - balAfter).to.equal(8_000_000n);
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // 3. ORACLE RESOLVER -> MARKET RESOLUTION (8 tests)
  // ═══════════════════════════════════════════════════════════════

  describe("OracleResolver -> Market resolution", function () {
    let mockAggregator: any;
    let mockAggregatorAddress: string;

    beforeEach(async function () {
      // Deploy MockV3Aggregator with 8 decimals, price $95,000
      const MockV3Aggregator = await ethers.getContractFactory("MockV3Aggregator");
      mockAggregator = await MockV3Aggregator.deploy(8, 9500000000000n);
      await mockAggregator.waitForDeployment();
      mockAggregatorAddress = await mockAggregator.getAddress();
    });

    it("should resolve market YES via Chainlink when price above threshold", async function () {
      const marketAddr = await createMarketViaFactory("BTC > $95K?");
      const market = await getMarketContract(marketAddr);

      // Configure Chainlink: threshold = $90K, thresholdAbove = true
      await resolver.configureChainlink(marketAddr, mockAggregatorAddress, 9000000000000n, true, 3600);

      await advancePastDeadline();
      // Update price to be fresh
      await mockAggregator.updateAnswer(9500000000000n);

      await resolver.resolveChainlink(marketAddr);

      expect(await market.resolved()).to.equal(true);
      expect(await market.outcome()).to.equal(true);
    });

    it("should resolve market NO via Chainlink when price below threshold", async function () {
      const marketAddr = await createMarketViaFactory("BTC > $100K?");
      const market = await getMarketContract(marketAddr);

      // Configure Chainlink: threshold = $100K, thresholdAbove = true
      await resolver.configureChainlink(marketAddr, mockAggregatorAddress, 10000000000000n, true, 3600);

      await advancePastDeadline();
      // Update price to $95K (below threshold)
      await mockAggregator.updateAnswer(9500000000000n);

      await resolver.resolveChainlink(marketAddr);

      expect(await market.resolved()).to.equal(true);
      expect(await market.outcome()).to.equal(false);
    });

    it("should resolve market YES via manual 2-of-3 voting", async function () {
      const marketAddr = await createMarketViaFactory("Manual YES test?");
      const market = await getMarketContract(marketAddr);

      await resolver.configureManual(marketAddr, [signer1.address, signer2.address, signer3.address], 2);

      await advancePastDeadline();

      await resolver.connect(signer1).submitManualVote(marketAddr, true);
      await resolver.connect(signer2).submitManualVote(marketAddr, true);

      expect(await market.resolved()).to.equal(true);
      expect(await market.outcome()).to.equal(true);
    });

    it("should resolve market NO via manual 2-of-3 voting", async function () {
      const marketAddr = await createMarketViaFactory("Manual NO test?");
      const market = await getMarketContract(marketAddr);

      await resolver.configureManual(marketAddr, [signer1.address, signer2.address, signer3.address], 2);

      await advancePastDeadline();

      await resolver.connect(signer1).submitManualVote(marketAddr, false);
      await resolver.connect(signer2).submitManualVote(marketAddr, false);

      expect(await market.resolved()).to.equal(true);
      expect(await market.outcome()).to.equal(false);
    });

    it("should not resolve market when votes are tied (1 YES, 1 NO)", async function () {
      const marketAddr = await createMarketViaFactory("Tie test?");
      const market = await getMarketContract(marketAddr);

      await resolver.configureManual(marketAddr, [signer1.address, signer2.address, signer3.address], 2);

      await advancePastDeadline();

      await resolver.connect(signer1).submitManualVote(marketAddr, true);
      await resolver.connect(signer2).submitManualVote(marketAddr, false);

      // 1 YES, 1 NO -- neither reached threshold of 2
      expect(await market.resolved()).to.equal(false);

      const [yesVotes, noVotes] = await resolver.getVoteCounts(marketAddr);
      expect(yesVotes).to.equal(1n);
      expect(noVotes).to.equal(1n);
    });

    it("should resolve when third vote breaks tie", async function () {
      const marketAddr = await createMarketViaFactory("Tiebreaker test?");
      const market = await getMarketContract(marketAddr);

      await resolver.configureManual(marketAddr, [signer1.address, signer2.address, signer3.address], 2);

      await advancePastDeadline();

      await resolver.connect(signer1).submitManualVote(marketAddr, true);
      await resolver.connect(signer2).submitManualVote(marketAddr, false);
      expect(await market.resolved()).to.equal(false);

      // Third vote breaks the tie
      await resolver.connect(signer3).submitManualVote(marketAddr, true);
      expect(await market.resolved()).to.equal(true);
      expect(await market.outcome()).to.equal(true);
    });

    it("should revert Chainlink resolution when data is stale", async function () {
      const marketAddr = await createMarketViaFactory("Staleness test?");

      await resolver.configureChainlink(marketAddr, mockAggregatorAddress, 9500000000000n, true, 3600);

      // Advance past deadline WITHOUT updating aggregator
      await advancePastDeadline();

      await expect(resolver.resolveChainlink(marketAddr)).to.be.revertedWithCustomError(
        resolver,
        "StalePriceData",
      );
    });

    it("should allow resolveDirectly after deadline", async function () {
      const marketAddr = await createMarketViaFactory("Direct test?");
      const market = await getMarketContract(marketAddr);

      await advancePastDeadline();

      await resolver.resolveDirectly(marketAddr, true);

      expect(await market.resolved()).to.equal(true);
      expect(await market.outcome()).to.equal(true);
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // 4. MARKET GROUP -> MULTI-OUTCOME RESOLUTION (7 tests)
  // ═══════════════════════════════════════════════════════════════

  describe("MarketGroup -> Multi-outcome resolution", function () {
    let market1: any;
    let market2: any;
    let market3: any;
    let market1Address: string;
    let market2Address: string;
    let market3Address: string;

    async function deployGroupWithMarkets(numOutcomes: number, labels: string[]) {
      const MarketGroup = await ethers.getContractFactory("MarketGroup");
      group = await MarketGroup.deploy("Who wins the election?", "politics");
      await group.waitForDeployment();
      const groupAddress = await group.getAddress();

      const block = await ethers.provider.getBlock("latest");
      const deadline = block!.timestamp + 86400;
      const OpaqueMarket = await ethers.getContractFactory("OpaqueMarket");

      const markets: any[] = [];
      const addresses: string[] = [];

      for (let i = 0; i < numOutcomes; i++) {
        const m = await OpaqueMarket.deploy(
          `${labels[i]} wins?`,
          deadline,
          "Official Results",
          "manual_multisig",
          `${labels[i]} wins`,
          "politics",
          groupAddress,
          deployer.address,
          tokenAddress,
          deployer.address,
        );
        await m.waitForDeployment();
        const addr = await m.getAddress();
        markets.push(m);
        addresses.push(addr);
        await group.addOutcome(labels[i], addr);
      }

      return { markets, addresses };
    }

    beforeEach(async function () {
      const result = await deployGroupWithMarkets(3, ["Alice", "Bob", "Carol"]);
      market1 = result.markets[0];
      market2 = result.markets[1];
      market3 = result.markets[2];
      market1Address = result.addresses[0];
      market2Address = result.addresses[1];
      market3Address = result.addresses[2];
    });

    it("should resolve 3-outcome group with winner 0 correctly", async function () {
      await advancePastDeadline();

      await group.resolveGroup(0);

      expect(await group.resolved()).to.equal(true);
      expect(await group.winningIndex()).to.equal(0n);

      // Winner market = YES
      expect(await market1.resolved()).to.equal(true);
      expect(await market1.outcome()).to.equal(true);

      // Loser markets = NO
      expect(await market2.resolved()).to.equal(true);
      expect(await market2.outcome()).to.equal(false);

      expect(await market3.resolved()).to.equal(true);
      expect(await market3.outcome()).to.equal(false);
    });

    it("should resolve 2-outcome group with winner 1 correctly", async function () {
      // Deploy a fresh 2-outcome group
      const MarketGroup2 = await ethers.getContractFactory("MarketGroup");
      const group2 = await MarketGroup2.deploy("Binary choice?", "test");
      await group2.waitForDeployment();
      const group2Address = await group2.getAddress();

      const block = await ethers.provider.getBlock("latest");
      const deadline = block!.timestamp + 86400;
      const OpaqueMarket = await ethers.getContractFactory("OpaqueMarket");

      const mA = await OpaqueMarket.deploy(
        "Option A?", deadline, "Source", "Type", "A wins", "test",
        group2Address, deployer.address, tokenAddress, deployer.address,
      );
      await mA.waitForDeployment();
      const mAAddr = await mA.getAddress();

      const mB = await OpaqueMarket.deploy(
        "Option B?", deadline, "Source", "Type", "B wins", "test",
        group2Address, deployer.address, tokenAddress, deployer.address,
      );
      await mB.waitForDeployment();
      const mBAddr = await mB.getAddress();

      await group2.addOutcome("Option A", mAAddr);
      await group2.addOutcome("Option B", mBAddr);

      await advancePastDeadline();

      await group2.resolveGroup(1);

      expect(await group2.winningIndex()).to.equal(1n);
      expect(await mA.outcome()).to.equal(false);
      expect(await mB.outcome()).to.equal(true);
    });

    it("should track correct outcome count for 4-outcome group", async function () {
      const MarketGroup4 = await ethers.getContractFactory("MarketGroup");
      const group4 = await MarketGroup4.deploy("4-way race?", "politics");
      await group4.waitForDeployment();

      const fakeAddr1 = ethers.Wallet.createRandom().address;
      const fakeAddr2 = ethers.Wallet.createRandom().address;
      const fakeAddr3 = ethers.Wallet.createRandom().address;
      const fakeAddr4 = ethers.Wallet.createRandom().address;

      await group4.addOutcome("A", fakeAddr1);
      await group4.addOutcome("B", fakeAddr2);
      await group4.addOutcome("C", fakeAddr3);
      await group4.addOutcome("D", fakeAddr4);

      expect(await group4.outcomeCount()).to.equal(4n);
    });

    it("should resolve group and verify winner=YES, all losers=NO", async function () {
      await advancePastDeadline();

      await group.resolveGroup(1); // Bob wins

      // Winner (index 1) = YES
      expect(await market2.resolved()).to.equal(true);
      expect(await market2.outcome()).to.equal(true);

      // Losers = NO
      expect(await market1.resolved()).to.equal(true);
      expect(await market1.outcome()).to.equal(false);
      expect(await market3.resolved()).to.equal(true);
      expect(await market3.outcome()).to.equal(false);
    });

    it("should reject addOutcome after resolution", async function () {
      await advancePastDeadline();
      await group.resolveGroup(0);

      await expect(
        group.addOutcome("Late Entry", ethers.Wallet.createRandom().address),
      ).to.be.revertedWithCustomError(group, "AlreadyResolved");
    });

    it("should reject resolveGroup with invalid index", async function () {
      await advancePastDeadline();

      await expect(group.resolveGroup(99)).to.be.revertedWithCustomError(group, "InvalidIndex");
    });

    it("should return correct group info before and after resolution", async function () {
      // Before resolution
      const [qBefore, countBefore, isResolvedBefore, winnerBefore, catBefore] = await group.getGroupInfo();
      expect(qBefore).to.equal("Who wins the election?");
      expect(countBefore).to.equal(3n);
      expect(isResolvedBefore).to.equal(false);
      expect(winnerBefore).to.equal(0n);
      expect(catBefore).to.equal("politics");

      // Resolve
      await advancePastDeadline();
      await group.resolveGroup(2);

      // After resolution
      const [qAfter, countAfter, isResolvedAfter, winnerAfter, catAfter] = await group.getGroupInfo();
      expect(qAfter).to.equal("Who wins the election?");
      expect(countAfter).to.equal(3n);
      expect(isResolvedAfter).to.equal(true);
      expect(winnerAfter).to.equal(2n);
      expect(catAfter).to.equal("politics");
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // 5. FULL LIFECYCLE CROSS-CONTRACT (6 tests)
  // ═══════════════════════════════════════════════════════════════

  describe("Full lifecycle cross-contract", function () {
    it("should complete: factory create -> mint -> trade -> OracleResolver resolve -> request redemption", async function () {
      const marketAddr = await createMarketViaFactory("Full lifecycle?");
      const market = await getMarketContract(marketAddr);

      await fundAndApprove(alice, marketAddr, 100_000_000n);
      await fundAndApprove(bob, marketAddr, 100_000_000n);

      // Alice mints shares
      await mintShares(market, alice, 10_000_000n);

      // Alice places an ask (sells YES at 6000)
      await placeOrder(market, alice, SIDE_YES, 6000, false, 10n);

      // Bob places a bid (buys NO at 6000, opposite side -> match fills)
      await placeOrder(market, bob, SIDE_NO, 6000, true, 10n);

      // Match orders
      await market.connect(carol).attemptMatch(1, 0);

      // Configure resolver and resolve via Chainlink
      const MockV3Aggregator = await ethers.getContractFactory("MockV3Aggregator");
      const mockFeed = await MockV3Aggregator.deploy(8, 10000000000000n);
      await mockFeed.waitForDeployment();
      const mockFeedAddress = await mockFeed.getAddress();

      await resolver.configureChainlink(marketAddr, mockFeedAddress, 9500000000000n, true, 3600);

      await advancePastDeadline();
      await mockFeed.updateAnswer(10000000000000n); // fresh price

      await resolver.resolveChainlink(marketAddr);

      expect(await market.resolved()).to.equal(true);
      expect(await market.outcome()).to.equal(true);

      // Request redemption (finalize requires KMS, so we only request here)
      await market.connect(alice).requestRedemption();
      // If alice has shares, the request should succeed
      expect(await market.hasUserShares(alice.address)).to.equal(true);
    });

    it("should complete: factory create -> mint -> trade -> MarketGroup resolve -> verify", async function () {
      // Create group and markets
      const MarketGroup = await ethers.getContractFactory("MarketGroup");
      const grp = await MarketGroup.deploy("Cross-contract group test?", "crypto");
      await grp.waitForDeployment();
      const grpAddress = await grp.getAddress();

      const block = await ethers.provider.getBlock("latest");
      const deadline = block!.timestamp + 86400;
      const OpaqueMarket = await ethers.getContractFactory("OpaqueMarket");

      const m1 = await OpaqueMarket.deploy(
        "Outcome A?", deadline, "Source", "Type", "Criteria", "crypto",
        grpAddress, feeCollector.address, tokenAddress, deployer.address,
      );
      await m1.waitForDeployment();
      const m1Addr = await m1.getAddress();

      const m2 = await OpaqueMarket.deploy(
        "Outcome B?", deadline, "Source", "Type", "Criteria", "crypto",
        grpAddress, feeCollector.address, tokenAddress, deployer.address,
      );
      await m2.waitForDeployment();
      const m2Addr = await m2.getAddress();

      await grp.addOutcome("A", m1Addr);
      await grp.addOutcome("B", m2Addr);

      // Fund and mint on market 1
      await fundAndApprove(alice, m1Addr, 100_000_000n);
      await mintShares(m1, alice, 10_000_000n);

      // Resolve group with winner = A
      await advancePastDeadline();
      await grp.resolveGroup(0);

      expect(await m1.resolved()).to.equal(true);
      expect(await m1.outcome()).to.equal(true);
      expect(await m2.resolved()).to.equal(true);
      expect(await m2.outcome()).to.equal(false);
    });

    it("should handle two markets with same token and independent resolution", async function () {
      const market1Addr = await createMarketViaFactory("Independent 1?");

      await ethers.provider.send("evm_increaseTime", [301]);
      await ethers.provider.send("evm_mine", []);

      const market2Addr = await createMarketViaFactory("Independent 2?");

      const m1 = await getMarketContract(market1Addr);
      const m2 = await getMarketContract(market2Addr);

      // Configure different resolutions
      await resolver.configureManual(market1Addr, [signer1.address, signer2.address], 2);
      await resolver.configureManual(market2Addr, [signer1.address, signer2.address], 2);

      await advancePastDeadline();

      // Resolve market 1 as YES
      await resolver.connect(signer1).submitManualVote(market1Addr, true);
      await resolver.connect(signer2).submitManualVote(market1Addr, true);

      // Resolve market 2 as NO
      await resolver.connect(signer1).submitManualVote(market2Addr, false);
      await resolver.connect(signer2).submitManualVote(market2Addr, false);

      expect(await m1.resolved()).to.equal(true);
      expect(await m1.outcome()).to.equal(true);
      expect(await m2.resolved()).to.equal(true);
      expect(await m2.outcome()).to.equal(false);
    });

    it("should allow cancelMarket on factory-created market with no participants", async function () {
      const marketAddr = await createMarketViaFactory("Cancel test?");
      const market = await getMarketContract(marketAddr);

      // Market was created by deployer (msg.sender of factory.createMarket)
      // deployer is the creator
      await market.connect(deployer).cancelMarket();

      expect(await market.resolved()).to.equal(true);
    });

    it("should pause and unpause a factory-created market", async function () {
      const marketAddr = await createMarketViaFactory("Pause test?");
      const market = await getMarketContract(marketAddr);

      await fundAndApprove(alice, marketAddr, 100_000_000n);

      // Creator pauses the market
      await market.connect(deployer).pause();

      // Mint should revert when paused (EnforcedPause from OpenZeppelin Pausable)
      try {
        await mintShares(market, alice, 10_000_000n);
        expect.fail("Should have reverted");
      } catch (err: any) {
        expect(err).to.exist;
      }

      // Creator unpauses
      await market.connect(deployer).unpause();

      // Mint should work now
      await mintShares(market, alice, 10_000_000n);
      expect(await market.totalSharesMinted()).to.equal(1n);
    });

    it("should return escrow after placing and cancelling order on factory-created market", async function () {
      const marketAddr = await createMarketViaFactory("Cancel order test?");
      const market = await getMarketContract(marketAddr);

      await fundAndApprove(alice, marketAddr, 100_000_000n);
      const balBefore = await decryptTokenBalance(alice);

      // Bid YES at 7000, 5 shares. Escrow = 7000 * 100 * 5 = 3_500_000
      await placeOrder(market, alice, SIDE_YES, 7000, true, 5n);
      expect(await market.activeOrderCount()).to.equal(1n);

      const balAfterOrder = await decryptTokenBalance(alice);
      expect(balBefore - balAfterOrder).to.equal(3_500_000n);

      // Cancel the order
      await market.connect(alice).cancelOrder(0);
      expect(await market.activeOrderCount()).to.equal(0n);

      // Escrow should be returned
      const balAfterCancel = await decryptTokenBalance(alice);
      expect(balAfterCancel).to.equal(balBefore);
    });
  });
});
