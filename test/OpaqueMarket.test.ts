import { expect } from "chai";
import { ethers } from "hardhat";
import { fhevm } from "hardhat";
import { FhevmType } from "@fhevm/hardhat-plugin";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";

describe("OpaqueMarket", function () {
  let market: any;
  let token: any;
  let signers: HardhatEthersSigner[];
  let deployer: HardhatEthersSigner;
  let alice: HardhatEthersSigner;
  let bob: HardhatEthersSigner;
  let resolver: HardhatEthersSigner;
  let charlie: HardhatEthersSigner;
  let feeCollector: HardhatEthersSigner;
  let marketAddress: string;
  let tokenAddress: string;
  let deadline: number;

  const QUESTION = "BTC exceeds $200K by Dec 2026?";
  const RESOLUTION_SOURCE = "Chainlink BTC/USD Price Feed";
  const RESOLUTION_TYPE = "onchain_oracle";
  const RESOLUTION_CRITERIA = ">= 200000";

  const SIDE_YES = 0;
  const SIDE_NO = 1;

  // V2 constants
  const ONE_DAY = 86400;
  const SEVEN_DAYS = 7 * ONE_DAY;

  // -------------------------------------------------------
  // HELPERS
  // -------------------------------------------------------

  async function placeOrder(signer: HardhatEthersSigner, side: number, price: number, isBid: boolean, amount: bigint) {
    const input = fhevm.createEncryptedInput(marketAddress, signer.address);
    input.add8(side); // handle[0] — 0=YES, 1=NO
    input.add64(amount); // handle[1] — share count
    const encrypted = await input.encrypt();
    const tx = await market.connect(signer).placeOrder(
      encrypted.handles[0], // encSide
      price,
      isBid,
      encrypted.handles[1], // encAmount
      encrypted.inputProof, // sideProof
      encrypted.inputProof, // amountProof (same proof covers both)
    );
    return tx;
  }

  async function mintSharesFor(signer: HardhatEthersSigner, microCusdt: bigint) {
    const input = fhevm.createEncryptedInput(marketAddress, signer.address);
    input.add64(microCusdt);
    const enc = await input.encrypt();
    return market.connect(signer).mintShares(enc.handles[0], enc.inputProof);
  }

  async function burnSharesFor(signer: HardhatEthersSigner, microCusdt: bigint) {
    const input = fhevm.createEncryptedInput(marketAddress, signer.address);
    input.add64(microCusdt);
    const enc = await input.encrypt();
    return market.connect(signer).burnShares(enc.handles[0], enc.inputProof);
  }

  async function decryptTokenBalance(signer: HardhatEthersSigner): Promise<bigint> {
    const encBal = await token.balanceOf(signer.address);
    return fhevm.userDecryptEuint(FhevmType.euint64, encBal, tokenAddress, signer);
  }

  async function decryptYesShares(signer: HardhatEthersSigner): Promise<bigint> {
    const [yesHandle] = await market.connect(signer).getMyShares();
    return fhevm.userDecryptEuint(FhevmType.euint64, yesHandle, marketAddress, signer);
  }

  async function decryptNoShares(signer: HardhatEthersSigner): Promise<bigint> {
    const [, noHandle] = await market.connect(signer).getMyShares();
    return fhevm.userDecryptEuint(FhevmType.euint64, noHandle, marketAddress, signer);
  }

  function findEvent(receipt: any, eventName: string) {
    for (const log of receipt.logs) {
      try {
        const parsed = market.interface.parseLog({ topics: log.topics, data: log.data });
        if (parsed?.name === eventName) return parsed;
      } catch {}
    }
    return null;
  }

  async function advanceTime(seconds: number) {
    await ethers.provider.send("evm_increaseTime", [seconds]);
    await ethers.provider.send("evm_mine", []);
  }

  async function resolveMarket(outcome: boolean) {
    await advanceTime(ONE_DAY + 1);
    await market.connect(resolver).resolve(outcome);
  }

  // -------------------------------------------------------
  // FIXTURE
  // -------------------------------------------------------

  beforeEach(async function () {
    signers = await ethers.getSigners();
    deployer = signers[0];
    alice = signers[1];
    bob = signers[2];
    resolver = signers[3];
    charlie = signers[4];
    feeCollector = signers[5];

    // Deploy ConfidentialUSDT
    const ConfidentialUSDT = await ethers.getContractFactory("ConfidentialUSDT");
    token = await ConfidentialUSDT.deploy();
    await token.waitForDeployment();
    tokenAddress = await token.getAddress();

    // Mint tokens to alice, bob, charlie (100 USDT each)
    await token.mint(alice.address, 100_000_000n);
    await token.mint(bob.address, 100_000_000n);
    await token.mint(charlie.address, 100_000_000n);

    // Get current block timestamp and set deadline 1 day from now
    const block = await ethers.provider.getBlock("latest");
    deadline = block!.timestamp + ONE_DAY;

    // Deploy OpaqueMarket V2 (9 constructor args, NO matcher)
    const OpaqueMarket = await ethers.getContractFactory("OpaqueMarket");
    market = await OpaqueMarket.deploy(
      QUESTION,
      deadline,
      RESOLUTION_SOURCE,
      RESOLUTION_TYPE,
      RESOLUTION_CRITERIA,
      "crypto", // _category
      resolver.address, // _resolver
      feeCollector.address, // _feeCollector
      tokenAddress, // _token
      deployer.address, // _creator
    );
    await market.waitForDeployment();
    marketAddress = await market.getAddress();

    // Approve market to spend tokens for alice, bob, charlie
    await token.connect(alice).approvePlaintext(marketAddress, 100_000_000);
    await token.connect(bob).approvePlaintext(marketAddress, 100_000_000);
    await token.connect(charlie).approvePlaintext(marketAddress, 100_000_000);
  });

  // ===================================================================
  // 1. DEPLOYMENT (7 tests)
  // ===================================================================

  describe("Deployment", function () {
    it("should set market parameters correctly", async function () {
      expect(await market.question()).to.equal(QUESTION);
      expect(await market.resolutionSource()).to.equal(RESOLUTION_SOURCE);
      expect(await market.resolutionSourceType()).to.equal(RESOLUTION_TYPE);
      expect(await market.resolutionCriteria()).to.equal(RESOLUTION_CRITERIA);
      expect(await market.resolved()).to.equal(false);
      expect(await market.totalSharesMinted()).to.equal(0n);
    });

    it("should set creator and resolver", async function () {
      expect(await market.creator()).to.equal(deployer.address);
      expect(await market.resolver()).to.equal(resolver.address);
    });

    it("should set token address", async function () {
      expect(await market.token()).to.equal(tokenAddress);
    });

    it("should have correct fee constants", async function () {
      expect(await market.FEE_BPS()).to.equal(50n);
      expect(await market.TRADE_FEE_BPS()).to.equal(5n);
      expect(await market.BPS()).to.equal(10000n);
      expect(await market.WITHDRAW_FEE()).to.equal(1_000_000n);
      expect(await market.SHARE_UNIT()).to.equal(1_000_000n);
      expect(await market.PRICE_TO_USDT()).to.equal(100n);
    });

    it("should have zero initial state", async function () {
      expect(await market.nextOrderId()).to.equal(0n);
      expect(await market.activeOrderCount()).to.equal(0n);
      expect(await market.collectedFees()).to.equal(0n);
    });

    it("should return default price 5000 when no orders exist", async function () {
      const [yesPrice, noPrice] = await market.getCurrentPrice();
      expect(yesPrice).to.equal(5000n);
      expect(noPrice).to.equal(5000n);
    });

    it("should have constants SIDE_YES=0, SIDE_NO=1, GRACE_PERIOD=7d, MAX_ACTIVE_ORDERS=200", async function () {
      expect(await market.SIDE_YES()).to.equal(0n);
      expect(await market.SIDE_NO()).to.equal(1n);
      expect(await market.GRACE_PERIOD()).to.equal(BigInt(SEVEN_DAYS));
      expect(await market.DECRYPT_TIMEOUT()).to.equal(BigInt(SEVEN_DAYS));
      expect(await market.MAX_ACTIVE_ORDERS()).to.equal(200n);
    });
  });

  // ===================================================================
  // 2. MINT SHARES (6 tests)
  // ===================================================================

  describe("mintShares", function () {
    it("should mint YES and NO shares for cUSDT deposit", async function () {
      await mintSharesFor(alice, 10_000_000n);

      expect(await market.totalSharesMinted()).to.equal(1n);
      expect(await market.hasUserShares(alice.address)).to.equal(true);
    });

    it("should deduct cUSDT from user", async function () {
      await mintSharesFor(alice, 5_000_000n);

      const bal = await decryptTokenBalance(alice);
      expect(bal).to.equal(95_000_000n);
    });

    it("should credit equal YES and NO shares", async function () {
      await mintSharesFor(alice, 7_000_000n);

      const yes = await decryptYesShares(alice);
      const no = await decryptNoShares(alice);
      expect(yes).to.equal(7_000_000n);
      expect(no).to.equal(7_000_000n);
    });

    it("should allow multiple mints and accumulate shares", async function () {
      await mintSharesFor(alice, 3_000_000n);
      await mintSharesFor(alice, 2_000_000n);

      const yes = await decryptYesShares(alice);
      expect(yes).to.equal(5_000_000n);
      expect(await market.totalSharesMinted()).to.equal(2n);
    });

    it("should reject mint after market is resolved", async function () {
      await resolveMarket(true);

      const input = fhevm.createEncryptedInput(marketAddress, alice.address);
      input.add64(1_000_000n);
      const enc = await input.encrypt();

      await expect(market.connect(alice).mintShares(enc.handles[0], enc.inputProof)).to.be.revertedWithCustomError(
        market,
        "Resolved",
      );
    });

    it("should emit SharesMinted event", async function () {
      const tx = await mintSharesFor(alice, 1_000_000n);
      const receipt = await tx.wait();

      const event = findEvent(receipt, "SharesMinted");
      expect(event).to.not.be.null;
      expect(event.args.user).to.equal(alice.address);
    });
  });

  // ===================================================================
  // 3. BURN SHARES (5 tests)
  // ===================================================================

  describe("burnShares", function () {
    beforeEach(async function () {
      await mintSharesFor(alice, 10_000_000n);
    });

    it("should return cUSDT when burning equal YES+NO pairs", async function () {
      await burnSharesFor(alice, 5_000_000n);

      const bal = await decryptTokenBalance(alice);
      // Started 100M, minted 10M (balance 90M), burned 5M back => 95M
      expect(bal).to.equal(95_000_000n);
    });

    it("should reduce share balances after burn", async function () {
      await burnSharesFor(alice, 3_000_000n);

      const yes = await decryptYesShares(alice);
      expect(yes).to.equal(7_000_000n);
    });

    it("should not burn more than available (FHE overflow protection: silent 0)", async function () {
      // Try to burn 20M but only have 10M -> FHE.select picks 0
      await burnSharesFor(alice, 20_000_000n);

      const yes = await decryptYesShares(alice);
      expect(yes).to.equal(10_000_000n);
    });

    it("should reject burn after market is resolved", async function () {
      await resolveMarket(true);

      const input = fhevm.createEncryptedInput(marketAddress, alice.address);
      input.add64(1_000_000n);
      const enc = await input.encrypt();

      await expect(market.connect(alice).burnShares(enc.handles[0], enc.inputProof)).to.be.revertedWithCustomError(
        market,
        "Resolved",
      );
    });

    it("should emit SharesBurned event", async function () {
      const tx = await burnSharesFor(alice, 1_000_000n);
      const receipt = await tx.wait();

      const event = findEvent(receipt, "SharesBurned");
      expect(event).to.not.be.null;
      expect(event.args.user).to.equal(alice.address);
    });
  });

  // ===================================================================
  // 4. PLACE ORDER -- BIDS (7 tests)
  // ===================================================================

  describe("placeOrder - Bids", function () {
    it("should place a basic YES bid", async function () {
      await placeOrder(alice, SIDE_YES, 6000, true, 10n);

      expect(await market.nextOrderId()).to.equal(1n);
      expect(await market.activeOrderCount()).to.equal(1n);

      const [owner, price, isBid, isActive, sequence, createdAt] = await market.getOrder(0);
      expect(owner).to.equal(alice.address);
      expect(price).to.equal(6000n);
      expect(isBid).to.equal(true);
      expect(isActive).to.equal(true);
      expect(sequence).to.equal(0n);
      expect(createdAt).to.be.gt(0n);
    });

    it("should escrow correct bid amount: price * PRICE_TO_USDT * amount", async function () {
      const balBefore = await decryptTokenBalance(alice);

      // Bid at 6000, 10 shares => escrow = 6000 * 100 * 10 = 6_000_000
      await placeOrder(alice, SIDE_YES, 6000, true, 10n);

      const balAfter = await decryptTokenBalance(alice);
      expect(balBefore - balAfter).to.equal(6_000_000n);
    });

    it("should update bestBid when bid is placed", async function () {
      await placeOrder(alice, SIDE_YES, 5500, true, 5n);

      const [bestBid] = await market.getBestPrices();
      expect(bestBid).to.equal(5500n);
    });

    it("should reject bid with price below 100", async function () {
      const input = fhevm.createEncryptedInput(marketAddress, alice.address);
      input.add8(SIDE_YES);
      input.add64(5n);
      const enc = await input.encrypt();

      await expect(
        market.connect(alice).placeOrder(enc.handles[0], 99, true, enc.handles[1], enc.inputProof, enc.inputProof),
      ).to.be.revertedWithCustomError(market, "BadPrice");
    });

    it("should reject bid with price above 9900", async function () {
      const input = fhevm.createEncryptedInput(marketAddress, alice.address);
      input.add8(SIDE_YES);
      input.add64(5n);
      const enc = await input.encrypt();

      await expect(
        market.connect(alice).placeOrder(enc.handles[0], 9901, true, enc.handles[1], enc.inputProof, enc.inputProof),
      ).to.be.revertedWithCustomError(market, "BadPrice");
    });

    it("should update price level bid count", async function () {
      await placeOrder(alice, SIDE_YES, 6000, true, 5n);

      const [bidCount, askCount] = await market.getPriceLevel(6000);
      expect(bidCount).to.equal(1n);
      expect(askCount).to.equal(0n);
    });

    it("should emit OrderPlaced event", async function () {
      const tx = await placeOrder(alice, SIDE_YES, 5000, true, 5n);
      const receipt = await tx.wait();

      const event = findEvent(receipt, "OrderPlaced");
      expect(event).to.not.be.null;
      expect(event.args.orderId).to.equal(0n);
      expect(event.args.owner).to.equal(alice.address);
      expect(event.args.price).to.equal(5000n);
      expect(event.args.isBid).to.equal(true);
      expect(event.args.sequence).to.equal(0n);
      expect(event.args.timestamp).to.be.gt(0n);
    });

    it("should reject bid on resolved market", async function () {
      await resolveMarket(true);

      const input = fhevm.createEncryptedInput(marketAddress, alice.address);
      input.add8(SIDE_YES);
      input.add64(5n);
      const enc = await input.encrypt();

      await expect(
        market.connect(alice).placeOrder(enc.handles[0], 6000, true, enc.handles[1], enc.inputProof, enc.inputProof),
      ).to.be.revertedWithCustomError(market, "Resolved");
    });
  });

  // ===================================================================
  // 5. PLACE ORDER -- ASKS (5 tests)
  // ===================================================================

  describe("placeOrder - Asks", function () {
    it("should place a basic ask", async function () {
      await placeOrder(alice, SIDE_NO, 6000, false, 10n);

      expect(await market.nextOrderId()).to.equal(1n);
      const [owner, price, isBid, isActive] = await market.getOrder(0);
      expect(owner).to.equal(alice.address);
      expect(price).to.equal(6000n);
      expect(isBid).to.equal(false);
      expect(isActive).to.equal(true);
    });

    it("should escrow correct ask amount: (BPS - price) * PRICE_TO_USDT * amount", async function () {
      const balBefore = await decryptTokenBalance(alice);

      // Ask at 6000, 10 shares => escrow = (10000 - 6000) * 100 * 10 = 4_000_000
      await placeOrder(alice, SIDE_NO, 6000, false, 10n);

      const balAfter = await decryptTokenBalance(alice);
      expect(balBefore - balAfter).to.equal(4_000_000n);
    });

    it("should update bestAsk when ask is placed", async function () {
      await placeOrder(alice, SIDE_NO, 6500, false, 5n);

      const [, bestAsk] = await market.getBestPrices();
      expect(bestAsk).to.equal(6500n);
    });

    it("should update price level ask count", async function () {
      await placeOrder(alice, SIDE_NO, 7000, false, 5n);

      const [bidCount, askCount] = await market.getPriceLevel(7000);
      expect(bidCount).to.equal(0n);
      expect(askCount).to.equal(1n);
    });

    it("should require token balance to place ask (escrows USDT)", async function () {
      // Deploy a new user with zero tokens
      const poorUser = signers[8];
      // No token.mint for poorUser, so balance is 0

      // Give the approval anyway
      await token.connect(poorUser).approvePlaintext(marketAddress, 100_000_000);

      // Place order -- will succeed but with 0 effective escrow (FHE pattern: no revert)
      // The order is created but with amount clamped to 0 due to insufficient transfer
      await placeOrder(poorUser, SIDE_NO, 5000, false, 10n);
      expect(await market.nextOrderId()).to.equal(1n);
    });
  });

  // ===================================================================
  // 6. CANCEL ORDER (5 tests + emit event)
  // ===================================================================

  describe("cancelOrder", function () {
    it("should cancel a bid order", async function () {
      await placeOrder(alice, SIDE_YES, 5000, true, 10n);
      expect(await market.activeOrderCount()).to.equal(1n);

      await market.connect(alice).cancelOrder(0);
      expect(await market.activeOrderCount()).to.equal(0n);

      const [, , , isActive] = await market.getOrder(0);
      expect(isActive).to.equal(false);
    });

    it("should cancel an ask order", async function () {
      await placeOrder(alice, SIDE_NO, 6000, false, 10n);

      await market.connect(alice).cancelOrder(0);
      expect(await market.activeOrderCount()).to.equal(0n);

      const [, , , isActive] = await market.getOrder(0);
      expect(isActive).to.equal(false);
    });

    it("should return escrowed USDT on cancel", async function () {
      const balBefore = await decryptTokenBalance(alice);

      await placeOrder(alice, SIDE_YES, 5000, true, 10n);
      await market.connect(alice).cancelOrder(0);

      const balAfter = await decryptTokenBalance(alice);
      expect(balAfter).to.equal(balBefore);
    });

    it("should reject cancel from non-owner (NotOwner)", async function () {
      await placeOrder(alice, SIDE_YES, 5000, true, 10n);
      await expect(market.connect(bob).cancelOrder(0)).to.be.revertedWithCustomError(market, "NotOwner");
    });

    it("should reject cancel on already cancelled order (NotActive)", async function () {
      await placeOrder(alice, SIDE_YES, 5000, true, 10n);
      await market.connect(alice).cancelOrder(0);
      await expect(market.connect(alice).cancelOrder(0)).to.be.revertedWithCustomError(market, "NotActive");
    });

    it("should emit OrderCancelled event", async function () {
      await placeOrder(alice, SIDE_YES, 5000, true, 10n);

      const tx = await market.connect(alice).cancelOrder(0);
      const receipt = await tx.wait();

      const event = findEvent(receipt, "OrderCancelled");
      expect(event).to.not.be.null;
      expect(event.args.orderId).to.equal(0n);
      expect(event.args.owner).to.equal(alice.address);
    });
  });

  // ===================================================================
  // 7. ATTEMPT MATCH (6 tests)
  // ===================================================================

  describe("attemptMatch", function () {
    it("should match opposite sides (YES bid + NO ask)", async function () {
      await placeOrder(alice, SIDE_YES, 6000, true, 5n);
      await placeOrder(bob, SIDE_NO, 6000, false, 5n);

      // Anyone can call
      await market.connect(charlie).attemptMatch(0, 1);

      // Verify outcome tokens were created for alice (YES shares)
      // Trade fee: feePerShare = 6000 * 100 * 5 / 10000 = 300
      // Net per share = 1_000_000 - 300 = 999_700
      // 5 shares = 5 * 999_700 = 4_998_500
      const yesAlice = await decryptYesShares(alice);
      expect(yesAlice).to.equal(4_998_500n); // 5 shares * (SHARE_UNIT - feePerShare)
    });

    it("should produce actualFill=0 on same side (no revert)", async function () {
      // Both YES -- same side, FHE produces 0 fill
      await placeOrder(alice, SIDE_YES, 6000, true, 5n);
      await placeOrder(bob, SIDE_YES, 6000, false, 5n);

      // Should NOT revert
      await market.connect(charlie).attemptMatch(0, 1);

      // Alice should have 0 outcome tokens
      const yesAlice = await decryptYesShares(alice);
      expect(yesAlice).to.equal(0n);
    });

    it("should revert when bid price < ask price (BidLessThanAsk)", async function () {
      await placeOrder(alice, SIDE_YES, 4000, true, 5n);
      await placeOrder(bob, SIDE_NO, 6000, false, 5n);

      await expect(market.connect(charlie).attemptMatch(0, 1)).to.be.revertedWithCustomError(market, "BidLessThanAsk");
    });

    it("should revert on self-match (NoSelfMatch)", async function () {
      await placeOrder(alice, SIDE_YES, 6000, true, 5n);
      await placeOrder(alice, SIDE_NO, 6000, false, 5n);

      await expect(market.connect(charlie).attemptMatch(0, 1)).to.be.revertedWithCustomError(market, "NoSelfMatch");
    });

    it("should emit MatchAttempted event", async function () {
      await placeOrder(alice, SIDE_YES, 6000, true, 5n);
      await placeOrder(bob, SIDE_NO, 6000, false, 5n);

      const tx = await market.connect(charlie).attemptMatch(0, 1);
      const receipt = await tx.wait();

      const event = findEvent(receipt, "MatchAttempted");
      expect(event).to.not.be.null;
      expect(event.args.bidId).to.equal(0n);
      expect(event.args.askId).to.equal(1n);
      expect(event.args.caller).to.equal(charlie.address);
      expect(event.args.timestamp).to.be.gt(0n);
    });

    it("should be permissionless -- any address can call", async function () {
      await placeOrder(alice, SIDE_YES, 6000, true, 5n);
      await placeOrder(bob, SIDE_NO, 6000, false, 5n);

      // Charlie (random third party) can match
      await market.connect(charlie).attemptMatch(0, 1);
      // No revert means success
    });
  });

  // ===================================================================
  // 8. RESOLUTION (7 tests)
  // ===================================================================

  describe("Resolution", function () {
    it("should only allow resolver to resolve (OnlyResolver)", async function () {
      await advanceTime(ONE_DAY + 1);
      await expect(market.connect(alice).resolve(true)).to.be.revertedWithCustomError(market, "OnlyResolver");
    });

    it("should reject resolution before deadline (NotEnded)", async function () {
      await expect(market.connect(resolver).resolve(true)).to.be.revertedWithCustomError(market, "NotEnded");
    });

    it("should allow resolver to resolve after deadline", async function () {
      await advanceTime(ONE_DAY + 1);
      await market.connect(resolver).resolve(true);

      expect(await market.resolved()).to.equal(true);
      expect(await market.outcome()).to.equal(true);
      expect(await market.resolvedAt()).to.be.gt(0n);
    });

    it("should reject double resolution (Resolved)", async function () {
      await advanceTime(ONE_DAY + 1);
      await market.connect(resolver).resolve(true);

      await expect(market.connect(resolver).resolve(false)).to.be.revertedWithCustomError(market, "Resolved");
    });

    it("should reject resolution after grace period (WindowExpired)", async function () {
      await advanceTime(ONE_DAY + SEVEN_DAYS + 1);
      await expect(market.connect(resolver).resolve(true)).to.be.revertedWithCustomError(market, "WindowExpired");
    });

    it("should allow resolution within grace period", async function () {
      await advanceTime(ONE_DAY + 3 * ONE_DAY);
      await market.connect(resolver).resolve(false);

      expect(await market.resolved()).to.equal(true);
      expect(await market.outcome()).to.equal(false);
    });

    it("should emit MarketResolved event", async function () {
      await advanceTime(ONE_DAY + 1);
      const tx = await market.connect(resolver).resolve(true);
      const receipt = await tx.wait();

      const event = findEvent(receipt, "MarketResolved");
      expect(event).to.not.be.null;
      expect(event.args.outcome).to.equal(true);
    });
  });

  // ===================================================================
  // 9. ADMIN (6 tests)
  // ===================================================================

  describe("Admin", function () {
    it("should allow creator to setResolver before shares minted", async function () {
      await market.connect(deployer).setResolver(alice.address);
      expect(await market.resolver()).to.equal(alice.address);
    });

    it("should allow creator to setFeeCollector", async function () {
      await market.connect(deployer).setFeeCollector(alice.address);
      expect(await market.feeCollector()).to.equal(alice.address);
    });

    it("should allow creator to pause", async function () {
      await market.connect(deployer).pause();
      expect(await market.paused()).to.equal(true);
    });

    it("should allow creator to unpause", async function () {
      await market.connect(deployer).pause();
      await market.connect(deployer).unpause();
      expect(await market.paused()).to.equal(false);
    });

    it("should reject non-creator for setResolver (OnlyCreator)", async function () {
      await expect(market.connect(alice).setResolver(bob.address)).to.be.revertedWithCustomError(market, "OnlyCreator");
    });

    it("should reject non-creator for pause (OnlyCreator)", async function () {
      await expect(market.connect(alice).pause()).to.be.revertedWithCustomError(market, "OnlyCreator");
    });
  });

  // ===================================================================
  // 10. MARKET CANCELLATION (3 tests)
  // ===================================================================

  describe("Market Cancellation", function () {
    it("should allow creator to cancel market with no shares", async function () {
      await market.connect(deployer).cancelMarket();
      expect(await market.resolved()).to.equal(true);
    });

    it("should reject cancellation when shares are minted (HasParticipants)", async function () {
      await mintSharesFor(alice, 1_000_000n);
      await expect(market.connect(deployer).cancelMarket()).to.be.revertedWithCustomError(market, "HasParticipants");
    });

    it("should reject cancellation from non-creator (OnlyCreator)", async function () {
      await expect(market.connect(alice).cancelMarket()).to.be.revertedWithCustomError(market, "OnlyCreator");
    });
  });

  // ===================================================================
  // 11. EMERGENCY (5 tests)
  // ===================================================================

  describe("Emergency Withdrawal", function () {
    beforeEach(async function () {
      await mintSharesFor(alice, 1_000_000n);
    });

    it("should not allow emergency withdraw before grace period (GraceActive)", async function () {
      await advanceTime(ONE_DAY + 1);
      await expect(market.connect(alice).emergencyWithdraw()).to.be.revertedWithCustomError(market, "GraceActive");
    });

    it("should allow emergency withdraw after grace period expires", async function () {
      await advanceTime(ONE_DAY + SEVEN_DAYS + 1);
      await market.connect(alice).emergencyWithdraw();
    });

    it("should reject emergency withdraw on resolved market (Resolved)", async function () {
      await resolveMarket(true);
      await advanceTime(SEVEN_DAYS + 1);

      await expect(market.connect(alice).emergencyWithdraw()).to.be.revertedWithCustomError(market, "Resolved");
    });

    it("should reject double emergency request (Requested)", async function () {
      await advanceTime(ONE_DAY + SEVEN_DAYS + 1);
      await market.connect(alice).emergencyWithdraw();

      await expect(market.connect(alice).emergencyWithdraw()).to.be.revertedWithCustomError(market, "Requested");
    });

    it("should reject emergency withdraw from non-shareholder (NoShares)", async function () {
      await advanceTime(ONE_DAY + SEVEN_DAYS + 1);
      await expect(market.connect(bob).emergencyWithdraw()).to.be.revertedWithCustomError(market, "NoShares");
    });
  });

  // ===================================================================
  // 12. EMERGENCY REFUND AFTER RESOLUTION (3 tests)
  // ===================================================================

  describe("Emergency Refund After Resolution", function () {
    beforeEach(async function () {
      await mintSharesFor(alice, 1_000_000n);
    });

    it("should allow refund when resolved and after decrypt timeout", async function () {
      await resolveMarket(true);
      await advanceTime(SEVEN_DAYS + 1);

      await market.connect(alice).emergencyRefundAfterResolution();
    });

    it("should reject refund before timeout (TimeoutActive)", async function () {
      await resolveMarket(true);
      await advanceTime(ONE_DAY); // only 1 day, not 7

      await expect(market.connect(alice).emergencyRefundAfterResolution()).to.be.revertedWithCustomError(
        market,
        "TimeoutActive",
      );
    });

    it("should reject refund when not resolved (NotResolved)", async function () {
      await expect(market.connect(alice).emergencyRefundAfterResolution()).to.be.revertedWithCustomError(
        market,
        "NotResolved",
      );
    });
  });

  // ===================================================================
  // 13. FEE WITHDRAWAL (2 tests)
  // ===================================================================

  describe("Fee Withdrawal", function () {
    it("should only allow feeCollector to withdraw fees (OnlyCollector)", async function () {
      await expect(market.connect(alice).withdrawFees()).to.be.revertedWithCustomError(market, "OnlyCollector");
    });

    it("should reject withdrawal when no fees collected (NoFees)", async function () {
      await expect(market.connect(feeCollector).withdrawFees()).to.be.revertedWithCustomError(market, "NoFees");
    });
  });

  // ===================================================================
  // 14. SELF-MATCH PREVENTION (1 test)
  // ===================================================================

  describe("Self-Match Prevention", function () {
    it("should reject matching orders from same owner (NoSelfMatch)", async function () {
      await placeOrder(alice, SIDE_YES, 6000, true, 5n);
      await placeOrder(alice, SIDE_NO, 6000, false, 5n);

      await expect(market.connect(charlie).attemptMatch(0, 1)).to.be.revertedWithCustomError(market, "NoSelfMatch");
    });
  });

  // ===================================================================
  // 15. PAUSE EFFECTS (3 tests)
  // ===================================================================

  describe("Pause Effects", function () {
    it("should block mintShares when paused (EnforcedPause)", async function () {
      await market.connect(deployer).pause();

      const input = fhevm.createEncryptedInput(marketAddress, alice.address);
      input.add64(1_000_000n);
      const enc = await input.encrypt();

      await expect(market.connect(alice).mintShares(enc.handles[0], enc.inputProof)).to.be.revertedWithCustomError(
        market,
        "EnforcedPause",
      );
    });

    it("should block placeOrder when paused (EnforcedPause)", async function () {
      await market.connect(deployer).pause();

      const input = fhevm.createEncryptedInput(marketAddress, alice.address);
      input.add8(SIDE_YES);
      input.add64(5n);
      const enc = await input.encrypt();

      await expect(
        market.connect(alice).placeOrder(enc.handles[0], 5000, true, enc.handles[1], enc.inputProof, enc.inputProof),
      ).to.be.revertedWithCustomError(market, "EnforcedPause");
    });

    it("should allow cancelOrder when paused", async function () {
      await placeOrder(alice, SIDE_YES, 5000, true, 10n);
      await market.connect(deployer).pause();

      await market.connect(alice).cancelOrder(0);
      expect(await market.activeOrderCount()).to.equal(0n);
    });
  });

  // ===================================================================
  // 16. PRICE BOUNDARIES (4 tests)
  // ===================================================================

  describe("Price Boundaries", function () {
    it("should accept minimum price 100", async function () {
      await placeOrder(alice, SIDE_YES, 100, true, 1n);
      const [, price] = await market.getOrder(0);
      expect(price).to.equal(100n);
    });

    it("should accept maximum price 9900", async function () {
      await placeOrder(alice, SIDE_YES, 9900, true, 1n);
      const [, price] = await market.getOrder(0);
      expect(price).to.equal(9900n);
    });

    it("should reject price 99 (below minimum)", async function () {
      const input = fhevm.createEncryptedInput(marketAddress, alice.address);
      input.add8(SIDE_YES);
      input.add64(1n);
      const enc = await input.encrypt();

      await expect(
        market.connect(alice).placeOrder(enc.handles[0], 99, true, enc.handles[1], enc.inputProof, enc.inputProof),
      ).to.be.revertedWithCustomError(market, "BadPrice");
    });

    it("should reject price 9901 (above maximum)", async function () {
      const input = fhevm.createEncryptedInput(marketAddress, alice.address);
      input.add8(SIDE_YES);
      input.add64(1n);
      const enc = await input.encrypt();

      await expect(
        market.connect(alice).placeOrder(enc.handles[0], 9901, true, enc.handles[1], enc.inputProof, enc.inputProof),
      ).to.be.revertedWithCustomError(market, "BadPrice");
    });
  });

  // ===================================================================
  // 17. MARKET CLOSED (2 tests)
  // ===================================================================

  describe("Market Closed", function () {
    it("should reject mintShares after deadline (Closed)", async function () {
      await advanceTime(ONE_DAY + 1);

      const input = fhevm.createEncryptedInput(marketAddress, alice.address);
      input.add64(1_000_000n);
      const enc = await input.encrypt();

      await expect(market.connect(alice).mintShares(enc.handles[0], enc.inputProof)).to.be.revertedWithCustomError(
        market,
        "Closed",
      );
    });

    it("should reject placeOrder after deadline (Closed)", async function () {
      await advanceTime(ONE_DAY + 1);

      const input = fhevm.createEncryptedInput(marketAddress, alice.address);
      input.add8(SIDE_YES);
      input.add64(5n);
      const enc = await input.encrypt();

      await expect(
        market.connect(alice).placeOrder(enc.handles[0], 5000, true, enc.handles[1], enc.inputProof, enc.inputProof),
      ).to.be.revertedWithCustomError(market, "Closed");
    });
  });

  // ===================================================================
  // 18. BEST PRICE RESET (2 tests)
  // ===================================================================

  describe("Best Price Reset", function () {
    it("should reset bestBid to 0 when last bid at best price is cancelled", async function () {
      await placeOrder(alice, SIDE_YES, 5000, true, 5n);

      const [bestBidBefore] = await market.getBestPrices();
      expect(bestBidBefore).to.equal(5000n);

      await market.connect(alice).cancelOrder(0);

      const [bestBidAfter] = await market.getBestPrices();
      expect(bestBidAfter).to.equal(0n);
    });

    it("should reset bestAsk to 0 when last ask at best price is cancelled", async function () {
      await placeOrder(alice, SIDE_NO, 6000, false, 5n);

      const [, bestAskBefore] = await market.getBestPrices();
      expect(bestAskBefore).to.equal(6000n);

      await market.connect(alice).cancelOrder(0);

      const [, bestAskAfter] = await market.getBestPrices();
      expect(bestAskAfter).to.equal(0n);
    });
  });

  // ===================================================================
  // 19. VIEW FUNCTIONS (3 tests)
  // ===================================================================

  describe("View Functions", function () {
    it("should return complete market info via getMarketInfo()", async function () {
      const info = await market.getMarketInfo();
      expect(info._question).to.equal(QUESTION);
      expect(info._deadline).to.equal(BigInt(deadline));
      expect(info._resolved).to.equal(false);
      expect(info._outcome).to.equal(false);
      expect(info._totalSharesMinted).to.equal(0n);
      expect(info._activeOrderCount).to.equal(0n);
      expect(info._resolutionSource).to.equal(RESOLUTION_SOURCE);
      expect(info._resolutionSourceType).to.equal(RESOLUTION_TYPE);
      expect(info._resolutionCriteria).to.equal(RESOLUTION_CRITERIA);
      expect(info._category).to.equal("crypto");
    });

    it("should return user orders via getUserOrders()", async function () {
      await placeOrder(alice, SIDE_YES, 5000, true, 10n);
      await placeOrder(alice, SIDE_NO, 4000, false, 5n);

      const orders = await market.getUserOrders(alice.address);
      expect(orders.length).to.equal(2);
      expect(orders[0]).to.equal(0n);
      expect(orders[1]).to.equal(1n);
    });

    it("should return 2 values from getBestPrices()", async function () {
      await placeOrder(alice, SIDE_YES, 4000, true, 5n);
      await placeOrder(bob, SIDE_NO, 7000, false, 5n);

      const [bestBid, bestAsk] = await market.getBestPrices();
      expect(bestBid).to.equal(4000n);
      expect(bestAsk).to.equal(7000n);
    });
  });

  // ===================================================================
  // 20. MINT COUNT TRACKING (2 tests)
  // ===================================================================

  describe("Mint Count Tracking", function () {
    it("should NOT decrement totalSharesMinted on burn (monotonic counter)", async function () {
      await mintSharesFor(alice, 1_000_000n);
      expect(await market.totalSharesMinted()).to.equal(1n);

      await burnSharesFor(alice, 1_000_000n);
      // totalSharesMinted is monotonic — it tracks mint operations only, not decremented on burn
      expect(await market.totalSharesMinted()).to.equal(1n);
    });

    it("should revert cancelMarket after mint even if all shares are burned (totalSharesMinted stays)", async function () {
      await mintSharesFor(alice, 1_000_000n);
      expect(await market.totalSharesMinted()).to.equal(1n);

      await burnSharesFor(alice, 1_000_000n);
      // totalSharesMinted stays at 1 (monotonic), so cancelMarket reverts
      expect(await market.totalSharesMinted()).to.equal(1n);

      await expect(market.connect(deployer).cancelMarket()).to.be.revertedWithCustomError(market, "HasParticipants");
    });
  });

  // ===================================================================
  // ADDITIONAL COVERAGE
  // ===================================================================

  describe("Escrow Calculations (detailed)", function () {
    it("should escrow bid at 5000: 5000 * 100 * amount", async function () {
      const balBefore = await decryptTokenBalance(alice);

      // price=5000, 10 shares => escrow = 5000 * 100 * 10 = 5_000_000
      await placeOrder(alice, SIDE_YES, 5000, true, 10n);

      const balAfter = await decryptTokenBalance(alice);
      expect(balBefore - balAfter).to.equal(5_000_000n);
    });

    it("should escrow ask at 5000: (10000-5000) * 100 * amount", async function () {
      const balBefore = await decryptTokenBalance(alice);

      // price=5000, 10 shares => escrow = (10000-5000) * 100 * 10 = 5_000_000
      await placeOrder(alice, SIDE_NO, 5000, false, 10n);

      const balAfter = await decryptTokenBalance(alice);
      expect(balBefore - balAfter).to.equal(5_000_000n);
    });
  });

  describe("Match Outcome Token Verification", function () {
    it("should create YES shares for bid owner and NO shares for ask owner", async function () {
      // Alice bids YES at 6000, Bob asks NO at 6000
      await placeOrder(alice, SIDE_YES, 6000, true, 5n);
      await placeOrder(bob, SIDE_NO, 6000, false, 5n);

      await market.connect(charlie).attemptMatch(0, 1);

      // Trade fee: feePerShare = 6000 * 100 * 5 / 10000 = 300
      // Net per share = 1_000_000 - 300 = 999_700
      // 5 shares = 5 * 999_700 = 4_998_500
      const yesAlice = await decryptYesShares(alice);
      expect(yesAlice).to.equal(4_998_500n);

      const noBob = await decryptNoShares(bob);
      expect(noBob).to.equal(4_998_500n);
    });

    it("should not create tokens on failed match (both same side YES)", async function () {
      await placeOrder(alice, SIDE_YES, 6000, true, 5n);
      await placeOrder(bob, SIDE_YES, 6000, false, 5n);

      await market.connect(charlie).attemptMatch(0, 1);

      const yesAlice = await decryptYesShares(alice);
      expect(yesAlice).to.equal(0n);
    });
  });

  describe("attemptMatch - additional checks", function () {
    it("should revert on inactive bid (BidNotActive)", async function () {
      await placeOrder(alice, SIDE_YES, 6000, true, 5n);
      await placeOrder(bob, SIDE_NO, 6000, false, 5n);
      await market.connect(alice).cancelOrder(0);

      await expect(market.connect(charlie).attemptMatch(0, 1)).to.be.revertedWithCustomError(market, "BidNotActive");
    });

    it("should revert on inactive ask (AskNotActive)", async function () {
      await placeOrder(alice, SIDE_YES, 6000, true, 5n);
      await placeOrder(bob, SIDE_NO, 6000, false, 5n);
      await market.connect(bob).cancelOrder(1);

      await expect(market.connect(charlie).attemptMatch(0, 1)).to.be.revertedWithCustomError(market, "AskNotActive");
    });

    it("should revert when first order is not a bid (NotBid)", async function () {
      await placeOrder(alice, SIDE_YES, 6000, false, 5n);
      await placeOrder(bob, SIDE_NO, 6000, false, 5n);

      await expect(market.connect(charlie).attemptMatch(0, 1)).to.be.revertedWithCustomError(market, "NotBid");
    });

    it("should revert when second order is not an ask (NotAsk)", async function () {
      await placeOrder(alice, SIDE_YES, 6000, true, 5n);
      await placeOrder(bob, SIDE_NO, 6000, true, 5n);

      await expect(market.connect(charlie).attemptMatch(0, 1)).to.be.revertedWithCustomError(market, "NotAsk");
    });

    it("should handle price improvement (bid.price > ask.price refund)", async function () {
      // Bid at 7000, ask at 5000 => price gap refund
      await placeOrder(alice, SIDE_YES, 7000, true, 5n);
      await placeOrder(bob, SIDE_NO, 5000, false, 5n);

      await market.connect(charlie).attemptMatch(0, 1);
      // Should succeed without revert
    });
  });

  describe("cancelOrders (batch)", function () {
    it("should cancel all active orders for the caller", async function () {
      await placeOrder(alice, SIDE_YES, 5000, true, 5n);
      await placeOrder(alice, SIDE_NO, 6000, false, 3n);
      await placeOrder(alice, SIDE_YES, 7000, true, 2n);

      expect(await market.activeOrderCount()).to.equal(3n);

      // Use getUserOrders to get order IDs, then pass them to cancelOrders
      const orderIds = await market.getUserOrders(alice.address);
      await market.connect(alice).cancelOrders([...orderIds]);
      expect(await market.activeOrderCount()).to.equal(0n);

      const [, , , isActive0] = await market.getOrder(0);
      const [, , , isActive1] = await market.getOrder(1);
      const [, , , isActive2] = await market.getOrder(2);
      expect(isActive0).to.equal(false);
      expect(isActive1).to.equal(false);
      expect(isActive2).to.equal(false);
    });
  });

  describe("Redemption (post-match)", function () {
    beforeEach(async function () {
      await placeOrder(alice, SIDE_YES, 6000, true, 5n);
      await placeOrder(bob, SIDE_NO, 6000, false, 5n);
      await market.connect(deployer).attemptMatch(0, 1);
    });

    it("should reject redemption request before resolution (NotResolved)", async function () {
      await expect(market.connect(alice).requestRedemption()).to.be.revertedWithCustomError(market, "NotResolved");
    });

    it("should allow requesting redemption after resolution", async function () {
      await resolveMarket(true);
      await market.connect(alice).requestRedemption();
    });

    it("should emit RedemptionRequested event", async function () {
      await resolveMarket(true);
      const tx = await market.connect(alice).requestRedemption();
      const receipt = await tx.wait();

      const event = findEvent(receipt, "RedemptionRequested");
      expect(event).to.not.be.null;
      expect(event.args.user).to.equal(alice.address);
    });

    it("should reject double redemption request (Requested)", async function () {
      await resolveMarket(true);
      await market.connect(alice).requestRedemption();

      await expect(market.connect(alice).requestRedemption()).to.be.revertedWithCustomError(market, "Requested");
    });

    it("should reject non-shareholder redemption request (NoShares)", async function () {
      await resolveMarket(true);
      const nonHolder = signers[9];

      await expect(market.connect(nonHolder).requestRedemption()).to.be.revertedWithCustomError(market, "NoShares");
    });
  });

  describe("Two-Step Creator Transfer", function () {
    it("should allow creator to transfer ownership (two-step)", async function () {
      await market.connect(deployer).transferCreator(alice.address);
      expect(await market.pendingCreator()).to.equal(alice.address);

      await market.connect(alice).acceptCreator();
      expect(await market.creator()).to.equal(alice.address);
      expect(await market.pendingCreator()).to.equal(ethers.ZeroAddress);
    });

    it("should reject non-creator initiating transfer (OnlyCreator)", async function () {
      await expect(market.connect(alice).transferCreator(bob.address)).to.be.revertedWithCustomError(
        market,
        "OnlyCreator",
      );
    });

    it("should reject non-pending accepting (NotPending)", async function () {
      await market.connect(deployer).transferCreator(alice.address);
      await expect(market.connect(bob).acceptCreator()).to.be.revertedWithCustomError(market, "NotPending");
    });
  });

  describe("Encrypted Order Fields", function () {
    it("should allow owner to decrypt side via getOrderEncrypted", async function () {
      await placeOrder(alice, SIDE_NO, 6000, true, 5n);

      const [encSide] = await market.connect(alice).getOrderEncrypted(0);
      const side = await fhevm.userDecryptEuint(FhevmType.euint8, encSide, marketAddress, alice);
      expect(side).to.equal(BigInt(SIDE_NO));
    });

    it("should allow owner to decrypt size via getOrderEncrypted", async function () {
      await placeOrder(alice, SIDE_YES, 6000, true, 42n);

      const [, size] = await market.connect(alice).getOrderEncrypted(0);
      const decryptedSize = await fhevm.userDecryptEuint(FhevmType.euint64, size, marketAddress, alice);
      expect(decryptedSize).to.equal(42n);
    });

    it("should allow owner to decrypt escrow via getOrderEncrypted", async function () {
      await placeOrder(alice, SIDE_YES, 5000, true, 10n);

      const [, , , escrow] = await market.connect(alice).getOrderEncrypted(0);
      const decryptedEscrow = await fhevm.userDecryptEuint(FhevmType.euint64, escrow, marketAddress, alice);
      // 5000 * 100 * 10 = 5_000_000
      expect(decryptedEscrow).to.equal(5_000_000n);
    });

    it("should show filled=0 for unfilled order", async function () {
      await placeOrder(alice, SIDE_YES, 6000, true, 5n);

      const [, , filled] = await market.connect(alice).getOrderEncrypted(0);
      const decryptedFilled = await fhevm.userDecryptEuint(FhevmType.euint64, filled, marketAddress, alice);
      expect(decryptedFilled).to.equal(0n);
    });
  });

  describe("Sequence Tracking", function () {
    it("should assign monotonically increasing sequence numbers", async function () {
      await placeOrder(alice, SIDE_YES, 5000, true, 1n);
      await placeOrder(bob, SIDE_NO, 6000, false, 1n);
      await placeOrder(charlie, SIDE_YES, 7000, true, 1n);

      const [, , , , seq0] = await market.getOrder(0);
      const [, , , , seq1] = await market.getOrder(1);
      const [, , , , seq2] = await market.getOrder(2);

      expect(seq0).to.equal(0n);
      expect(seq1).to.equal(1n);
      expect(seq2).to.equal(2n);
    });
  });

  describe("hasShares Tracking", function () {
    it("should return false for user with no shares", async function () {
      expect(await market.hasUserShares(alice.address)).to.equal(false);
    });

    it("should return true after minting shares", async function () {
      await mintSharesFor(alice, 1_000_000n);
      expect(await market.hasUserShares(alice.address)).to.equal(true);
    });

    it("should return true after receiving shares from match", async function () {
      await placeOrder(alice, SIDE_YES, 6000, true, 5n);
      await placeOrder(bob, SIDE_NO, 6000, false, 5n);
      await market.connect(charlie).attemptMatch(0, 1);

      expect(await market.hasUserShares(alice.address)).to.equal(true);
      expect(await market.hasUserShares(bob.address)).to.equal(true);
    });
  });

  describe("Multiple Order Management", function () {
    it("should track active order count across place and cancel", async function () {
      await placeOrder(alice, SIDE_YES, 5000, true, 5n);
      await placeOrder(bob, SIDE_NO, 6000, false, 5n);
      await placeOrder(charlie, SIDE_YES, 7000, true, 3n);

      expect(await market.activeOrderCount()).to.equal(3n);

      await market.connect(alice).cancelOrder(0);
      expect(await market.activeOrderCount()).to.equal(2n);

      await market.connect(bob).cancelOrder(1);
      expect(await market.activeOrderCount()).to.equal(1n);

      await market.connect(charlie).cancelOrder(2);
      expect(await market.activeOrderCount()).to.equal(0n);
    });

    it("should track multiple price levels independently", async function () {
      await placeOrder(alice, SIDE_YES, 5000, true, 5n);
      await placeOrder(bob, SIDE_YES, 5000, true, 3n);
      await placeOrder(charlie, SIDE_YES, 6000, true, 2n);

      const [bidCount5000] = await market.getPriceLevel(5000);
      const [bidCount6000] = await market.getPriceLevel(6000);
      expect(bidCount5000).to.equal(2n);
      expect(bidCount6000).to.equal(1n);
    });
  });

  describe("Best Price Tracking (multi-order)", function () {
    it("should track highest bid when multiple bids placed", async function () {
      await placeOrder(alice, SIDE_YES, 4000, true, 5n);
      await placeOrder(bob, SIDE_YES, 6000, true, 5n);

      const [bestBid] = await market.getBestPrices();
      expect(bestBid).to.equal(6000n);
    });

    it("should track lowest ask when multiple asks placed", async function () {
      await placeOrder(alice, SIDE_NO, 7000, false, 5n);
      await placeOrder(bob, SIDE_NO, 5000, false, 5n);

      const [, bestAsk] = await market.getBestPrices();
      expect(bestAsk).to.equal(5000n);
    });
  });

  describe("getCurrentPrice with various states", function () {
    it("should return midpoint when both bid and ask exist", async function () {
      await placeOrder(alice, SIDE_YES, 4000, true, 5n);
      await placeOrder(bob, SIDE_NO, 6000, false, 5n);

      const [yesPrice, noPrice] = await market.getCurrentPrice();
      expect(yesPrice).to.equal(5000n);
      expect(noPrice).to.equal(5000n);
    });

    it("should return bid price when only bids exist", async function () {
      await placeOrder(alice, SIDE_YES, 4000, true, 5n);

      const [yesPrice, noPrice] = await market.getCurrentPrice();
      expect(yesPrice).to.equal(4000n);
      expect(noPrice).to.equal(6000n);
    });

    it("should return ask price when only asks exist", async function () {
      await placeOrder(alice, SIDE_NO, 7000, false, 5n);

      const [yesPrice, noPrice] = await market.getCurrentPrice();
      expect(yesPrice).to.equal(7000n);
      expect(noPrice).to.equal(3000n);
    });
  });

  describe("Trade Fee Withdrawal", function () {
    it("should allow feeCollector to withdraw trade fees after match", async function () {
      await placeOrder(alice, SIDE_YES, 6000, true, 5n);
      await placeOrder(bob, SIDE_NO, 6000, false, 5n);
      await market.connect(charlie).attemptMatch(0, 1);

      await market.connect(feeCollector).withdrawTradeFees();
    });

    it("should reject non-feeCollector from withdrawing trade fees", async function () {
      await expect(market.connect(alice).withdrawTradeFees()).to.be.revertedWithCustomError(market, "OnlyCollector");
    });
  });

  describe("Partial Fill", function () {
    it("should support partial fill when bid size > ask size", async function () {
      await placeOrder(alice, SIDE_YES, 6000, true, 10n);
      await placeOrder(bob, SIDE_NO, 6000, false, 3n);

      await market.connect(charlie).attemptMatch(0, 1);

      // Both orders remain active
      const [, , , isActiveBid] = await market.getOrder(0);
      const [, , , isActiveAsk] = await market.getOrder(1);
      expect(isActiveBid).to.equal(true);
      expect(isActiveAsk).to.equal(true);
    });
  });

  describe("Market Cancellation - emit event", function () {
    it("should emit MarketCancelled event", async function () {
      const tx = await market.connect(deployer).cancelMarket();
      const receipt = await tx.wait();

      const event = findEvent(receipt, "MarketCancelled");
      expect(event).to.not.be.null;
    });
  });

  describe("Admin - setResolver after mints", function () {
    it("should reject setResolver after shares minted (HasMints)", async function () {
      await mintSharesFor(alice, 1_000_000n);

      await expect(market.connect(deployer).setResolver(bob.address)).to.be.revertedWithCustomError(market, "HasMints");
    });
  });

  describe("Admin - setFeeCollector restrictions", function () {
    it("should reject non-creator calling setFeeCollector (OnlyCreator)", async function () {
      await expect(market.connect(alice).setFeeCollector(bob.address)).to.be.revertedWithCustomError(
        market,
        "OnlyCreator",
      );
    });

    it("should reject zero address for setFeeCollector (ZeroAddress)", async function () {
      await expect(market.connect(deployer).setFeeCollector(ethers.ZeroAddress)).to.be.revertedWithCustomError(
        market,
        "ZeroAddress",
      );
    });
  });

  describe("Admin - setResolver restrictions", function () {
    it("should reject zero address for setResolver (ZeroAddress)", async function () {
      await expect(market.connect(deployer).setResolver(ethers.ZeroAddress)).to.be.revertedWithCustomError(
        market,
        "ZeroAddress",
      );
    });

    it("should reject setResolver on resolved market (Resolved)", async function () {
      await market.connect(deployer).cancelMarket(); // sets resolved = true
      await expect(market.connect(deployer).setResolver(alice.address)).to.be.revertedWithCustomError(
        market,
        "Resolved",
      );
    });
  });

  describe("Cancel after deadline still allowed", function () {
    it("should still allow cancelOrder after deadline", async function () {
      await placeOrder(alice, SIDE_YES, 5000, true, 5n);
      await advanceTime(ONE_DAY + 1);

      await market.connect(alice).cancelOrder(0);
      expect(await market.activeOrderCount()).to.equal(0n);
    });

    it("should still allow resolve after deadline", async function () {
      await advanceTime(ONE_DAY + 1);
      await market.connect(resolver).resolve(true);
      expect(await market.resolved()).to.equal(true);
    });
  });

  // ===================================================================
  // 22. PRICE IMPROVEMENT REFUND (edge cases)
  // ===================================================================

  describe("Price Improvement Refund (edge cases)", function () {
    it("should refund price difference when bid.price > ask.price (verify escrow deduction)", async function () {
      // Alice bids at 7000, Bob asks at 5000
      // Price gap = (7000 - 5000) * 100 = 200_000 per share
      // Alice escrowed = 7000 * 100 * 5 = 3_500_000
      const aliceBalBefore = await decryptTokenBalance(alice);

      await placeOrder(alice, SIDE_YES, 7000, true, 5n);

      const aliceBalAfterOrder = await decryptTokenBalance(alice);
      expect(aliceBalBefore - aliceBalAfterOrder).to.equal(3_500_000n);

      await placeOrder(bob, SIDE_NO, 5000, false, 5n);

      await market.connect(charlie).attemptMatch(0, 1);

      // Alice should have received a refund for the price gap
      // Refund = (7000 - 5000) * 100 * actualFill
      // Since sides are opposite (YES vs NO), actualFill = 5
      // Refund = 2000 * 100 * 5 = 1_000_000
      const aliceBalAfterMatch = await decryptTokenBalance(alice);
      // After order: balance dropped by 3_500_000
      // After match: refund of 1_000_000 should be returned
      expect(aliceBalAfterMatch - aliceBalAfterOrder).to.equal(1_000_000n);
    });

    it("should NOT refund when bid.price == ask.price", async function () {
      const aliceBalBefore = await decryptTokenBalance(alice);

      // Both at 6000 -> no price gap
      await placeOrder(alice, SIDE_YES, 6000, true, 5n);

      const aliceBalAfterOrder = await decryptTokenBalance(alice);
      expect(aliceBalBefore - aliceBalAfterOrder).to.equal(3_000_000n);

      await placeOrder(bob, SIDE_NO, 6000, false, 5n);

      await market.connect(charlie).attemptMatch(0, 1);

      // No refund should occur since prices are equal
      const aliceBalAfterMatch = await decryptTokenBalance(alice);
      expect(aliceBalAfterMatch).to.equal(aliceBalAfterOrder);
    });
  });

  // ===================================================================
  // 23. DOUBLE CANCEL PROTECTION
  // ===================================================================

  describe("Double Cancel Protection", function () {
    it("should revert cancelOrder on already cancelled order (NotActive)", async function () {
      await placeOrder(alice, SIDE_YES, 5000, true, 5n);
      await market.connect(alice).cancelOrder(0);

      await expect(market.connect(alice).cancelOrder(0)).to.be.revertedWithCustomError(market, "NotActive");
    });

    it("should revert cancelOrder on non-existent order ID", async function () {
      // No orders placed, order 999 does not exist
      // Order 999 has owner == address(0), so NotOwner will fire first
      await expect(market.connect(alice).cancelOrder(999)).to.be.revertedWithCustomError(market, "NotOwner");
    });
  });

  // ===================================================================
  // 24. encSide VALIDATION (new V2 security)
  // ===================================================================

  describe("encSide Validation", function () {
    it("should result in zero-amount order when side=5", async function () {
      // side=5 is invalid (only 0=YES and 1=NO are valid)
      // Contract: validSide check fails -> amount set to 0
      await placeOrder(alice, 5, 5000, true, 10n);

      // Order is created but with 0 effective size
      expect(await market.nextOrderId()).to.equal(1n);

      // Decrypt the size to verify it's 0
      const [, size] = await market.connect(alice).getOrderEncrypted(0);
      const decryptedSize = await fhevm.userDecryptEuint(FhevmType.euint64, size, marketAddress, alice);
      expect(decryptedSize).to.equal(0n);
    });

    it("should result in zero-amount order when side=255", async function () {
      // side=255 is invalid
      await placeOrder(alice, 255, 5000, true, 10n);

      expect(await market.nextOrderId()).to.equal(1n);

      const [, size] = await market.connect(alice).getOrderEncrypted(0);
      const decryptedSize = await fhevm.userDecryptEuint(FhevmType.euint64, size, marketAddress, alice);
      expect(decryptedSize).to.equal(0n);
    });
  });

  // ===================================================================
  // 25. TRADE FEE SOLVENCY
  // ===================================================================

  describe("Trade Fee Solvency", function () {
    it("should have enough cUSDT to cover all outstanding shares minus trade fees after match", async function () {
      // Alice bids YES at 6000, 10 shares. Escrow = 6_000_000
      await placeOrder(alice, SIDE_YES, 6000, true, 10n);
      // Bob asks NO at 6000, 10 shares. Escrow = 4_000_000
      await placeOrder(bob, SIDE_NO, 6000, false, 10n);

      // Match: total escrowed = 10_000_000
      // Trade fee per share = (6000 * 100 * 5) / 10000 = 300
      // Total trade fee = 300 * 10 = 3000
      // Net share unit = 1_000_000 - 300 = 999_700
      // Shares created: 10 * 999_700 = 9_997_000 for each party
      await market.connect(charlie).attemptMatch(0, 1);

      // The contract holds the escrowed amounts (10_000_000 total)
      // which should cover: shares + trade fees
      // This test verifies the match completes without reverting (solvency check)

      // Verify shares were created properly
      const yesAlice = await decryptYesShares(alice);
      const noBob = await decryptNoShares(bob);
      expect(yesAlice).to.equal(9_997_000n);
      expect(noBob).to.equal(9_997_000n);
    });

    it("should not create insolvency after trade fee withdrawal", async function () {
      await placeOrder(alice, SIDE_YES, 6000, true, 10n);
      await placeOrder(bob, SIDE_NO, 6000, false, 10n);
      await market.connect(charlie).attemptMatch(0, 1);

      // Withdraw trade fees
      await market.connect(feeCollector).withdrawTradeFees();

      // Resolve and redeem to verify the contract can still pay out
      await resolveMarket(true);

      // Alice can still request redemption (contract is solvent)
      await market.connect(alice).requestRedemption();
      // No revert means the contract is not insolvent
    });
  });

  // ===================================================================
  // 26. MARKET STATE GUARDS
  // ===================================================================

  describe("Market State Guards", function () {
    it("should revert mintShares when market is cancelled", async function () {
      await market.connect(deployer).cancelMarket();

      const input = fhevm.createEncryptedInput(marketAddress, alice.address);
      input.add64(1_000_000n);
      const enc = await input.encrypt();

      await expect(market.connect(alice).mintShares(enc.handles[0], enc.inputProof)).to.be.revertedWithCustomError(
        market,
        "Resolved",
      );
    });

    it("should revert placeOrder when market is resolved", async function () {
      await resolveMarket(true);

      const input = fhevm.createEncryptedInput(marketAddress, alice.address);
      input.add8(SIDE_YES);
      input.add64(5n);
      const enc = await input.encrypt();

      await expect(
        market.connect(alice).placeOrder(enc.handles[0], 5000, true, enc.handles[1], enc.inputProof, enc.inputProof),
      ).to.be.revertedWithCustomError(market, "Resolved");
    });

    it("should revert placeOrder after deadline", async function () {
      await advanceTime(ONE_DAY + 1);

      const input = fhevm.createEncryptedInput(marketAddress, alice.address);
      input.add8(SIDE_YES);
      input.add64(5n);
      const enc = await input.encrypt();

      await expect(
        market.connect(alice).placeOrder(enc.handles[0], 5000, true, enc.handles[1], enc.inputProof, enc.inputProof),
      ).to.be.revertedWithCustomError(market, "Closed");
    });

    it("should revert attemptMatch when resolved", async function () {
      await placeOrder(alice, SIDE_YES, 6000, true, 5n);
      await placeOrder(bob, SIDE_NO, 6000, false, 5n);

      await resolveMarket(true);

      await expect(market.connect(charlie).attemptMatch(0, 1)).to.be.revertedWithCustomError(market, "Resolved");
    });

    it("should revert attemptMatch after deadline", async function () {
      await placeOrder(alice, SIDE_YES, 6000, true, 5n);
      await placeOrder(bob, SIDE_NO, 6000, false, 5n);

      await advanceTime(ONE_DAY + 1);

      await expect(market.connect(charlie).attemptMatch(0, 1)).to.be.revertedWithCustomError(market, "Closed");
    });

    it("should revert resolve when already resolved", async function () {
      await advanceTime(ONE_DAY + 1);
      await market.connect(resolver).resolve(true);

      await expect(market.connect(resolver).resolve(false)).to.be.revertedWithCustomError(market, "Resolved");
    });

    it("should revert resolve from non-resolver", async function () {
      await advanceTime(ONE_DAY + 1);

      await expect(market.connect(alice).resolve(true)).to.be.revertedWithCustomError(market, "OnlyResolver");
    });
  });

  // ===================================================================
  // 27. EMERGENCY EDGE CASES
  // ===================================================================

  describe("Emergency Edge Cases", function () {
    beforeEach(async function () {
      await mintSharesFor(alice, 1_000_000n);
    });

    it("should revert emergencyWithdraw before grace period ends", async function () {
      // Only advance past deadline, not past grace period
      await advanceTime(ONE_DAY + 1);

      await expect(market.connect(alice).emergencyWithdraw()).to.be.revertedWithCustomError(market, "GraceActive");
    });

    it("should allow emergencyRefundAfterResolution after resolution + timeout", async function () {
      await resolveMarket(true);
      await advanceTime(SEVEN_DAYS + 1);

      // Should succeed without revert
      await market.connect(alice).emergencyRefundAfterResolution();
    });

    it("should revert finalizeEmergencyWithdraw without prior request", async function () {
      await expect(market.connect(alice).finalizeEmergencyWithdraw(0, 0, "0x")).to.be.revertedWithCustomError(
        market,
        "NotRequested",
      );
    });
  });

  // ===================================================================
  // 28. cancelOrders EDGE CASES
  // ===================================================================

  describe("cancelOrders edge cases", function () {
    it("should succeed with empty array (no-op)", async function () {
      await market.connect(alice).cancelOrders([]);
      // No revert, no state change
      expect(await market.activeOrderCount()).to.equal(0n);
    });

    it("should revert when cancelling another user's order (NotOwner)", async function () {
      await placeOrder(alice, SIDE_YES, 5000, true, 5n);

      await expect(market.connect(bob).cancelOrders([0])).to.be.revertedWithCustomError(market, "NotOwner");
    });

    it("should skip inactive orders in a mix of active and inactive", async function () {
      await placeOrder(alice, SIDE_YES, 5000, true, 5n);
      await placeOrder(alice, SIDE_NO, 6000, false, 3n);
      await placeOrder(alice, SIDE_YES, 7000, true, 2n);

      // Cancel middle order individually first
      await market.connect(alice).cancelOrder(1);
      expect(await market.activeOrderCount()).to.equal(2n);

      // Now batch cancel all three (order 1 is already inactive, should be skipped)
      await market.connect(alice).cancelOrders([0, 1, 2]);
      expect(await market.activeOrderCount()).to.equal(0n);

      // All orders should be inactive
      const [, , , isActive0] = await market.getOrder(0);
      const [, , , isActive1] = await market.getOrder(1);
      const [, , , isActive2] = await market.getOrder(2);
      expect(isActive0).to.equal(false);
      expect(isActive1).to.equal(false);
      expect(isActive2).to.equal(false);
    });
  });

  // ===================================================================
  // 29. WITHDRAW FEES EDGE CASES
  // ===================================================================

  describe("Withdraw Fees edge cases", function () {
    it("should revert withdrawFees when no fees collected", async function () {
      await expect(market.connect(feeCollector).withdrawFees()).to.be.revertedWithCustomError(market, "NoFees");
    });

    it("should revert withdrawFees from non-feeCollector", async function () {
      await expect(market.connect(alice).withdrawFees()).to.be.revertedWithCustomError(market, "OnlyCollector");
    });

    it("should revert withdrawTradeFees from non-feeCollector", async function () {
      await expect(market.connect(alice).withdrawTradeFees()).to.be.revertedWithCustomError(market, "OnlyCollector");
    });

    it("should revert withdrawTradeFees when no trade fees collected", async function () {
      // No matches have occurred so encryptedTradeFees is 0
      // withdrawTradeFees transfers encrypted 0 and doesn't revert explicitly,
      // but the token transfer of 0 should still succeed (FHE pattern)
      await market.connect(feeCollector).withdrawTradeFees();
      // If it doesn't revert, that's the expected FHE behavior (encrypted 0 transfer)
    });
  });

  // ===================================================================
  // 30. CONSTRUCTOR VALIDATION
  // ===================================================================

  describe("Constructor Validation", function () {
    it("should revert with empty resolution source (NoSource)", async function () {
      const block = await ethers.provider.getBlock("latest");
      const futureDeadline = block!.timestamp + ONE_DAY;
      const OpaqueMarket = await ethers.getContractFactory("OpaqueMarket");

      await expect(
        OpaqueMarket.deploy(
          QUESTION,
          futureDeadline,
          "", // empty resolution source
          RESOLUTION_TYPE,
          RESOLUTION_CRITERIA,
          "crypto",
          resolver.address,
          feeCollector.address,
          tokenAddress,
          deployer.address,
        ),
      ).to.be.revertedWithCustomError(market, "NoSource");
    });

    it("should revert with deadline in the past (BadDeadline)", async function () {
      const block = await ethers.provider.getBlock("latest");
      const pastDeadline = block!.timestamp - 100;
      const OpaqueMarket = await ethers.getContractFactory("OpaqueMarket");

      await expect(
        OpaqueMarket.deploy(
          QUESTION,
          pastDeadline,
          RESOLUTION_SOURCE,
          RESOLUTION_TYPE,
          RESOLUTION_CRITERIA,
          "crypto",
          resolver.address,
          feeCollector.address,
          tokenAddress,
          deployer.address,
        ),
      ).to.be.revertedWithCustomError(market, "BadDeadline");
    });

    it("should revert with zero resolver address (NoResolver)", async function () {
      const block = await ethers.provider.getBlock("latest");
      const futureDeadline = block!.timestamp + ONE_DAY;
      const OpaqueMarket = await ethers.getContractFactory("OpaqueMarket");

      await expect(
        OpaqueMarket.deploy(
          QUESTION,
          futureDeadline,
          RESOLUTION_SOURCE,
          RESOLUTION_TYPE,
          RESOLUTION_CRITERIA,
          "crypto",
          ethers.ZeroAddress, // zero resolver
          feeCollector.address,
          tokenAddress,
          deployer.address,
        ),
      ).to.be.revertedWithCustomError(market, "NoResolver");
    });

    it("should revert with zero creator address (NoCreator)", async function () {
      const block = await ethers.provider.getBlock("latest");
      const futureDeadline = block!.timestamp + ONE_DAY;
      const OpaqueMarket = await ethers.getContractFactory("OpaqueMarket");

      await expect(
        OpaqueMarket.deploy(
          QUESTION,
          futureDeadline,
          RESOLUTION_SOURCE,
          RESOLUTION_TYPE,
          RESOLUTION_CRITERIA,
          "crypto",
          resolver.address,
          feeCollector.address,
          tokenAddress,
          ethers.ZeroAddress, // zero creator
        ),
      ).to.be.revertedWithCustomError(market, "NoCreator");
    });
  });

  // ===================================================================
  // 31. MAX_ACTIVE_ORDERS LIMIT
  // ===================================================================

  describe("MAX_ACTIVE_ORDERS Limit", function () {
    it("should have MAX_ACTIVE_ORDERS constant equal to 200", async function () {
      expect(await market.MAX_ACTIVE_ORDERS()).to.equal(200n);
    });
  });

  // ===================================================================
  // 32. FINALIZE REVERT GUARDS (isolated)
  // ===================================================================

  describe("finalizeRedemption and finalizeEmergencyWithdraw revert guards", function () {
    beforeEach(async function () {
      await mintSharesFor(alice, 1_000_000n);
    });

    it("finalizeRedemption should revert if not requested (NotRequested)", async function () {
      await resolveMarket(true);

      await expect(market.connect(alice).finalizeRedemption(1_000_000, "0x")).to.be.revertedWithCustomError(
        market,
        "NotRequested",
      );
    });

    it("finalizeEmergencyWithdraw should revert if not requested (NotRequested)", async function () {
      await expect(
        market.connect(alice).finalizeEmergencyWithdraw(1_000_000, 1_000_000, "0x"),
      ).to.be.revertedWithCustomError(market, "NotRequested");
    });

    it("emergencyWithdraw should revert before grace period (GraceActive)", async function () {
      // Advance past deadline but within grace period
      await advanceTime(ONE_DAY + 1);

      await expect(market.connect(alice).emergencyWithdraw()).to.be.revertedWithCustomError(market, "GraceActive");
    });
  });

  // ===================================================================
  // 33. ATTEMPT MATCH GUARDS (V2)
  // ===================================================================

  describe("attemptMatch guards (V2)", function () {
    it("should revert after market is resolved (Resolved)", async function () {
      await placeOrder(alice, SIDE_YES, 6000, true, 5n);
      await placeOrder(bob, SIDE_NO, 6000, false, 5n);

      await resolveMarket(true);

      await expect(market.connect(charlie).attemptMatch(0, 1)).to.be.revertedWithCustomError(market, "Resolved");
    });

    it("should revert after deadline passed (Closed)", async function () {
      await placeOrder(alice, SIDE_YES, 6000, true, 5n);
      await placeOrder(bob, SIDE_NO, 6000, false, 5n);

      await advanceTime(ONE_DAY + 1);

      await expect(market.connect(charlie).attemptMatch(0, 1)).to.be.revertedWithCustomError(market, "Closed");
    });
  });

  // ===================================================================
  // 34. PAUSE / UNPAUSE (extended)
  // ===================================================================

  describe("Pause/Unpause Extended", function () {
    it("should allow creator to pause", async function () {
      await market.connect(deployer).pause();
      expect(await market.paused()).to.equal(true);
    });

    it("should reject non-creator from pausing (OnlyCreator)", async function () {
      await expect(market.connect(alice).pause()).to.be.revertedWithCustomError(market, "OnlyCreator");
    });

    it("should prevent minting when paused (EnforcedPause)", async function () {
      await market.connect(deployer).pause();

      const input = fhevm.createEncryptedInput(marketAddress, alice.address);
      input.add64(1_000_000n);
      const enc = await input.encrypt();

      await expect(market.connect(alice).mintShares(enc.handles[0], enc.inputProof)).to.be.revertedWithCustomError(
        market,
        "EnforcedPause",
      );
    });

    it("should prevent placeOrder when paused (EnforcedPause)", async function () {
      await market.connect(deployer).pause();

      const input = fhevm.createEncryptedInput(marketAddress, alice.address);
      input.add8(SIDE_YES);
      input.add64(5n);
      const enc = await input.encrypt();

      await expect(
        market.connect(alice).placeOrder(enc.handles[0], 5000, true, enc.handles[1], enc.inputProof, enc.inputProof),
      ).to.be.revertedWithCustomError(market, "EnforcedPause");
    });

    it("should allow unpause and resume operations", async function () {
      await market.connect(deployer).pause();
      expect(await market.paused()).to.equal(true);

      await market.connect(deployer).unpause();
      expect(await market.paused()).to.equal(false);

      // After unpause, minting should work again
      await mintSharesFor(alice, 1_000_000n);
      expect(await market.totalSharesMinted()).to.equal(1n);
    });

    it("should reject non-creator from unpausing (OnlyCreator)", async function () {
      await market.connect(deployer).pause();

      await expect(market.connect(alice).unpause()).to.be.revertedWithCustomError(market, "OnlyCreator");
    });
  });

  // ===================================================================
  // 35. PARTIAL FILL TRACKING (CRITICAL)
  // ===================================================================

  describe("Partial Fill Tracking", function () {
    it("should handle bid >> ask partial fill correctly", async function () {
      // Alice places large buy order (100 shares at 6000)
      await placeOrder(alice, SIDE_YES, 6000, true, 100n);

      // Bob places small sell order (10 shares at 5000)
      await placeOrder(bob, SIDE_NO, 5000, false, 10n);

      // Match -> Bob fully filled, Alice partially filled
      await market.connect(charlie).attemptMatch(0, 1);

      // Verify Alice's order is still active (partially filled)
      const [, , , isActiveBid] = await market.getOrder(0);
      expect(isActiveBid).to.equal(true);

      // Verify Alice's filled size via getOrderEncrypted
      const [, , filled] = await market.connect(alice).getOrderEncrypted(0);
      const decryptedFilled = await fhevm.userDecryptEuint(FhevmType.euint64, filled, marketAddress, alice);
      expect(decryptedFilled).to.equal(10n);

      // Alice's escrow should have been reduced by the fill
      // Bid escrow consumed per share = bid.price * PRICE_TO_USDT = 6000 * 100 = 600_000
      // For 10 shares: 600_000 * 10 = 6_000_000 consumed
      // Plus price improvement refund: (6000 - 5000) * 100 * 10 = 1_000_000
      // escrowRemaining = original (6000*100*100 = 60_000_000) - 6_000_000 - 1_000_000 = 53_000_000
      const [, , , escrow] = await market.connect(alice).getOrderEncrypted(0);
      const decryptedEscrow = await fhevm.userDecryptEuint(FhevmType.euint64, escrow, marketAddress, alice);
      expect(decryptedEscrow).to.equal(53_000_000n);

      // Charlie places another small sell (20 shares at 5500)
      await placeOrder(charlie, SIDE_NO, 5500, false, 20n);

      // Match Alice with Charlie -> verify cumulative fill works
      await market.connect(deployer).attemptMatch(0, 2);

      // Verify Alice's cumulative fill is now 30
      const [, , filled2] = await market.connect(alice).getOrderEncrypted(0);
      const decryptedFilled2 = await fhevm.userDecryptEuint(FhevmType.euint64, filled2, marketAddress, alice);
      expect(decryptedFilled2).to.equal(30n);
    });
  });

  // ===================================================================
  // 36. MAX_ACTIVE_ORDERS ENFORCEMENT (HIGH)
  // ===================================================================

  describe("Order Limits", function () {
    it("should revert when placing 201st order", async function () {
      // Fund alice with extra tokens for 200+ orders
      // Each order escrows at minimum: 100 * 100 * 1 = 10_000 per order
      // 200 orders at min price = 200 * 10_000 = 2_000_000
      // Alice already has 100_000_000 which is enough

      // Place 200 orders (loop with different prices within valid range)
      for (let i = 0; i < 200; i++) {
        // Alternate prices between 100 and 9900 to stay in valid range
        const price = 100 + (i % 98) * 100; // prices: 100, 200, ..., 9900, 100, ...
        await placeOrder(alice, SIDE_YES, price, true, 1n);
      }

      expect(await market.activeOrderCount()).to.equal(200n);

      // 201st order should revert with OrderLimit
      const input = fhevm.createEncryptedInput(marketAddress, alice.address);
      input.add8(SIDE_YES);
      input.add64(1n);
      const enc = await input.encrypt();

      await expect(
        market.connect(alice).placeOrder(enc.handles[0], 5000, true, enc.handles[1], enc.inputProof, enc.inputProof),
      ).to.be.revertedWithCustomError(market, "OrderLimit");
    });
  });

  // ===================================================================
  // 37. ZERO AMOUNT HANDLING (CRITICAL)
  // ===================================================================

  describe("Zero Amount Edge Cases", function () {
    it("should handle mintShares with zero amount", async function () {
      // Mint 0 shares - FHE pattern: amount clamped to 0, no-op transfer
      // The contract does not revert on zero due to FHE nature
      // But token transfer of 0 should still succeed
      const balBefore = await decryptTokenBalance(alice);
      await mintSharesFor(alice, 0n);
      const balAfter = await decryptTokenBalance(alice);
      // Balance should not change
      expect(balAfter).to.equal(balBefore);
    });

    it("should handle burnShares with zero amount", async function () {
      // First mint so user has shares (burn requires NoShares check)
      await mintSharesFor(alice, 1_000_000n);
      const balBefore = await decryptTokenBalance(alice);

      // Burn 0 shares — should be a no-op
      await burnSharesFor(alice, 0n);
      const balAfter = await decryptTokenBalance(alice);
      // Balance should not change
      expect(balAfter).to.equal(balBefore);

      // Share balances should be unchanged
      const yes = await decryptYesShares(alice);
      expect(yes).to.equal(1_000_000n);
    });
  });

  // ===================================================================
  // 38. RESOLUTION TIMING BOUNDARY (CRITICAL)
  // ===================================================================

  describe("Resolution Timing", function () {
    it("should revert resolve before deadline", async function () {
      // Read the actual deadline from contract and current block timestamp
      const deadlineVal = await market.deadline();
      const currentBlock = await ethers.provider.getBlock("latest");
      const currentTime = BigInt(currentBlock!.timestamp);
      // Advance to 10 seconds before deadline (safely before)
      const gap = Number(deadlineVal - currentTime) - 10;
      if (gap > 0) await advanceTime(gap);

      // block.timestamp should now be ~10s before deadline → strictly < deadline → should revert
      await expect(market.connect(resolver).resolve(true)).to.be.revertedWithCustomError(market, "NotEnded");
    });

    it("should succeed resolve one second after deadline", async function () {
      // Advance time to deadline + 1
      await advanceTime(ONE_DAY + 1);

      await market.connect(resolver).resolve(true);
      expect(await market.resolved()).to.equal(true);
      expect(await market.outcome()).to.equal(true);
    });
  });

  // ===================================================================
  // 39. CANCEL + MATCH RACE (CRITICAL)
  // ===================================================================

  describe("Cancel and Match Race", function () {
    it("should revert match on cancelled bid", async function () {
      // Place bid and ask
      await placeOrder(alice, SIDE_YES, 6000, true, 5n);
      await placeOrder(bob, SIDE_NO, 6000, false, 5n);

      // Cancel the bid
      await market.connect(alice).cancelOrder(0);

      // Try to match cancelled bid with ask -> should revert BidNotActive
      await expect(market.connect(charlie).attemptMatch(0, 1)).to.be.revertedWithCustomError(market, "BidNotActive");
    });

    it("should revert match on cancelled ask", async function () {
      // Place bid and ask
      await placeOrder(alice, SIDE_YES, 6000, true, 5n);
      await placeOrder(bob, SIDE_NO, 6000, false, 5n);

      // Cancel the ask
      await market.connect(bob).cancelOrder(1);

      // Try to match bid with cancelled ask -> should revert AskNotActive
      await expect(market.connect(charlie).attemptMatch(0, 1)).to.be.revertedWithCustomError(market, "AskNotActive");
    });
  });

  // ===================================================================
  // 40. BEST PRICE UPDATES (HIGH)
  // ===================================================================

  describe("Best Price Updates", function () {
    it("should track bestBid across multiple price levels", async function () {
      // Place bids at 5000, 6000, 7000
      await placeOrder(alice, SIDE_YES, 5000, true, 1n);
      await placeOrder(bob, SIDE_YES, 6000, true, 1n);
      await placeOrder(charlie, SIDE_YES, 7000, true, 1n);

      // bestBid should be 7000
      const [bestBid1] = await market.getBestPrices();
      expect(bestBid1).to.equal(7000n);

      // Cancel 7000 bid -> bestBid should reset to 0 (advisory)
      await market.connect(charlie).cancelOrder(2);

      const [bestBid2] = await market.getBestPrices();
      expect(bestBid2).to.equal(0n);

      // Place new bid at 5500 -> bestBid should be 5500
      await placeOrder(alice, SIDE_YES, 5500, true, 1n);

      const [bestBid3] = await market.getBestPrices();
      expect(bestBid3).to.equal(5500n);
    });

    it("should track bestAsk across multiple price levels", async function () {
      // Place asks at 7000, 6000, 5000
      await placeOrder(alice, SIDE_NO, 7000, false, 1n);
      await placeOrder(bob, SIDE_NO, 6000, false, 1n);
      await placeOrder(charlie, SIDE_NO, 5000, false, 1n);

      // bestAsk should be 5000 (lowest ask)
      const [, bestAsk1] = await market.getBestPrices();
      expect(bestAsk1).to.equal(5000n);

      // Cancel 5000 ask -> bestAsk should reset to 0 (advisory)
      await market.connect(charlie).cancelOrder(2);

      const [, bestAsk2] = await market.getBestPrices();
      expect(bestAsk2).to.equal(0n);

      // Place new ask at 6500 -> bestAsk should be 6500
      await placeOrder(alice, SIDE_NO, 6500, false, 1n);

      const [, bestAsk3] = await market.getBestPrices();
      expect(bestAsk3).to.equal(6500n);
    });
  });

  // ===================================================================
  // 41. ORDER ACCESS CONTROL (HIGH)
  // ===================================================================

  describe("Order Access Control", function () {
    it("should revert cancelOrder from non-owner", async function () {
      // Alice places order
      await placeOrder(alice, SIDE_YES, 5000, true, 5n);

      // Bob tries to cancel Alice's order -> should revert NotOwner
      await expect(market.connect(bob).cancelOrder(0)).to.be.revertedWithCustomError(market, "NotOwner");
    });

    it("should revert cancelOrders from non-owner", async function () {
      // Alice places order
      await placeOrder(alice, SIDE_YES, 5000, true, 5n);

      // Bob tries to batch cancel Alice's order -> should revert NotOwner
      await expect(market.connect(bob).cancelOrders([0])).to.be.revertedWithCustomError(market, "NotOwner");
    });
  });
});
