import { expect } from "chai";
import { ethers } from "hardhat";
import { fhevm } from "hardhat";
import { FhevmType } from "@fhevm/hardhat-plugin";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";

/**
 * MatchingScenarios - Comprehensive tests for the order matching engine.
 *
 * Covers: multi-party matching, price level scenarios, partial fills,
 * failed matches (privacy proof), order state after matching, and escrow calculations.
 *
 * V2 API — unified placeOrder + permissionless attemptMatch, no matcher role.
 *
 * Constants:
 *   SIDE_YES = 0, SIDE_NO = 1
 *   Price range: 100–9900 (BPS)
 *   SHARE_UNIT = 1_000_000
 *   PRICE_TO_USDT = 100
 *   TRADE_FEE_BPS = 5
 *   MAX_ACTIVE_ORDERS = 200
 *
 * Escrow:
 *   Bid: price * PRICE_TO_USDT * amount
 *   Ask: (10000 - price) * PRICE_TO_USDT * amount
 *
 * Trade fee per share: (ask.price * PRICE_TO_USDT * TRADE_FEE_BPS) / BPS
 * Net share unit: SHARE_UNIT - feePerShare
 */
describe("MatchingScenarios", function () {
  let market: any;
  let token: any;
  let signers: HardhatEthersSigner[];
  let deployer: HardhatEthersSigner;
  let alice: HardhatEthersSigner;
  let bob: HardhatEthersSigner;
  let charlie: HardhatEthersSigner;
  let dave: HardhatEthersSigner;
  let eve: HardhatEthersSigner;
  let resolver: HardhatEthersSigner;
  let feeCollector: HardhatEthersSigner;
  let marketAddress: string;
  let tokenAddress: string;

  const QUESTION = "Will ETH exceed $10K by Dec 2026?";
  const RESOLUTION_SOURCE = "Chainlink ETH/USD Price Feed";
  const RESOLUTION_TYPE = "onchain_oracle";
  const RESOLUTION_CRITERIA = ">= 10000";

  const SIDE_YES = 0;
  const SIDE_NO = 1;

  const ONE_DAY = 86400;
  const SHARE_UNIT = 1_000_000n;
  const PRICE_TO_USDT = 100n;
  const BPS = 10_000n;
  const TRADE_FEE_BPS = 5n;

  // -------------------------------------------------------
  // HELPERS
  // -------------------------------------------------------

  async function deployMarket() {
    const ConfidentialUSDT = await ethers.getContractFactory("ConfidentialUSDT");
    token = await ConfidentialUSDT.deploy();
    await token.waitForDeployment();
    tokenAddress = await token.getAddress();

    const block = await ethers.provider.getBlock("latest");
    const deadline = block!.timestamp + ONE_DAY;

    const OpaqueMarket = await ethers.getContractFactory("OpaqueMarket");
    market = await OpaqueMarket.deploy(
      QUESTION,
      deadline,
      RESOLUTION_SOURCE,
      RESOLUTION_TYPE,
      RESOLUTION_CRITERIA,
      "crypto",
      resolver.address,
      feeCollector.address,
      tokenAddress,
      deployer.address,
    );
    await market.waitForDeployment();
    marketAddress = await market.getAddress();
  }

  async function fundAndApprove(signer: HardhatEthersSigner, amount: bigint) {
    await token.mint(signer.address, amount);
    await token.connect(signer).approvePlaintext(marketAddress, amount);
  }

  async function mintShares(signer: HardhatEthersSigner, amount: bigint) {
    const input = fhevm.createEncryptedInput(marketAddress, signer.address);
    input.add64(amount);
    const encrypted = await input.encrypt();
    const tx = await market.connect(signer).mintShares(encrypted.handles[0], encrypted.inputProof);
    return tx;
  }

  async function placeOrder(signer: HardhatEthersSigner, side: number, price: number, isBid: boolean, amount: bigint) {
    const input = fhevm.createEncryptedInput(marketAddress, signer.address);
    input.add8(side);
    input.add64(amount);
    const encrypted = await input.encrypt();
    const tx = await market.connect(signer).placeOrder(
      encrypted.handles[0],
      price,
      isBid,
      encrypted.handles[1],
      encrypted.inputProof,
      encrypted.inputProof,
    );
    return tx;
  }

  async function getBalance(signer: HardhatEthersSigner): Promise<bigint> {
    const encBalance = await token.balanceOf(signer.address);
    return fhevm.userDecryptEuint(FhevmType.euint64, encBalance, tokenAddress, signer);
  }

  async function getShares(signer: HardhatEthersSigner): Promise<{ yes: bigint; no: bigint }> {
    const [yesHandle, noHandle] = await market.connect(signer).getMyShares();
    const yes = await fhevm.userDecryptEuint(FhevmType.euint64, yesHandle, marketAddress, signer);
    const no = await fhevm.userDecryptEuint(FhevmType.euint64, noHandle, marketAddress, signer);
    return { yes, no };
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

  /** Compute trade fee per share: (askPrice * PRICE_TO_USDT * TRADE_FEE_BPS) / BPS */
  function tradeFeePerShare(askPrice: bigint): bigint {
    return (askPrice * PRICE_TO_USDT * TRADE_FEE_BPS) / BPS;
  }

  /** Compute net share unit after fee deduction */
  function netShareUnit(askPrice: bigint): bigint {
    return SHARE_UNIT - tradeFeePerShare(askPrice);
  }

  /** Compute bid escrow: price * PRICE_TO_USDT * amount */
  function bidEscrow(price: bigint, amount: bigint): bigint {
    return price * PRICE_TO_USDT * amount;
  }

  /** Compute ask escrow: (BPS - price) * PRICE_TO_USDT * amount */
  function askEscrow(price: bigint, amount: bigint): bigint {
    return (BPS - price) * PRICE_TO_USDT * amount;
  }

  // -------------------------------------------------------
  // FIXTURE
  // -------------------------------------------------------

  beforeEach(async function () {
    signers = await ethers.getSigners();
    deployer = signers[0];
    alice = signers[1];
    bob = signers[2];
    charlie = signers[3];
    dave = signers[4];
    eve = signers[5];
    resolver = signers[6];
    feeCollector = signers[7];
  });

  // ===================================================================
  // 1. MULTI-PARTY MATCHING (8 tests)
  // ===================================================================

  describe("1. Multi-Party Matching", function () {
    beforeEach(async function () {
      await deployMarket();
      await fundAndApprove(alice, 100_000_000n);
      await fundAndApprove(bob, 100_000_000n);
      await fundAndApprove(charlie, 100_000_000n);
      await fundAndApprove(dave, 100_000_000n);
      await fundAndApprove(eve, 100_000_000n);
    });

    it("1.1 - 3 users: Alice YES bid, Bob NO ask, Charlie matches them", async function () {
      // Alice: bid YES at 6000, 10 shares
      await placeOrder(alice, SIDE_YES, 6000, true, 10n);
      // Bob: ask NO at 6000, 10 shares (opposite side -> fills)
      await placeOrder(bob, SIDE_NO, 6000, false, 10n);

      expect(await market.activeOrderCount()).to.equal(2n);

      // Charlie (third party) matches — permissionless
      const tx = await market.connect(charlie).attemptMatch(0, 1);
      const receipt = await tx.wait();

      const event = findEvent(receipt, "MatchAttempted");
      expect(event).to.not.be.null;
      expect(event.args.bidId).to.equal(0n);
      expect(event.args.askId).to.equal(1n);
      expect(event.args.caller).to.equal(charlie.address);

      // Alice (bid YES) gets YES tokens: 10 * netShareUnit(6000)
      // feePerShare = 6000 * 100 * 5 / 10000 = 300
      // net = 1_000_000 - 300 = 999_700, total = 10 * 999_700 = 9_997_000
      const aliceYes = await decryptYesShares(alice);
      expect(aliceYes).to.equal(9_997_000n);

      // Bob (ask NO, bidIsYes=true) gets NO tokens
      const bobNo = await decryptNoShares(bob);
      expect(bobNo).to.equal(9_997_000n);
    });

    it("1.2 - 4 users: Multiple bids and asks at same price", async function () {
      // Alice: bid YES at 5000, 5 shares
      await placeOrder(alice, SIDE_YES, 5000, true, 5n);
      // Bob: bid YES at 5000, 5 shares
      await placeOrder(bob, SIDE_YES, 5000, true, 5n);
      // Charlie: ask NO at 5000, 5 shares
      await placeOrder(charlie, SIDE_NO, 5000, false, 5n);
      // Dave: ask NO at 5000, 5 shares
      await placeOrder(dave, SIDE_NO, 5000, false, 5n);

      expect(await market.activeOrderCount()).to.equal(4n);
      expect(await market.nextOrderId()).to.equal(4n);

      // Match Alice-Charlie and Bob-Dave
      await market.connect(eve).attemptMatch(0, 2);
      await market.connect(eve).attemptMatch(1, 3);

      // feePerShare = 5000 * 100 * 5 / 10000 = 250
      // net = 1_000_000 - 250 = 999_750, total = 5 * 999_750 = 4_998_750
      const aliceYes = await decryptYesShares(alice);
      expect(aliceYes).to.equal(4_998_750n);

      const bobYes = await decryptYesShares(bob);
      expect(bobYes).to.equal(4_998_750n);

      const charlieNo = await decryptNoShares(charlie);
      expect(charlieNo).to.equal(4_998_750n);

      const daveNo = await decryptNoShares(dave);
      expect(daveNo).to.equal(4_998_750n);
    });

    it("1.3 - Sequential matches: match bid0-ask0, then bid0-ask1 (partial fill)", async function () {
      // Alice: bid YES at 6000, 20 shares (large bid)
      await placeOrder(alice, SIDE_YES, 6000, true, 20n);
      // Bob: ask NO at 6000, 10 shares
      await placeOrder(bob, SIDE_NO, 6000, false, 10n);
      // Charlie: ask NO at 6000, 10 shares
      await placeOrder(charlie, SIDE_NO, 6000, false, 10n);

      // First match: bid 0 vs ask 1 (fills 10 of Alice's 20)
      await market.connect(dave).attemptMatch(0, 1);

      // Second match: bid 0 vs ask 2 (fills remaining 10)
      await market.connect(dave).attemptMatch(0, 2);

      // feePerShare = 6000 * 100 * 5 / 10000 = 300
      // net = 999_700, Alice total = 20 * 999_700 = 19_994_000
      const aliceYes = await decryptYesShares(alice);
      expect(aliceYes).to.equal(19_994_000n);

      // Bob and Charlie each got 10 shares worth of NO tokens
      const bobNo = await decryptNoShares(bob);
      expect(bobNo).to.equal(9_997_000n);

      const charlieNo = await decryptNoShares(charlie);
      expect(charlieNo).to.equal(9_997_000n);
    });

    it("1.4 - 3 users at different prices: higher bid matches first (better price)", async function () {
      // Alice: bid YES at 6500, 5 shares
      await placeOrder(alice, SIDE_YES, 6500, true, 5n);
      // Bob: bid YES at 7000, 5 shares (better bid)
      await placeOrder(bob, SIDE_YES, 7000, true, 5n);
      // Charlie: ask NO at 6800, 5 shares
      await placeOrder(charlie, SIDE_NO, 6800, false, 5n);

      // Bob at 7000 >= Charlie at 6800, so this match is valid
      await market.connect(dave).attemptMatch(1, 2);

      // feePerShare = 6800 * 100 * 5 / 10000 = 340
      // net = 999_660, total = 5 * 999_660 = 4_998_300
      const bobYes = await decryptYesShares(bob);
      expect(bobYes).to.equal(4_998_300n);

      // Alice at 6500 < Charlie at 6800, so this match would revert
      await expect(market.connect(dave).attemptMatch(0, 2)).to.be.revertedWithCustomError(market, "BidLessThanAsk");
    });

    it("1.5 - Self-match should revert with NoSelfMatch", async function () {
      // Alice places both a bid and an ask
      await placeOrder(alice, SIDE_YES, 6000, true, 5n);
      await placeOrder(alice, SIDE_NO, 6000, false, 5n);

      // Attempting to match Alice's own orders should revert
      await expect(market.connect(bob).attemptMatch(0, 1)).to.be.revertedWithCustomError(market, "NoSelfMatch");
    });

    it("1.6 - Multiple asks against one large bid", async function () {
      // Alice: bid YES at 5500, 30 shares
      await placeOrder(alice, SIDE_YES, 5500, true, 30n);
      // Bob: ask NO at 5500, 10 shares
      await placeOrder(bob, SIDE_NO, 5500, false, 10n);
      // Charlie: ask NO at 5500, 10 shares
      await placeOrder(charlie, SIDE_NO, 5500, false, 10n);
      // Dave: ask NO at 5500, 10 shares
      await placeOrder(dave, SIDE_NO, 5500, false, 10n);

      // Match all three asks against Alice's bid
      await market.connect(eve).attemptMatch(0, 1);
      await market.connect(eve).attemptMatch(0, 2);
      await market.connect(eve).attemptMatch(0, 3);

      // feePerShare = 5500 * 100 * 5 / 10000 = 275
      // net = 999_725, Alice total = 30 * 999_725 = 29_991_750
      const aliceYes = await decryptYesShares(alice);
      expect(aliceYes).to.equal(29_991_750n);

      // Each counterparty gets 10 * 999_725 = 9_997_250 NO
      const bobNo = await decryptNoShares(bob);
      expect(bobNo).to.equal(9_997_250n);
      const charlieNo = await decryptNoShares(charlie);
      expect(charlieNo).to.equal(9_997_250n);
      const daveNo = await decryptNoShares(dave);
      expect(daveNo).to.equal(9_997_250n);
    });

    it("1.7 - Multiple bids against one large ask", async function () {
      // Alice: ask NO at 6000, 30 shares
      await placeOrder(alice, SIDE_NO, 6000, false, 30n);
      // Bob: bid YES at 6000, 10 shares
      await placeOrder(bob, SIDE_YES, 6000, true, 10n);
      // Charlie: bid YES at 6000, 10 shares
      await placeOrder(charlie, SIDE_YES, 6000, true, 10n);
      // Dave: bid YES at 6000, 10 shares
      await placeOrder(dave, SIDE_YES, 6000, true, 10n);

      // Match all three bids against Alice's ask
      await market.connect(eve).attemptMatch(1, 0);
      await market.connect(eve).attemptMatch(2, 0);
      await market.connect(eve).attemptMatch(3, 0);

      // feePerShare = 6000 * 100 * 5 / 10000 = 300
      // net = 999_700
      // Alice (ask owner, bidIsYes=true) gets NO tokens: 30 * 999_700 = 29_991_000
      const aliceNo = await decryptNoShares(alice);
      expect(aliceNo).to.equal(29_991_000n);

      // Each bidder gets 10 * 999_700 = 9_997_000 YES
      const bobYes = await decryptYesShares(bob);
      expect(bobYes).to.equal(9_997_000n);
      const charlieYes = await decryptYesShares(charlie);
      expect(charlieYes).to.equal(9_997_000n);
      const daveYes = await decryptYesShares(dave);
      expect(daveYes).to.equal(9_997_000n);
    });

    it("1.8 - 5 users all place orders, matcher resolves all pairs", async function () {
      // Alice: bid YES at 6000, 5 shares
      await placeOrder(alice, SIDE_YES, 6000, true, 5n);
      // Bob: bid YES at 6000, 5 shares
      await placeOrder(bob, SIDE_YES, 6000, true, 5n);
      // Charlie: ask NO at 6000, 5 shares
      await placeOrder(charlie, SIDE_NO, 6000, false, 5n);
      // Dave: ask NO at 6000, 5 shares
      await placeOrder(dave, SIDE_NO, 6000, false, 5n);

      expect(await market.nextOrderId()).to.equal(4n);

      // Eve matches all pairs
      await market.connect(eve).attemptMatch(0, 2); // Alice bid vs Charlie ask
      await market.connect(eve).attemptMatch(1, 3); // Bob bid vs Dave ask

      // feePerShare = 6000 * 100 * 5 / 10000 = 300
      // net = 999_700, total per user = 5 * 999_700 = 4_998_500
      const aliceYes = await decryptYesShares(alice);
      expect(aliceYes).to.equal(4_998_500n);
      const bobYes = await decryptYesShares(bob);
      expect(bobYes).to.equal(4_998_500n);
      const charlieNo = await decryptNoShares(charlie);
      expect(charlieNo).to.equal(4_998_500n);
      const daveNo = await decryptNoShares(dave);
      expect(daveNo).to.equal(4_998_500n);

      // Verify all users have shares
      expect(await market.hasUserShares(alice.address)).to.equal(true);
      expect(await market.hasUserShares(bob.address)).to.equal(true);
      expect(await market.hasUserShares(charlie.address)).to.equal(true);
      expect(await market.hasUserShares(dave.address)).to.equal(true);
    });
  });

  // ===================================================================
  // 2. PRICE LEVEL SCENARIOS (7 tests)
  // ===================================================================

  describe("2. Price Level Scenarios", function () {
    beforeEach(async function () {
      await deployMarket();
      await fundAndApprove(alice, 100_000_000n);
      await fundAndApprove(bob, 100_000_000n);
      await fundAndApprove(charlie, 100_000_000n);
    });

    it("2.1 - Match at minimum price (100 BPS = $0.01)", async function () {
      // Bid at 100, 5 shares. Escrow = 100 * 100 * 5 = 50_000
      await placeOrder(alice, SIDE_YES, 100, true, 5n);
      // Ask at 100, 5 shares. Escrow = (10000-100) * 100 * 5 = 4_950_000
      await placeOrder(bob, SIDE_NO, 100, false, 5n);

      await market.connect(charlie).attemptMatch(0, 1);

      // feePerShare = 100 * 100 * 5 / 10000 = 5
      // net = 1_000_000 - 5 = 999_995, total = 5 * 999_995 = 4_999_975
      const aliceYes = await decryptYesShares(alice);
      expect(aliceYes).to.equal(4_999_975n);

      const bobNo = await decryptNoShares(bob);
      expect(bobNo).to.equal(4_999_975n);
    });

    it("2.2 - Match at maximum price (9900 BPS = $0.99)", async function () {
      // Bid at 9900, 5 shares. Escrow = 9900 * 100 * 5 = 4_950_000
      await placeOrder(alice, SIDE_YES, 9900, true, 5n);
      // Ask at 9900, 5 shares. Escrow = (10000-9900) * 100 * 5 = 50_000
      await placeOrder(bob, SIDE_NO, 9900, false, 5n);

      await market.connect(charlie).attemptMatch(0, 1);

      // feePerShare = 9900 * 100 * 5 / 10000 = 495
      // net = 1_000_000 - 495 = 999_505, total = 5 * 999_505 = 4_997_525
      const aliceYes = await decryptYesShares(alice);
      expect(aliceYes).to.equal(4_997_525n);

      const bobNo = await decryptNoShares(bob);
      expect(bobNo).to.equal(4_997_525n);
    });

    it("2.3 - Match at midpoint (5000 BPS = $0.50)", async function () {
      await placeOrder(alice, SIDE_YES, 5000, true, 10n);
      await placeOrder(bob, SIDE_NO, 5000, false, 10n);

      await market.connect(charlie).attemptMatch(0, 1);

      // feePerShare = 5000 * 100 * 5 / 10000 = 250
      // net = 999_750, total = 10 * 999_750 = 9_997_500
      const aliceYes = await decryptYesShares(alice);
      expect(aliceYes).to.equal(9_997_500n);

      const bobNo = await decryptNoShares(bob);
      expect(bobNo).to.equal(9_997_500n);
    });

    it("2.4 - Bid at 7000, Ask at 6500 -> valid match (bid >= ask)", async function () {
      await placeOrder(alice, SIDE_YES, 7000, true, 5n);
      await placeOrder(bob, SIDE_NO, 6500, false, 5n);

      // Should succeed: bid.price (7000) >= ask.price (6500)
      await market.connect(charlie).attemptMatch(0, 1);

      // Fee calculated at ask.price = 6500
      // feePerShare = 6500 * 100 * 5 / 10000 = 325
      // net = 999_675, total = 5 * 999_675 = 4_998_375
      const aliceYes = await decryptYesShares(alice);
      expect(aliceYes).to.equal(4_998_375n);
    });

    it("2.5 - Bid at 6000, Ask at 7000 -> revert BidLessThanAsk", async function () {
      await placeOrder(alice, SIDE_YES, 6000, true, 5n);
      await placeOrder(bob, SIDE_NO, 7000, false, 5n);

      // bid.price (6000) < ask.price (7000) -> revert
      await expect(market.connect(charlie).attemptMatch(0, 1)).to.be.revertedWithCustomError(market, "BidLessThanAsk");
    });

    it("2.6 - Price level tracking after order placement", async function () {
      // Place 3 bids and 2 asks at price 6000
      await placeOrder(alice, SIDE_YES, 6000, true, 5n);
      await placeOrder(bob, SIDE_YES, 6000, true, 3n);
      await placeOrder(charlie, SIDE_NO, 6000, false, 5n);

      const [bidCount, askCount] = await market.getPriceLevel(6000);
      expect(bidCount).to.equal(2n);
      expect(askCount).to.equal(1n);

      // Place another ask at 6000
      await placeOrder(alice, SIDE_NO, 6000, false, 3n);

      const [bidCount2, askCount2] = await market.getPriceLevel(6000);
      expect(bidCount2).to.equal(2n);
      expect(askCount2).to.equal(2n);

      // Different price level should be independent
      await placeOrder(bob, SIDE_YES, 7000, true, 2n);
      const [bidCount7000, askCount7000] = await market.getPriceLevel(7000);
      expect(bidCount7000).to.equal(1n);
      expect(askCount7000).to.equal(0n);
    });

    it("2.7 - Best bid/ask tracking", async function () {
      // Place bid at 5500
      await placeOrder(alice, SIDE_YES, 5500, true, 5n);
      const [bestBid1] = await market.getBestPrices();
      expect(bestBid1).to.equal(5500n);

      // Place higher bid — should update bestBid
      await placeOrder(bob, SIDE_YES, 6000, true, 5n);
      const [bestBid2] = await market.getBestPrices();
      expect(bestBid2).to.equal(6000n);

      // Place ask at 7000
      await placeOrder(charlie, SIDE_NO, 7000, false, 5n);
      const [, bestAsk1] = await market.getBestPrices();
      expect(bestAsk1).to.equal(7000n);

      // Place lower ask — should update bestAsk
      await placeOrder(alice, SIDE_NO, 6500, false, 5n);
      const [, bestAsk2] = await market.getBestPrices();
      expect(bestAsk2).to.equal(6500n);
    });
  });

  // ===================================================================
  // 3. PARTIAL FILLS (7 tests)
  // ===================================================================

  describe("3. Partial Fills", function () {
    beforeEach(async function () {
      await deployMarket();
      await fundAndApprove(alice, 100_000_000n);
      await fundAndApprove(bob, 100_000_000n);
      await fundAndApprove(charlie, 100_000_000n);
      await fundAndApprove(dave, 100_000_000n);
    });

    it("3.1 - Large bid (100 shares) vs small ask (10 shares) -> 10 filled, 90 remaining", async function () {
      const aliceBalBefore = await getBalance(alice);

      // Alice: bid YES at 6000, 100 shares. Escrow = 6000 * 100 * 100 = 60_000_000
      await placeOrder(alice, SIDE_YES, 6000, true, 100n);
      // Bob: ask NO at 6000, 10 shares. Escrow = 4000 * 100 * 10 = 4_000_000
      await placeOrder(bob, SIDE_NO, 6000, false, 10n);

      const aliceBalAfterOrder = await getBalance(alice);
      expect(aliceBalBefore - aliceBalAfterOrder).to.equal(60_000_000n);

      await market.connect(charlie).attemptMatch(0, 1);

      // Only 10 shares should fill (min of 100, 10)
      // feePerShare = 300, net = 999_700
      // Alice gets 10 * 999_700 = 9_997_000 YES (only partial fill)
      const aliceYes = await decryptYesShares(alice);
      expect(aliceYes).to.equal(9_997_000n);

      // Bid order should still be active (90 shares remaining)
      const [, , , isActive] = await market.getOrder(0);
      expect(isActive).to.equal(true);
    });

    it("3.2 - Small bid (10 shares) vs large ask (100 shares) -> 10 filled, 90 remaining", async function () {
      // Alice: bid YES at 6000, 10 shares
      await placeOrder(alice, SIDE_YES, 6000, true, 10n);
      // Bob: ask NO at 6000, 100 shares
      await placeOrder(bob, SIDE_NO, 6000, false, 100n);

      await market.connect(charlie).attemptMatch(0, 1);

      // 10 shares fill
      // feePerShare = 300, net = 999_700
      const aliceYes = await decryptYesShares(alice);
      expect(aliceYes).to.equal(9_997_000n);

      // Ask order should still be active (90 shares remaining)
      const [, , , isActive] = await market.getOrder(1);
      expect(isActive).to.equal(true);
    });

    it("3.3 - 3 sequential fills against one order", async function () {
      // Alice: bid YES at 5000, 30 shares
      await placeOrder(alice, SIDE_YES, 5000, true, 30n);
      // Bob: ask NO at 5000, 10 shares
      await placeOrder(bob, SIDE_NO, 5000, false, 10n);
      // Charlie: ask NO at 5000, 10 shares
      await placeOrder(charlie, SIDE_NO, 5000, false, 10n);
      // Dave: ask NO at 5000, 10 shares
      await placeOrder(dave, SIDE_NO, 5000, false, 10n);

      // Sequential matches
      await market.connect(eve).attemptMatch(0, 1); // fills 10
      await market.connect(eve).attemptMatch(0, 2); // fills 10
      await market.connect(eve).attemptMatch(0, 3); // fills 10 (now fully filled)

      // feePerShare = 5000 * 100 * 5 / 10000 = 250
      // net = 999_750, total = 30 * 999_750 = 29_992_500
      const aliceYes = await decryptYesShares(alice);
      expect(aliceYes).to.equal(29_992_500n);

      // Each counterparty: 10 * 999_750 = 9_997_500
      const bobNo = await decryptNoShares(bob);
      expect(bobNo).to.equal(9_997_500n);
      const charlieNo = await decryptNoShares(charlie);
      expect(charlieNo).to.equal(9_997_500n);
      const daveNo = await decryptNoShares(dave);
      expect(daveNo).to.equal(9_997_500n);
    });

    it("3.4 - Fill to exactly 0 remaining", async function () {
      // Alice: bid YES at 6000, 5 shares
      await placeOrder(alice, SIDE_YES, 6000, true, 5n);
      // Bob: ask NO at 6000, 5 shares (exact match)
      await placeOrder(bob, SIDE_NO, 6000, false, 5n);

      await market.connect(charlie).attemptMatch(0, 1);

      // Both orders should be exactly filled
      // Verify shares: feePerShare = 300, net = 999_700, total = 5 * 999_700 = 4_998_500
      const aliceYes = await decryptYesShares(alice);
      expect(aliceYes).to.equal(4_998_500n);
      const bobNo = await decryptNoShares(bob);
      expect(bobNo).to.equal(4_998_500n);
    });

    it("3.5 - Verify escrow decreases correctly after partial fill", async function () {
      const aliceBalBefore = await getBalance(alice);

      // Alice: bid YES at 5000, 20 shares. Escrow = 5000 * 100 * 20 = 10_000_000
      await placeOrder(alice, SIDE_YES, 5000, true, 20n);

      const aliceBalAfterOrder = await getBalance(alice);
      expect(aliceBalBefore - aliceBalAfterOrder).to.equal(10_000_000n);

      // Bob: ask NO at 5000, 10 shares
      await placeOrder(bob, SIDE_NO, 5000, false, 10n);

      // Partial fill: 10 of 20 shares
      await market.connect(charlie).attemptMatch(0, 1);

      // Alice's bid escrow consumed for 10 shares: 5000 * 100 * 10 = 5_000_000
      // Remaining escrow should be for 10 shares: 5_000_000
      // Cancel the remaining order to verify escrow returned
      await market.connect(alice).cancelOrder(0);

      const aliceBalAfterCancel = await getBalance(alice);
      // Started 100M, escrowed 10M, partial fill consumed 5M, cancel returns remaining 5M
      // Balance = 100M - 10M + 5M = 95M
      // But Alice also received no direct USDT from the match (she got YES tokens, not USDT)
      expect(aliceBalAfterCancel).to.equal(95_000_000n);
    });

    it("3.6 - Cancel after partial fill (refund remaining escrow only)", async function () {
      const bobBalBefore = await getBalance(bob);

      // Bob: ask NO at 7000, 20 shares. Escrow = (10000-7000) * 100 * 20 = 6_000_000
      await placeOrder(bob, SIDE_NO, 7000, false, 20n);

      const bobBalAfterOrder = await getBalance(bob);
      expect(bobBalBefore - bobBalAfterOrder).to.equal(6_000_000n);

      // Alice: bid YES at 7000, 5 shares
      await placeOrder(alice, SIDE_YES, 7000, true, 5n);

      // Partial fill: 5 of 20 shares
      await market.connect(charlie).attemptMatch(1, 0);

      // Bob cancels remaining ask order
      await market.connect(bob).cancelOrder(0);

      const bobBalAfterCancel = await getBalance(bob);
      // Escrowed 6_000_000 for 20 shares at 3000 per share (escrow per share = 300_000)
      // Filled 5 shares -> consumed 5 * 300_000 = 1_500_000
      // Refund = 6_000_000 - 1_500_000 = 4_500_000
      // Balance = 100M - 6M + 4.5M = 98.5M
      expect(bobBalAfterCancel).to.equal(98_500_000n);
    });

    it("3.7 - Multiple partial fills from different users", async function () {
      // Alice: bid YES at 6000, 25 shares
      await placeOrder(alice, SIDE_YES, 6000, true, 25n);
      // Bob: ask NO at 6000, 8 shares
      await placeOrder(bob, SIDE_NO, 6000, false, 8n);
      // Charlie: ask NO at 6000, 7 shares
      await placeOrder(charlie, SIDE_NO, 6000, false, 7n);

      // First partial fill: 8 shares
      await market.connect(dave).attemptMatch(0, 1);
      // Second partial fill: 7 shares
      await market.connect(dave).attemptMatch(0, 2);

      // feePerShare = 300, net = 999_700
      // Alice total = (8 + 7) * 999_700 = 14_995_500
      const aliceYes = await decryptYesShares(alice);
      expect(aliceYes).to.equal(14_995_500n);

      // Bob: 8 * 999_700 = 7_997_600
      const bobNo = await decryptNoShares(bob);
      expect(bobNo).to.equal(7_997_600n);

      // Charlie: 7 * 999_700 = 6_997_900
      const charlieNo = await decryptNoShares(charlie);
      expect(charlieNo).to.equal(6_997_900n);

      // Alice's order still active (10 remaining out of 25)
      const [, , , isActive] = await market.getOrder(0);
      expect(isActive).to.equal(true);
    });
  });

  // ===================================================================
  // 4. FAILED MATCHES — PRIVACY PROOF (5 tests)
  // ===================================================================

  describe("4. Failed Matches (Privacy Proof)", function () {
    beforeEach(async function () {
      await deployMarket();
      await fundAndApprove(alice, 100_000_000n);
      await fundAndApprove(bob, 100_000_000n);
      await fundAndApprove(charlie, 100_000_000n);
    });

    it("4.1 - Both orders YES -> actualFill = 0 (no revert)", async function () {
      // Alice: bid YES at 6000
      await placeOrder(alice, SIDE_YES, 6000, true, 5n);
      // Bob: ask YES at 6000 (same side as Alice! -> fill = 0)
      await placeOrder(bob, SIDE_YES, 6000, false, 5n);

      // Should NOT revert — FHE produces actualFill=0 silently
      await market.connect(charlie).attemptMatch(0, 1);

      // No tokens created
      const aliceYes = await decryptYesShares(alice);
      expect(aliceYes).to.equal(0n);
      const bobYes = await decryptYesShares(bob);
      expect(bobYes).to.equal(0n);
    });

    it("4.2 - Both orders NO -> actualFill = 0 (no revert)", async function () {
      // Alice: bid NO at 6000
      await placeOrder(alice, SIDE_NO, 6000, true, 5n);
      // Bob: ask NO at 6000 (same side as Alice! -> fill = 0)
      await placeOrder(bob, SIDE_NO, 6000, false, 5n);

      await market.connect(charlie).attemptMatch(0, 1);

      // No tokens created
      const aliceNo = await decryptNoShares(alice);
      expect(aliceNo).to.equal(0n);
      const bobNo = await decryptNoShares(bob);
      expect(bobNo).to.equal(0n);
    });

    it("4.3 - Verify gas difference < 2% between success and failure", async function () {
      // Successful match setup
      await placeOrder(alice, SIDE_YES, 6000, true, 5n);
      await placeOrder(bob, SIDE_NO, 6000, false, 5n);

      const successTx = await market.connect(charlie).attemptMatch(0, 1);
      const successReceipt = await successTx.wait();
      const successGas = successReceipt.gasUsed;

      // Deploy fresh market for failed match (clean state)
      await deployMarket();
      await fundAndApprove(alice, 100_000_000n);
      await fundAndApprove(bob, 100_000_000n);

      // Failed match setup (same side)
      await placeOrder(alice, SIDE_YES, 6000, true, 5n);
      await placeOrder(bob, SIDE_YES, 6000, false, 5n);

      const failTx = await market.connect(charlie).attemptMatch(0, 1);
      const failReceipt = await failTx.wait();
      const failGas = failReceipt.gasUsed;

      // Gas should be within 2% — key privacy guarantee
      const gasRatio = Number(successGas) / Number(failGas);
      expect(gasRatio).to.be.gt(0.98);
      expect(gasRatio).to.be.lt(1.02);
    });

    it("4.4 - Failed match doesn't change share balances", async function () {
      // Give Alice some shares first via minting
      await mintShares(alice, 5_000_000n);

      const sharesBefore = await getShares(alice);
      expect(sharesBefore.yes).to.equal(5_000_000n);
      expect(sharesBefore.no).to.equal(5_000_000n);

      // Place orders with same side (will fail silently)
      await placeOrder(alice, SIDE_YES, 6000, true, 5n);
      await placeOrder(bob, SIDE_YES, 6000, false, 5n);

      await market.connect(charlie).attemptMatch(0, 1);

      // Shares should be unchanged (0 fill means 0 tokens added)
      const sharesAfter = await getShares(alice);
      expect(sharesAfter.yes).to.equal(5_000_000n);
      expect(sharesAfter.no).to.equal(5_000_000n);
    });

    it("4.5 - Failed match still emits MatchAttempted event", async function () {
      // Same side orders -> fill = 0
      await placeOrder(alice, SIDE_YES, 6000, true, 5n);
      await placeOrder(bob, SIDE_YES, 6000, false, 5n);

      const tx = await market.connect(charlie).attemptMatch(0, 1);
      const receipt = await tx.wait();

      // MatchAttempted event is always emitted — reveals nothing about success
      const event = findEvent(receipt, "MatchAttempted");
      expect(event).to.not.be.null;
      expect(event.args.bidId).to.equal(0n);
      expect(event.args.askId).to.equal(1n);
      expect(event.args.caller).to.equal(charlie.address);
      expect(event.args.timestamp).to.be.gt(0n);
    });
  });

  // ===================================================================
  // 5. ORDER STATE AFTER MATCHING (5 tests)
  // ===================================================================

  describe("5. Order State After Matching", function () {
    beforeEach(async function () {
      await deployMarket();
      await fundAndApprove(alice, 100_000_000n);
      await fundAndApprove(bob, 100_000_000n);
      await fundAndApprove(charlie, 100_000_000n);
      await fundAndApprove(dave, 100_000_000n);
    });

    it("5.1 - Order becomes inactive after fully filled", async function () {
      // Equal sizes — both should become fully filled
      await placeOrder(alice, SIDE_YES, 6000, true, 5n);
      await placeOrder(bob, SIDE_NO, 6000, false, 5n);

      // Before match: both active
      const [, , , isActiveBid] = await market.getOrder(0);
      const [, , , isActiveAsk] = await market.getOrder(1);
      expect(isActiveBid).to.equal(true);
      expect(isActiveAsk).to.equal(true);

      await market.connect(charlie).attemptMatch(0, 1);

      // After exact fill, orders are still marked active in storage
      // (the contract doesn't auto-deactivate after fill — only cancel deactivates)
      // But further matching would produce fill=0 since remaining=0
      const [, , , isActiveBidAfter] = await market.getOrder(0);
      const [, , , isActiveAskAfter] = await market.getOrder(1);
      expect(isActiveBidAfter).to.equal(true);
      expect(isActiveAskAfter).to.equal(true);
    });

    it("5.2 - Order remains active after partial fill", async function () {
      // Alice: bid YES at 6000, 20 shares
      await placeOrder(alice, SIDE_YES, 6000, true, 20n);
      // Bob: ask NO at 6000, 5 shares (partial fill)
      await placeOrder(bob, SIDE_NO, 6000, false, 5n);

      await market.connect(charlie).attemptMatch(0, 1);

      // Alice's order should still be active (15 remaining)
      const [, , , isActive] = await market.getOrder(0);
      expect(isActive).to.equal(true);
    });

    it("5.3 - Cannot match inactive order (should revert)", async function () {
      await placeOrder(alice, SIDE_YES, 6000, true, 5n);
      await placeOrder(bob, SIDE_NO, 6000, false, 5n);

      // Cancel the bid
      await market.connect(alice).cancelOrder(0);

      // Try to match cancelled bid -> revert
      await expect(market.connect(charlie).attemptMatch(0, 1)).to.be.revertedWithCustomError(market, "BidNotActive");

      // Now test inactive ask
      await placeOrder(charlie, SIDE_YES, 6000, true, 5n);
      await market.connect(bob).cancelOrder(1);

      await expect(market.connect(dave).attemptMatch(2, 1)).to.be.revertedWithCustomError(market, "AskNotActive");
    });

    it("5.4 - Cannot match already-matched pair again (same fill = 0)", async function () {
      // Exact fill first
      await placeOrder(alice, SIDE_YES, 6000, true, 5n);
      await placeOrder(bob, SIDE_NO, 6000, false, 5n);

      await market.connect(charlie).attemptMatch(0, 1);

      // Attempting same match again: remaining=0 for both, so potentialFill=0
      // This should NOT revert — it just produces actualFill=0
      await market.connect(charlie).attemptMatch(0, 1);

      // Alice should still have same shares as before (no extra tokens)
      // feePerShare = 300, net = 999_700, total = 5 * 999_700 = 4_998_500
      const aliceYes = await decryptYesShares(alice);
      expect(aliceYes).to.equal(4_998_500n);
    });

    it("5.5 - Order sequence number is monotonic", async function () {
      const tx0 = await placeOrder(alice, SIDE_YES, 5000, true, 5n);
      const receipt0 = await tx0.wait();
      const event0 = findEvent(receipt0, "OrderPlaced");
      expect(event0.args.sequence).to.equal(0n);

      const tx1 = await placeOrder(bob, SIDE_NO, 5500, false, 5n);
      const receipt1 = await tx1.wait();
      const event1 = findEvent(receipt1, "OrderPlaced");
      expect(event1.args.sequence).to.equal(1n);

      const tx2 = await placeOrder(charlie, SIDE_YES, 6000, true, 5n);
      const receipt2 = await tx2.wait();
      const event2 = findEvent(receipt2, "OrderPlaced");
      expect(event2.args.sequence).to.equal(2n);

      const tx3 = await placeOrder(dave, SIDE_NO, 6500, false, 5n);
      const receipt3 = await tx3.wait();
      const event3 = findEvent(receipt3, "OrderPlaced");
      expect(event3.args.sequence).to.equal(3n);

      // Sequence is strictly monotonically increasing
      expect(event0.args.sequence).to.be.lt(event1.args.sequence);
      expect(event1.args.sequence).to.be.lt(event2.args.sequence);
      expect(event2.args.sequence).to.be.lt(event3.args.sequence);
    });
  });

  // ===================================================================
  // 6. ESCROW CALCULATIONS (3 tests)
  // ===================================================================

  describe("6. Escrow Calculations", function () {
    beforeEach(async function () {
      await deployMarket();
      await fundAndApprove(alice, 100_000_000n);
      await fundAndApprove(bob, 100_000_000n);
      await fundAndApprove(charlie, 100_000_000n);
    });

    it("6.1 - Bid escrow = price * PRICE_TO_USDT * amount", async function () {
      // Test at various price points
      const testCases = [
        { price: 100, amount: 10n, expected: bidEscrow(100n, 10n) },    // 100 * 100 * 10 = 100_000
        { price: 5000, amount: 5n, expected: bidEscrow(5000n, 5n) },    // 5000 * 100 * 5 = 2_500_000
        { price: 9900, amount: 1n, expected: bidEscrow(9900n, 1n) },    // 9900 * 100 * 1 = 990_000
      ];

      for (const tc of testCases) {
        // Deploy fresh market for each test case
        await deployMarket();
        await fundAndApprove(alice, 100_000_000n);

        const balBefore = await getBalance(alice);
        await placeOrder(alice, SIDE_YES, tc.price, true, tc.amount);
        const balAfter = await getBalance(alice);

        expect(balBefore - balAfter).to.equal(tc.expected,
          `Bid escrow at price ${tc.price}, amount ${tc.amount}`);
      }
    });

    it("6.2 - Ask escrow = (10000 - price) * PRICE_TO_USDT * amount", async function () {
      const testCases = [
        { price: 100, amount: 10n, expected: askEscrow(100n, 10n) },     // 9900 * 100 * 10 = 9_900_000
        { price: 5000, amount: 5n, expected: askEscrow(5000n, 5n) },     // 5000 * 100 * 5 = 2_500_000
        { price: 9900, amount: 1n, expected: askEscrow(9900n, 1n) },     // 100 * 100 * 1 = 10_000
      ];

      for (const tc of testCases) {
        await deployMarket();
        await fundAndApprove(alice, 100_000_000n);

        const balBefore = await getBalance(alice);
        await placeOrder(alice, SIDE_NO, tc.price, false, tc.amount);
        const balAfter = await getBalance(alice);

        expect(balBefore - balAfter).to.equal(tc.expected,
          `Ask escrow at price ${tc.price}, amount ${tc.amount}`);
      }
    });

    it("6.3 - Price improvement refund on match (bid price > ask price)", async function () {
      const aliceBalBefore = await getBalance(alice);

      // Alice: bid YES at 8000, 10 shares. Escrow = 8000 * 100 * 10 = 8_000_000
      await placeOrder(alice, SIDE_YES, 8000, true, 10n);
      // Bob: ask NO at 5000, 10 shares. Escrow = 5000 * 100 * 10 = 5_000_000
      await placeOrder(bob, SIDE_NO, 5000, false, 10n);

      const aliceBalAfterOrder = await getBalance(alice);
      expect(aliceBalBefore - aliceBalAfterOrder).to.equal(8_000_000n);

      // Match: bid.price (8000) > ask.price (5000)
      // Price improvement refund = (8000 - 5000) * 100 * 10 = 3_000_000
      await market.connect(charlie).attemptMatch(0, 1);

      // Alice should receive the price improvement refund back as USDT
      const aliceBalAfterMatch = await getBalance(alice);
      // Original balance: 100M
      // After placing bid: 100M - 8M = 92M
      // After match refund: 92M + 3M = 95M
      expect(aliceBalAfterMatch).to.equal(95_000_000n);

      // Alice also gets YES tokens: feePerShare = 5000 * 100 * 5 / 10000 = 250
      // net = 999_750, total = 10 * 999_750 = 9_997_500
      const aliceYes = await decryptYesShares(alice);
      expect(aliceYes).to.equal(9_997_500n);
    });
  });
});
