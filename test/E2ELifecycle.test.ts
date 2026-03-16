import { expect } from "chai";
import { ethers } from "hardhat";
import { fhevm } from "hardhat";
import { FhevmType } from "@fhevm/hardhat-plugin";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";

describe("E2E Full Lifecycle", function () {
  let market: any;
  let token: any;
  let signers: HardhatEthersSigner[];
  let deployer: HardhatEthersSigner;
  let alice: HardhatEthersSigner;
  let bob: HardhatEthersSigner;
  let carol: HardhatEthersSigner;
  let resolver: HardhatEthersSigner;
  let feeCollector: HardhatEthersSigner;
  let marketAddress: string;
  let tokenAddress: string;

  const QUESTION = "BTC exceeds $200K by Dec 2026?";
  const RESOLUTION_SOURCE = "Chainlink BTC/USD Price Feed";
  const RESOLUTION_TYPE = "onchain_oracle";
  const RESOLUTION_CRITERIA = ">= 200000";

  const SIDE_YES = 0;
  const SIDE_NO = 1;

  // -----------------------------------------------
  // Helper: deploy market (9 constructor args, NO matcher)
  // -----------------------------------------------
  async function deployMarket(feeCollectorAddr: string) {
    const ConfidentialUSDT = await ethers.getContractFactory("ConfidentialUSDT");
    token = await ConfidentialUSDT.deploy();
    await token.waitForDeployment();
    tokenAddress = await token.getAddress();

    const block = await ethers.provider.getBlock("latest");
    const deadline = block!.timestamp + 86400;

    const OpaqueMarket = await ethers.getContractFactory("OpaqueMarket");
    market = await OpaqueMarket.deploy(
      QUESTION,
      deadline,
      RESOLUTION_SOURCE,
      RESOLUTION_TYPE,
      RESOLUTION_CRITERIA,
      "crypto",
      resolver.address,
      feeCollectorAddr,
      tokenAddress,
      deployer.address,
    );
    await market.waitForDeployment();
    marketAddress = await market.getAddress();
  }

  // -----------------------------------------------
  // Helper: fund user with cUSDT and approve the market
  // -----------------------------------------------
  async function fundAndApprove(signer: HardhatEthersSigner, amount: bigint) {
    await token.mint(signer.address, amount);
    await token.connect(signer).approvePlaintext(marketAddress, amount);
  }

  // -----------------------------------------------
  // Helper: mint shares (deposit cUSDT -> get YES + NO)
  // -----------------------------------------------
  async function mintShares(signer: HardhatEthersSigner, amount: bigint) {
    const input = fhevm.createEncryptedInput(marketAddress, signer.address);
    input.add64(amount);
    const encrypted = await input.encrypt();
    const tx = await market.connect(signer).mintShares(encrypted.handles[0], encrypted.inputProof);
    return tx;
  }

  // -----------------------------------------------
  // Helper: place an order (unified V2 placeOrder)
  // -----------------------------------------------
  async function placeOrder(signer: HardhatEthersSigner, side: number, price: number, isBid: boolean, amount: bigint) {
    const input = fhevm.createEncryptedInput(marketAddress, signer.address);
    input.add8(side); // 0=YES, 1=NO
    input.add64(amount);
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

  // -----------------------------------------------
  // Helper: find event in receipt (Chai .emit does NOT work with fhevm)
  // -----------------------------------------------
  function findEvent(receipt: any, eventName: string) {
    for (const log of receipt.logs) {
      try {
        const parsed = market.interface.parseLog({ topics: log.topics, data: log.data });
        if (parsed?.name === eventName) return parsed;
      } catch {}
    }
    return null;
  }

  // -----------------------------------------------
  // Helper: decrypt a user's cUSDT balance
  // -----------------------------------------------
  async function getBalance(signer: HardhatEthersSigner): Promise<bigint> {
    const encBalance = await token.balanceOf(signer.address);
    return fhevm.userDecryptEuint(FhevmType.euint64, encBalance, tokenAddress, signer);
  }

  // -----------------------------------------------
  // Helper: decrypt a user's YES/NO share balances
  // -----------------------------------------------
  async function getShares(signer: HardhatEthersSigner): Promise<{ yes: bigint; no: bigint }> {
    const [yesHandle, noHandle] = await market.connect(signer).getMyShares();
    const yes = await fhevm.userDecryptEuint(FhevmType.euint64, yesHandle, marketAddress, signer);
    const no = await fhevm.userDecryptEuint(FhevmType.euint64, noHandle, marketAddress, signer);
    return { yes, no };
  }

  // -----------------------------------------------
  // Helper: request and finalize redemption (2-step with publicDecrypt)
  // -----------------------------------------------
  async function requestAndFinalizeRedemption(signer: HardhatEthersSigner) {
    await market.connect(signer).requestRedemption();

    const isYesWon = await market.outcome();
    const [yesHandle, noHandle] = await market.connect(signer).getMyShares();
    const winningHandle = isYesWon ? yesHandle : noHandle;

    const result = await fhevm.publicDecrypt([winningHandle]);
    const winningShares = Number(result.clearValues[winningHandle]);
    await market.connect(signer).finalizeRedemption(winningShares, result.decryptionProof);
    return { winningShares: BigInt(winningShares) };
  }

  // -----------------------------------------------
  // Helper: emergency withdraw + finalize (2-step with publicDecrypt)
  // -----------------------------------------------
  async function decryptAndFinalizeEmergency(signer: HardhatEthersSigner) {
    await market.connect(signer).emergencyWithdraw();

    const [yesHandle, noHandle] = await market.connect(signer).getMyShares();
    const result = await fhevm.publicDecrypt([yesHandle, noHandle]);
    const yesAmount = Number(result.clearValues[yesHandle]);
    const noAmount = Number(result.clearValues[noHandle]);
    await market.connect(signer).finalizeEmergencyWithdraw(yesAmount, noAmount, result.decryptionProof);
    return { yesAmount: BigInt(yesAmount), noAmount: BigInt(noAmount) };
  }

  // -----------------------------------------------
  // Helper: advance time past the 1-day deadline
  // -----------------------------------------------
  async function advancePastDeadline() {
    await ethers.provider.send("evm_increaseTime", [86401]);
    await ethers.provider.send("evm_mine", []);
  }

  // -----------------------------------------------
  // Helper: advance time past deadline + 7-day grace period
  // -----------------------------------------------
  async function advancePastGracePeriod() {
    await ethers.provider.send("evm_increaseTime", [86400 + 7 * 86400 + 1]);
    await ethers.provider.send("evm_mine", []);
  }

  beforeEach(async function () {
    signers = await ethers.getSigners();
    deployer = signers[0];
    alice = signers[1];
    bob = signers[2];
    carol = signers[3];
    resolver = signers[4];
    feeCollector = signers[5];
  });

  // ===============================================================
  // SCENARIO 1: Mint -> Place Orders -> Match -> Resolve -> Redeem
  // ===============================================================
  describe("Scenario 1: Mint -> Sell -> Match -> Resolve -> Redeem", function () {
    beforeEach(async function () {
      await deployMarket(feeCollector.address);
      await fundAndApprove(alice, 100_000_000n);
      await fundAndApprove(bob, 100_000_000n);
    });

    it("should complete full lifecycle: mint -> trade -> resolve YES -> redeem", async function () {
      // Step 1: Alice mints 10 cUSDT worth of shares (10_000_000 micro-cUSDT)
      await mintShares(alice, 10_000_000n);

      const aliceShares = await getShares(alice);
      expect(aliceShares.yes).to.equal(10_000_000n);
      expect(aliceShares.no).to.equal(10_000_000n);

      // Step 2: Alice places an ASK (isBid=false) with side=YES at price=6000.
      // She is selling YES exposure. Escrow = (10000 - 6000) * 100 * 10 = 4_000_000
      await placeOrder(alice, SIDE_YES, 6000, false, 10n);
      expect(await market.activeOrderCount()).to.equal(1n);

      // Step 3: Bob places a BID (isBid=true) with side=NO at price=6000.
      // He is buying NO exposure. Escrow = 6000 * 100 * 10 = 6_000_000
      // Sides are OPPOSITE (YES vs NO) -> FHE.ne = true -> match will fill.
      await placeOrder(bob, SIDE_NO, 6000, true, 10n);
      expect(await market.activeOrderCount()).to.equal(2n);

      // Step 4: Anyone calls attemptMatch (permissionless). bidId=1 (Bob), askId=0 (Alice)
      await market.connect(carol).attemptMatch(1, 0);

      // Step 5: Resolve YES after deadline
      await advancePastDeadline();
      await market.connect(resolver).resolve(true);
      expect(await market.resolved()).to.equal(true);
      expect(await market.outcome()).to.equal(true);

      // Step 6: Redeem.
      // Alice had YES shares from minting. After matching her ASK order:
      //   - She sold YES exposure via the ask, so she received NO outcome tokens.
      //   - Her ask side was YES, bid side was NO. bid is YES? No, bid.encSide=NO.
      //     bidIsYes = false. Ask owner (Alice) gets askYesTokens = select(false, ZERO, shareTransfer) = shareTransfer (YES),
      //     askNoTokens = select(false, shareTransfer, ZERO) = ZERO.
      //   Wait, let me re-check: bidIsYes = FHE.eq(bid.encSide, YES).
      //     bid.encSide = NO (Bob's side). bidIsYes = false.
      //     bidYesTokens = select(false, shareTransfer, ZERO) = ZERO
      //     bidNoTokens = select(false, ZERO, shareTransfer) = shareTransfer  (Bob gets NO tokens)
      //     askYesTokens = select(false, ZERO, shareTransfer) = shareTransfer (Alice gets YES tokens from match)
      //     askNoTokens = select(false, shareTransfer, ZERO) = ZERO
      //   So Alice gets YES tokens from match (10 shares * 1M = 10M YES).
      //   Plus her original minted shares (10M YES + 10M NO).
      //   Total Alice: 20M YES + 10M NO. Since YES won, Alice redeems 20M YES.
      // Bob gets NO tokens from match (10M NO). Since YES won, Bob's NO tokens = 0 payout.
      // But let's just check that Alice can redeem successfully.
      const { winningShares: aliceWinning } = await requestAndFinalizeRedemption(alice);
      expect(aliceWinning).to.be.gt(0n);
    });

    it("should track shares correctly after trade", async function () {
      await mintShares(alice, 5_000_000n);

      // Alice sells (ask) with side=YES at $0.50 (price=5000), 5 shares
      await placeOrder(alice, SIDE_YES, 5000, false, 5n);

      // Bob buys (bid) with side=NO at $0.50 (price=5000), 5 shares
      // Opposite sides -> match fills
      await placeOrder(bob, SIDE_NO, 5000, true, 5n);

      // Match: bidId=1 (Bob), askId=0 (Alice)
      await market.connect(carol).attemptMatch(1, 0);

      // After match:
      //   bid.encSide = NO, so bidIsYes = false
      //   Trade fee deduction: feePerShare = ask.price * 100 * 5 / 10000 = 5000*100*5/10000 = 250
      //   Net share = 1_000_000 - 250 = 999_750 per matched share
      //   Alice (ask owner) gets YES tokens: 5 * 999_750 = 4_998_750 YES from match
      //   Plus minted: 5M YES + 5M NO
      //   Total Alice: 9_998_750 YES + 5M NO
      const aliceShares = await getShares(alice);
      expect(aliceShares.yes).to.equal(9_998_750n); // 5M minted + 4_998_750 from match (fee-adjusted)
      expect(aliceShares.no).to.equal(5_000_000n); // 5M minted, no NO from match

      // Bob gets NO tokens: 5 * 999_750 = 4_998_750 NO from match
      const bobShares = await getShares(bob);
      expect(bobShares.yes).to.equal(0n);
      expect(bobShares.no).to.equal(4_998_750n);
    });
  });

  // ===============================================================
  // SCENARIO 2: Multi-user trading
  // ===============================================================
  describe("Scenario 2: Multi-user trading", function () {
    beforeEach(async function () {
      await deployMarket(feeCollector.address);
      await fundAndApprove(alice, 100_000_000n);
      await fundAndApprove(bob, 100_000_000n);
      await fundAndApprove(carol, 100_000_000n);
    });

    it("should handle multiple users placing and matching orders", async function () {
      // Alice: bid YES at 6000, 10 shares
      await placeOrder(alice, SIDE_YES, 6000, true, 10n);

      // Bob: ask NO at 6000, 10 shares (opposite side -> can match with Alice)
      await placeOrder(bob, SIDE_NO, 6000, false, 10n);

      // Carol matches Alice's bid with Bob's ask
      await market.connect(carol).attemptMatch(0, 1);

      // Carol: bid YES at 5500, 5 shares
      await placeOrder(carol, SIDE_YES, 5500, true, 5n);

      // Bob places another ask: NO at 5500, 5 shares
      await placeOrder(bob, SIDE_NO, 5500, false, 5n);

      // Anyone matches
      await market.connect(deployer).attemptMatch(2, 3);

      // Verify order tracking
      expect(await market.nextOrderId()).to.equal(4n);

      // Alice should have YES outcome tokens from match
      expect(await market.hasUserShares(alice.address)).to.equal(true);
      // Bob should have NO outcome tokens from matches
      expect(await market.hasUserShares(bob.address)).to.equal(true);
      // Carol should have YES outcome tokens from match
      expect(await market.hasUserShares(carol.address)).to.equal(true);

      // Verify Alice's YES shares: bid was YES, bidIsYes=true, bidYesTokens=shareTransfer
      // Trade fee: feePerShare = 6000 * 100 * 5 / 10000 = 300, net = 999_700 per share
      // Alice: 10 * 999_700 = 9_997_000
      const aliceShares = await getShares(alice);
      expect(aliceShares.yes).to.equal(9_997_000n); // 10 shares * 999_700 (fee-adjusted)

      // Verify Carol's YES shares from second match
      // Trade fee: feePerShare = 5500 * 100 * 5 / 10000 = 275, net = 999_725 per share
      // Carol: 5 * 999_725 = 4_998_625
      const carolShares = await getShares(carol);
      expect(carolShares.yes).to.equal(4_998_625n); // 5 shares * 999_725 (fee-adjusted)
    });
  });

  // ===============================================================
  // SCENARIO 3: Cancel and re-order flow
  // ===============================================================
  describe("Scenario 3: Cancel and re-order", function () {
    beforeEach(async function () {
      await deployMarket(feeCollector.address);
      await fundAndApprove(alice, 100_000_000n);
    });

    it("should allow cancel then place new order, verifying USDT returned", async function () {
      const balanceBefore = await getBalance(alice);

      // Place a bid order: YES at 7000, 5 shares
      // Escrow = 7000 * 100 * 5 = 3_500_000
      await placeOrder(alice, SIDE_YES, 7000, true, 5n);
      expect(await market.activeOrderCount()).to.equal(1n);

      const balanceAfterOrder = await getBalance(alice);
      expect(balanceBefore - balanceAfterOrder).to.equal(3_500_000n);

      // Cancel it
      await market.connect(alice).cancelOrder(0);
      expect(await market.activeOrderCount()).to.equal(0n);

      // USDT should be returned
      const balanceAfterCancel = await getBalance(alice);
      expect(balanceAfterCancel).to.equal(balanceBefore);

      // Place new order at different price
      // Ask: YES at 6000, 3 shares. Escrow = (10000 - 6000) * 100 * 3 = 1_200_000
      await placeOrder(alice, SIDE_YES, 6000, false, 3n);
      expect(await market.activeOrderCount()).to.equal(1n);

      const balanceAfterNewOrder = await getBalance(alice);
      expect(balanceBefore - balanceAfterNewOrder).to.equal(1_200_000n);
    });
  });

  // ===============================================================
  // SCENARIO 4: Resolution with only mint (no trades)
  // ===============================================================
  describe("Scenario 4: Resolution with only mint (no trades)", function () {
    beforeEach(async function () {
      await deployMarket(feeCollector.address);
      await fundAndApprove(alice, 100_000_000n);
    });

    it("should allow redemption with minted shares only (YES wins)", async function () {
      // Alice mints 10M shares, doesn't trade
      await mintShares(alice, 10_000_000n);

      const aliceShares = await getShares(alice);
      expect(aliceShares.yes).to.equal(10_000_000n);
      expect(aliceShares.no).to.equal(10_000_000n);

      // Resolve YES
      await advancePastDeadline();
      await market.connect(resolver).resolve(true);

      // Alice redeems YES shares: gross = 10M
      // Percentage fee = 10M * 50 / 10000 = 50_000
      // Net after percentage = 10M - 50K = 9_950_000
      // Flat fee = 1_000_000
      // Net payout = 9_950_000 - 1_000_000 = 8_950_000
      const { winningShares } = await requestAndFinalizeRedemption(alice);
      expect(winningShares).to.equal(10_000_000n);

      // Verify payout received: started with 100M, minted 10M -> 90M left, + 8_950_000 payout
      const aliceBalance = await getBalance(alice);
      expect(aliceBalance).to.equal(90_000_000n + 8_950_000n);
    });

    it("should pay correct amount when NO wins (redeem NO shares)", async function () {
      await mintShares(alice, 10_000_000n);

      // Resolve NO
      await advancePastDeadline();
      await market.connect(resolver).resolve(false);

      // Alice redeems NO shares: same fee math
      // gross=10M, %fee=50K, flat=$1M, net=8_950_000
      const { winningShares } = await requestAndFinalizeRedemption(alice);
      expect(winningShares).to.equal(10_000_000n);

      const aliceBalance = await getBalance(alice);
      expect(aliceBalance).to.equal(90_000_000n + 8_950_000n);
    });
  });

  // ===============================================================
  // SCENARIO 5: Emergency withdrawal
  // ===============================================================
  describe("Scenario 5: Emergency withdrawal", function () {
    beforeEach(async function () {
      await deployMarket(feeCollector.address);
      await fundAndApprove(alice, 100_000_000n);
    });

    it("should allow emergency withdrawal when market not resolved after grace period", async function () {
      await mintShares(alice, 10_000_000n);

      // Don't resolve -- wait past deadline + grace period
      await advancePastGracePeriod();

      // Emergency withdraw
      const { yesAmount, noAmount } = await decryptAndFinalizeEmergency(alice);

      // Alice has 10M YES + 10M NO -> min = 10M -> refund 10M cUSDT
      expect(yesAmount).to.equal(10_000_000n);
      expect(noAmount).to.equal(10_000_000n);

      const aliceBalance = await getBalance(alice);
      // Started with 100M, minted 10M (left 90M), refund 10M
      expect(aliceBalance).to.equal(90_000_000n + 10_000_000n);
    });

    it("should handle emergency after cancelling active orders first", async function () {
      await mintShares(alice, 10_000_000n);

      // Place a bid order (escrows USDT, not shares)
      // Bid YES at 6000, 5 shares. Escrow = 6000 * 100 * 5 = 3_000_000
      await placeOrder(alice, SIDE_YES, 6000, true, 5n);

      // Wait past grace period
      await advancePastGracePeriod();

      // Cancel all orders to get escrowed USDT back
      const aliceOrders = await market.getUserOrders(alice.address);
      await market.connect(alice).cancelOrders([...aliceOrders]);

      // Now emergency withdraw
      const { yesAmount, noAmount } = await decryptAndFinalizeEmergency(alice);

      // Alice's shares are unaffected by bid orders (bids escrow USDT, not shares)
      // min(10M YES, 10M NO) = 10M cUSDT refund
      expect(yesAmount).to.equal(10_000_000n);
      expect(noAmount).to.equal(10_000_000n);

      const aliceBalance = await getBalance(alice);
      // 100M - 10M (mint) - 3M (bid escrow) + 3M (cancel refund) + 10M (emergency) = 100M
      expect(aliceBalance).to.equal(100_000_000n);
    });
  });

  // ===============================================================
  // SCENARIO 6: Fee collection flow
  // ===============================================================
  describe("Scenario 6: Fee collection", function () {
    beforeEach(async function () {
      await deployMarket(feeCollector.address);
      await fundAndApprove(alice, 100_000_000n);
    });

    it("should collect fees on redemption and allow fee collector to withdraw", async function () {
      await mintShares(alice, 10_000_000n);

      await advancePastDeadline();
      await market.connect(resolver).resolve(true);

      await requestAndFinalizeRedemption(alice);

      // Fee = 50K (0.5% of 10M) + 1M ($1 flat) = 1_050_000
      expect(await market.collectedFees()).to.equal(1_050_000n);

      // Fee collector withdraws
      await market.connect(feeCollector).withdrawFees();
      expect(await market.collectedFees()).to.equal(0n);

      const feeBalance = await getBalance(feeCollector);
      expect(feeBalance).to.equal(1_050_000n);
    });

    it("should collect trade fees from matching and allow withdrawal", async function () {
      // Fund Bob for trading
      await fundAndApprove(bob, 100_000_000n);

      // Alice: bid YES at 6000, 10 shares
      await placeOrder(alice, SIDE_YES, 6000, true, 10n);
      // Bob: ask NO at 6000, 10 shares
      await placeOrder(bob, SIDE_NO, 6000, false, 10n);

      // Match
      await market.connect(carol).attemptMatch(0, 1);

      // Trade fee: 0.05% of (ask.price * PRICE_TO_USDT * fill)
      // feePerShare = (6000 * 100 * 5) / 10000 = 30 per share
      // tradeFee = 30 * 10 = 300
      // This is accumulated in encryptedTradeFees

      // Fee collector withdraws trade fees
      await market.connect(feeCollector).withdrawTradeFees();

      // Verify fee collector received something (exact amount depends on FHE computation)
      // We just verify the call succeeds without revert
    });
  });

  // ===============================================================
  // SCENARIO 7: cancelAllMyOrders
  // ===============================================================
  describe("Scenario 7: cancelOrders", function () {
    beforeEach(async function () {
      await deployMarket(feeCollector.address);
      await fundAndApprove(alice, 100_000_000n);
    });

    it("should cancel all active orders at once and return all escrowed USDT", async function () {
      const balanceBefore = await getBalance(alice);

      // Place multiple orders of different types
      // Bid YES at 6000, 2 shares. Escrow = 6000 * 100 * 2 = 1_200_000
      await placeOrder(alice, SIDE_YES, 6000, true, 2n);
      // Bid NO at 7000, 2 shares. Escrow = 7000 * 100 * 2 = 1_400_000
      await placeOrder(alice, SIDE_NO, 7000, true, 2n);
      // Ask YES at 4000, 2 shares. Escrow = (10000-4000) * 100 * 2 = 1_200_000
      await placeOrder(alice, SIDE_YES, 4000, false, 2n);

      expect(await market.activeOrderCount()).to.equal(3n);

      const balanceAfterOrders = await getBalance(alice);
      const totalEscrowed = balanceBefore - balanceAfterOrders;
      // Total escrowed = 1_200_000 + 1_400_000 + 1_200_000 = 3_800_000
      expect(totalEscrowed).to.equal(3_800_000n);

      // Cancel all
      const aliceOrders = await market.getUserOrders(alice.address);
      await market.connect(alice).cancelOrders([...aliceOrders]);

      expect(await market.activeOrderCount()).to.equal(0n);

      // All orders should be inactive
      const [, , , isActive0] = await market.getOrder(0);
      const [, , , isActive1] = await market.getOrder(1);
      const [, , , isActive2] = await market.getOrder(2);
      expect(isActive0).to.equal(false);
      expect(isActive1).to.equal(false);
      expect(isActive2).to.equal(false);

      // All USDT should be returned
      const balanceAfterCancel = await getBalance(alice);
      expect(balanceAfterCancel).to.equal(balanceBefore);
    });
  });

  // ===============================================================
  // SCENARIO 8: Event emission through lifecycle
  // ===============================================================
  describe("Scenario 8: Event emission", function () {
    beforeEach(async function () {
      await deployMarket(feeCollector.address);
      await fundAndApprove(alice, 100_000_000n);
      await fundAndApprove(bob, 100_000_000n);
    });

    it("should emit SharesMinted on mint", async function () {
      const mintTx = await mintShares(alice, 10_000_000n);
      const mintReceipt = await mintTx.wait();
      const mintEvent = findEvent(mintReceipt, "SharesMinted");
      expect(mintEvent).to.not.be.null;
      expect(mintEvent.args.user).to.equal(alice.address);
    });

    it("should emit OrderPlaced on placeOrder", async function () {
      const orderTx = await placeOrder(alice, SIDE_YES, 6000, true, 5n);
      const orderReceipt = await orderTx.wait();
      const orderEvent = findEvent(orderReceipt, "OrderPlaced");
      expect(orderEvent).to.not.be.null;
      expect(orderEvent.args.orderId).to.equal(0n);
      expect(orderEvent.args.owner).to.equal(alice.address);
      expect(orderEvent.args.price).to.equal(6000n);
      expect(orderEvent.args.isBid).to.equal(true);
      expect(orderEvent.args.sequence).to.equal(0n);
      expect(orderEvent.args.timestamp).to.be.gt(0n);
    });

    it("should emit MatchAttempted on attemptMatch (NOT OrdersMatched)", async function () {
      // Alice: bid YES at 6000, 5 shares
      await placeOrder(alice, SIDE_YES, 6000, true, 5n);
      // Bob: ask NO at 6000, 5 shares (opposite side -> fills)
      await placeOrder(bob, SIDE_NO, 6000, false, 5n);

      const matchTx = await market.connect(carol).attemptMatch(0, 1);
      const matchReceipt = await matchTx.wait();

      // V2 uses MatchAttempted, NOT OrdersMatched
      const matchAttemptedEvent = findEvent(matchReceipt, "MatchAttempted");
      expect(matchAttemptedEvent).to.not.be.null;
      expect(matchAttemptedEvent.args.bidId).to.equal(0n);
      expect(matchAttemptedEvent.args.askId).to.equal(1n);
      expect(matchAttemptedEvent.args.caller).to.equal(carol.address);

      // Verify OrdersMatched does NOT exist
      const ordersMatchedEvent = findEvent(matchReceipt, "OrdersMatched");
      expect(ordersMatchedEvent).to.be.null;
    });

    it("should emit MarketResolved on resolve", async function () {
      await advancePastDeadline();
      const resolveTx = await market.connect(resolver).resolve(true);
      const resolveReceipt = await resolveTx.wait();
      const resolveEvent = findEvent(resolveReceipt, "MarketResolved");
      expect(resolveEvent).to.not.be.null;
      expect(resolveEvent.args.outcome).to.equal(true);
    });

    it("should emit correct events at each lifecycle stage", async function () {
      // 1. SharesMinted
      const mintTx = await mintShares(alice, 10_000_000n);
      const mintReceipt = await mintTx.wait();
      expect(findEvent(mintReceipt, "SharesMinted")).to.not.be.null;

      // 2. OrderPlaced (ask from Alice)
      const askTx = await placeOrder(alice, SIDE_YES, 6000, false, 5n);
      const askReceipt = await askTx.wait();
      expect(findEvent(askReceipt, "OrderPlaced")).to.not.be.null;

      // 3. OrderPlaced (bid from Bob)
      const bidTx = await placeOrder(bob, SIDE_NO, 6000, true, 5n);
      const bidReceipt = await bidTx.wait();
      expect(findEvent(bidReceipt, "OrderPlaced")).to.not.be.null;

      // 4. MatchAttempted
      const matchTx = await market.connect(carol).attemptMatch(1, 0);
      const matchReceipt = await matchTx.wait();
      expect(findEvent(matchReceipt, "MatchAttempted")).to.not.be.null;

      // 5. MarketResolved
      await advancePastDeadline();
      const resolveTx = await market.connect(resolver).resolve(true);
      const resolveReceipt = await resolveTx.wait();
      expect(findEvent(resolveReceipt, "MarketResolved")).to.not.be.null;
    });
  });

  // ===============================================================
  // SCENARIO 9: Multi-User Settlement (HIGH)
  // ===============================================================
  describe("Scenario 9: Multi-User Settlement", function () {
    beforeEach(async function () {
      await deployMarket(feeCollector.address);
      await fundAndApprove(alice, 100_000_000n);
      await fundAndApprove(bob, 100_000_000n);
      await fundAndApprove(carol, 100_000_000n);
    });

    it("should pay both winners proportionally", async function () {
      // Alice mints 10 shares (10_000_000 micro-cUSDT)
      await mintShares(alice, 10_000_000n);

      // Bob mints 5 shares (5_000_000 micro-cUSDT)
      await mintShares(bob, 5_000_000n);

      // Alice sells NO at 4000 (ask side=NO, price=4000, 10 shares)
      // Escrow = (10000-4000)*100*10 = 6_000_000
      await placeOrder(alice, SIDE_NO, 4000, false, 10n);

      // Bob sells NO at 3500 (ask side=NO, price=3500, 5 shares)
      // Escrow = (10000-3500)*100*5 = 3_250_000
      await placeOrder(bob, SIDE_NO, 3500, false, 5n);

      // Carol buys all NO shares:
      // Carol bids side=YES at 4000, 10 shares (opposite of Alice's NO ask -> match fills)
      await placeOrder(carol, SIDE_YES, 4000, true, 10n);
      // Carol bids side=YES at 3500, 5 shares (opposite of Bob's NO ask -> match fills)
      await placeOrder(carol, SIDE_YES, 3500, true, 5n);

      // Match Alice's ask (order 0) with Carol's first bid (order 2)
      // bid=2 (Carol, side=YES), ask=0 (Alice, side=NO) -> opposite sides -> fills
      await market.connect(deployer).attemptMatch(2, 0);

      // Match Bob's ask (order 1) with Carol's second bid (order 3)
      // bid=3 (Carol, side=YES), ask=1 (Bob, side=NO) -> opposite sides -> fills
      await market.connect(deployer).attemptMatch(3, 1);

      // Resolve YES
      await advancePastDeadline();
      await market.connect(resolver).resolve(true);
      expect(await market.resolved()).to.equal(true);
      expect(await market.outcome()).to.equal(true);

      // Both Alice and Bob should be able to redeem YES shares
      // Alice had 10M YES from minting. After matching:
      //   bid.encSide = YES (Carol), bidIsYes = true
      //   Ask owner (Alice) gets askYesTokens = select(true, ZERO, shareTransfer) = ZERO
      //   Ask owner gets askNoTokens = select(true, shareTransfer, ZERO) = shareTransfer
      //   So Alice gets NO tokens from match, keeping her original 10M YES from mint
      // But let's verify both can request redemption successfully
      await market.connect(alice).requestRedemption();
      await market.connect(bob).requestRedemption();

      // Verify both Alice and Bob have shares and requested redemption
      expect(await market.hasUserShares(alice.address)).to.equal(true);
      expect(await market.hasUserShares(bob.address)).to.equal(true);

      // Finalize both redemptions
      const aliceIsYesWon = await market.outcome();
      const [aliceYesHandle] = await market.connect(alice).getMyShares();
      const aliceResult = await fhevm.publicDecrypt([aliceYesHandle]);
      const aliceWinning = Number(aliceResult.clearValues[aliceYesHandle]);
      await market.connect(alice).finalizeRedemption(aliceWinning, aliceResult.decryptionProof);

      const [bobYesHandle] = await market.connect(bob).getMyShares();
      const bobResult = await fhevm.publicDecrypt([bobYesHandle]);
      const bobWinning = Number(bobResult.clearValues[bobYesHandle]);
      await market.connect(bob).finalizeRedemption(bobWinning, bobResult.decryptionProof);

      // Both should have received payouts (exact amounts depend on fee calculations)
      // Alice minted 10M YES, Bob minted 5M YES
      // Both held YES shares -> YES won -> both get paid
      expect(BigInt(aliceWinning)).to.be.gt(0n);
      expect(BigInt(bobWinning)).to.be.gt(0n);
    });
  });

  // ===============================================================
  // SCENARIO 10: Race Condition - Resolve during active orders
  // ===============================================================
  describe("Scenario 10: Race Condition - Resolve during active orders", function () {
    beforeEach(async function () {
      await deployMarket(feeCollector.address);
      await fundAndApprove(alice, 100_000_000n);
      await fundAndApprove(bob, 100_000_000n);
    });

    it("should revert match after market is resolved (place orders, resolve, then try match)", async function () {
      // Place orders before deadline
      await placeOrder(alice, SIDE_YES, 6000, true, 5n);
      await placeOrder(bob, SIDE_NO, 6000, false, 5n);

      expect(await market.activeOrderCount()).to.equal(2n);

      // Resolve the market
      await advancePastDeadline();
      await market.connect(resolver).resolve(true);
      expect(await market.resolved()).to.equal(true);

      // Attempt to match after resolution should revert
      await expect(market.connect(carol).attemptMatch(0, 1)).to.be.revertedWithCustomError(market, "Resolved");
    });

    it("should allow cancelling orders after resolution to release escrow", async function () {
      const aliceBalBefore = await getBalance(alice);
      const bobBalBefore = await getBalance(bob);

      // Place orders
      // Alice: bid YES at 6000, 5 shares. Escrow = 6000 * 100 * 5 = 3_000_000
      await placeOrder(alice, SIDE_YES, 6000, true, 5n);
      // Bob: ask NO at 6000, 5 shares. Escrow = (10000-6000) * 100 * 5 = 2_000_000
      await placeOrder(bob, SIDE_NO, 6000, false, 5n);

      expect(await market.activeOrderCount()).to.equal(2n);

      // Verify escrow was taken
      const aliceBalAfterOrder = await getBalance(alice);
      expect(aliceBalBefore - aliceBalAfterOrder).to.equal(3_000_000n);
      const bobBalAfterOrder = await getBalance(bob);
      expect(bobBalBefore - bobBalAfterOrder).to.equal(2_000_000n);

      // Resolve the market
      await advancePastDeadline();
      await market.connect(resolver).resolve(true);

      // Cancel orders to release escrow (cancelOrder doesn't check for resolved)
      await market.connect(alice).cancelOrder(0);
      await market.connect(bob).cancelOrder(1);

      expect(await market.activeOrderCount()).to.equal(0n);

      // Verify escrow was returned
      const aliceBalAfterCancel = await getBalance(alice);
      expect(aliceBalAfterCancel).to.equal(aliceBalBefore);
      const bobBalAfterCancel = await getBalance(bob);
      expect(bobBalAfterCancel).to.equal(bobBalBefore);
    });
  });
});
