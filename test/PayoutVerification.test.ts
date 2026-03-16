import { expect } from "chai";
import { ethers } from "hardhat";
import { fhevm } from "hardhat";
import { FhevmType } from "@fhevm/hardhat-plugin";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";

/**
 * PayoutVerification - Focused tests for the redemption payout formula.
 *
 * V2 API — unified placeOrder + permissionless attemptMatch, no matcher role.
 *
 * Order book model:
 *   - 1 share = $1.00 at resolution = 1_000_000 micro-cUSDT
 *   - Redemption fee: 0.5% of gross payout (FEE_BPS = 50)
 *   - Withdrawal fee: flat $1.00 (1_000_000 micro-cUSDT)
 *   - Trading fee: 0.05% of settlement (TRADE_FEE_BPS = 5)
 *
 * Token: ConfidentialUSDT (6 decimals) — amounts in micro-USDT (1 USDT = 1_000_000)
 *
 * Payout formula:
 *   grossPayout = winningShares (micro-cUSDT, same as SHARE_UNIT)
 *   fee = (grossPayout * 50) / 10000
 *   netPayout = grossPayout - fee
 *   if (netPayout > 1_000_000): netPayout -= 1_000_000, fee += 1_000_000
 *   else: fee += netPayout, netPayout = 0
 *
 * Price range: 100-9900 (basis points)
 * Escrow:
 *   - Bid: price * 100 * amount
 *   - Ask: (10000 - price) * 100 * amount
 *
 * NOTE: Tests within each scenario are intentionally sequential.
 * They share state via `before()` to test a complete lifecycle flow.
 * Do not skip or reorder individual tests within a scenario.
 */
describe("PayoutVerification", function () {
  let signers: HardhatEthersSigner[];
  let deployer: HardhatEthersSigner;
  let alice: HardhatEthersSigner;
  let bob: HardhatEthersSigner;
  let charlie: HardhatEthersSigner;
  let resolverSigner: HardhatEthersSigner;
  let feeCollectorSigner: HardhatEthersSigner;

  const QUESTION = "Payout verification test market";
  const RESOLUTION_SOURCE = "unit-test";
  const RESOLUTION_TYPE = "manual_multisig";
  const RESOLUTION_CRITERIA = "test";

  const SIDE_YES = 0;
  const SIDE_NO = 1;

  before(async function () {
    signers = await ethers.getSigners();
    deployer = signers[0];
    alice = signers[1];
    bob = signers[2];
    charlie = signers[3];
    resolverSigner = signers[4];
    feeCollectorSigner = signers[5];
  });

  async function deployFresh() {
    const TokenFactory = await ethers.getContractFactory("ConfidentialUSDT");
    const token = await TokenFactory.deploy();
    await token.waitForDeployment();
    const tokenAddress = await token.getAddress();

    const block = await ethers.provider.getBlock("latest");
    const deadline = block!.timestamp + 86400;

    const MarketFactory = await ethers.getContractFactory("OpaqueMarket");
    const market = await MarketFactory.deploy(
      QUESTION,
      deadline,
      RESOLUTION_SOURCE,
      RESOLUTION_TYPE,
      RESOLUTION_CRITERIA,
      "crypto",
      resolverSigner.address,
      feeCollectorSigner.address,
      tokenAddress,
      deployer.address,
    );
    await market.waitForDeployment();
    const marketAddress = await market.getAddress();

    return { token, tokenAddress, market, marketAddress };
  }

  async function mintSharesFor(
    token: any,
    tokenAddress: string,
    market: any,
    marketAddress: string,
    user: HardhatEthersSigner,
    amount: bigint,
  ) {
    await token.mint(user.address, amount);
    await token.connect(user).approvePlaintext(marketAddress, amount);

    const input = fhevm.createEncryptedInput(marketAddress, user.address);
    input.add64(amount);
    const encrypted = await input.encrypt();
    await market.connect(user).mintShares(encrypted.handles[0], encrypted.inputProof);
  }

  async function resolveMarket(market: any, outcomeYesWins: boolean) {
    await ethers.provider.send("evm_increaseTime", [86401]);
    await ethers.provider.send("evm_mine", []);
    await market.connect(resolverSigner).resolve(outcomeYesWins);
  }

  async function redeemFor(market: any, user: HardhatEthersSigner): Promise<any> {
    await market.connect(user).requestRedemption();

    const isYesWon = await market.outcome();
    const [yesHandle, noHandle] = await market.connect(user).getMyShares();
    const winningHandle = isYesWon ? yesHandle : noHandle;

    const result = await fhevm.publicDecrypt([winningHandle]);
    const winningShares = Number(result.clearValues[winningHandle]);

    const tx = await market.connect(user).finalizeRedemption(winningShares, result.decryptionProof);
    const receipt = await tx.wait();
    return receipt;
  }

  function extractPayout(market: any, receipt: any): bigint {
    for (const log of receipt.logs) {
      try {
        const parsed = market.interface.parseLog({ topics: log.topics, data: log.data });
        if (parsed?.name === "RedemptionFinalized") {
          return parsed.args.payout;
        }
      } catch {
        // not our event
      }
    }
    throw new Error("RedemptionFinalized event not found");
  }

  // Helper: place a V2 unified order with encrypted side and amount
  async function placeOrder(
    market: any,
    marketAddress: string,
    signer: HardhatEthersSigner,
    side: number,
    price: number,
    isBid: boolean,
    amount: bigint,
  ) {
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

  // ══════════════════════════════════════════════════════════════════
  // SCENARIO 1: Basic redemption — YES wins, Alice holds 10M YES shares
  //   gross = 10M, 0.5% fee = 50K, net = 9.95M, $1 flat = 1M, final = 8_950_000
  // ══════════════════════════════════════════════════════════════════
  describe("Scenario 1: Basic YES redemption", function () {
    let market: any;
    let token: any;
    let marketAddress: string;
    let tokenAddress: string;

    before(async function () {
      ({ token, tokenAddress, market, marketAddress } = await deployFresh());
      await mintSharesFor(token, tokenAddress, market, marketAddress, alice, 10_000_000n);
      await resolveMarket(market, true);
    });

    it("Alice payout = 8_950_000 (10M - 0.5% - $1 flat)", async function () {
      const receipt = await redeemFor(market, alice);
      const payout = extractPayout(market, receipt);
      expect(payout).to.equal(8_950_000n);
    });

    it("Alice cUSDT balance reflects payout", async function () {
      const aliceEnc = await token.balanceOf(alice.address);
      const aliceBal = await fhevm.userDecryptEuint(FhevmType.euint64, aliceEnc, tokenAddress, alice);
      expect(aliceBal).to.equal(8_950_000n);
    });

    it("Collected fees = 1_050_000 (50K percentage + 1M flat)", async function () {
      expect(await market.collectedFees()).to.equal(1_050_000n);
    });
  });

  // ══════════════════════════════════════════════════════════════════
  // SCENARIO 2: Basic NO redemption — NO wins
  // ══════════════════════════════════════════════════════════════════
  describe("Scenario 2: Basic NO redemption", function () {
    let market: any;
    let token: any;
    let marketAddress: string;
    let tokenAddress: string;

    before(async function () {
      ({ token, tokenAddress, market, marketAddress } = await deployFresh());
      await mintSharesFor(token, tokenAddress, market, marketAddress, alice, 10_000_000n);
      await resolveMarket(market, false);
    });

    it("Alice redeems NO shares = 8_950_000", async function () {
      const receipt = await redeemFor(market, alice);
      const payout = extractPayout(market, receipt);
      expect(payout).to.equal(8_950_000n);
    });

    it("Collected fees = 1_050_000", async function () {
      expect(await market.collectedFees()).to.equal(1_050_000n);
    });
  });

  // ══════════════════════════════════════════════════════════════════
  // SCENARIO 3: Multiple winners — Alice 6M, Charlie 4M YES, resolve YES
  //   Alice: 6M - 30K - 1M = 4_970_000, fee = 1_030_000
  //   Charlie: 4M - 20K - 1M = 2_980_000, fee = 1_020_000
  //   Total fees: 2_050_000
  // ══════════════════════════════════════════════════════════════════
  describe("Scenario 3: Multiple winners proportional", function () {
    let market: any;
    let token: any;
    let marketAddress: string;
    let tokenAddress: string;

    before(async function () {
      ({ token, tokenAddress, market, marketAddress } = await deployFresh());
      await mintSharesFor(token, tokenAddress, market, marketAddress, alice, 6_000_000n);
      await mintSharesFor(token, tokenAddress, market, marketAddress, charlie, 4_000_000n);
      await resolveMarket(market, true);
    });

    it("Alice payout = 4_970_000", async function () {
      const receipt = await redeemFor(market, alice);
      const payout = extractPayout(market, receipt);
      expect(payout).to.equal(4_970_000n);
    });

    it("Charlie payout = 2_980_000", async function () {
      const receipt = await redeemFor(market, charlie);
      const payout = extractPayout(market, receipt);
      expect(payout).to.equal(2_980_000n);
    });

    it("Total fees = 2_050_000", async function () {
      expect(await market.collectedFees()).to.equal(2_050_000n);
    });
  });

  // ══════════════════════════════════════════════════════════════════
  // SCENARIO 4: Burn shares before resolution — get cUSDT back
  // ══════════════════════════════════════════════════════════════════
  describe("Scenario 4: Burn before resolution", function () {
    let market: any;
    let token: any;
    let marketAddress: string;
    let tokenAddress: string;

    before(async function () {
      ({ token, tokenAddress, market, marketAddress } = await deployFresh());
      // Mint 10M
      await mintSharesFor(token, tokenAddress, market, marketAddress, alice, 10_000_000n);

      // Burn 5M (return 5M cUSDT)
      const input = fhevm.createEncryptedInput(marketAddress, alice.address);
      input.add64(5_000_000n);
      const encrypted = await input.encrypt();
      await market.connect(alice).burnShares(encrypted.handles[0], encrypted.inputProof);

      await resolveMarket(market, true);
    });

    it("Alice redeems remaining 5M YES shares = 3_975_000", async function () {
      const receipt = await redeemFor(market, alice);
      const payout = extractPayout(market, receipt);
      // 5M - 25K - 1M = 3_975_000
      expect(payout).to.equal(3_975_000n);
    });

    it("Alice total balance = burned (5M) + redeemed (3_975_000)", async function () {
      const aliceEnc = await token.balanceOf(alice.address);
      const aliceBal = await fhevm.userDecryptEuint(FhevmType.euint64, aliceEnc, tokenAddress, alice);
      expect(aliceBal).to.equal(5_000_000n + 3_975_000n);
    });

    it("Collected fees = 1_025_000", async function () {
      expect(await market.collectedFees()).to.equal(1_025_000n);
    });
  });

  // ══════════════════════════════════════════════════════════════════
  // SCENARIO 5: Traded partial position — Alice asks YES, Bob bids NO
  //
  // V2 matching creates NEW outcome tokens from cUSDT escrow (does NOT transfer existing tokens).
  // Trade fee deduction: feePerShare = ask.price * 100 * 5 / 10000
  //   → shares from match = actualFill * (1_000_000 - feePerShare)
  //
  // Alice mints 10M shares → 10M YES + 10M NO tokens.
  // Alice places ask (side=YES, price=6000, 6 shares). Escrow = (10000-6000)*100*6 = 2.4M cUSDT.
  // Bob places bid (side=NO, price=6000, 6 shares). Escrow = 6000*100*6 = 3.6M cUSDT.
  // feePerShare = 6000*100*5/10000 = 300
  // Match creates: 6 * (1_000_000 - 300) = 5_998_200 YES for Alice + same NO for Bob.
  //
  // After match:
  //   Alice: 10_000_000 + 5_998_200 = 15_998_200 YES, 10M NO
  //   Bob: 0 YES, 5_998_200 NO
  //
  // Resolve YES:
  //   Alice gross = 15_998_200, fee 0.5% = 79_991, flat $1 = 1M
  //   Alice net = 15_998_200 - 79_991 - 1_000_000 = 14_918_209
  //   Bob: 0 YES → payout = 0
  //   Total fees: 79_991 + 1_000_000 = 1_079_991
  // ══════════════════════════════════════════════════════════════════
  describe("Scenario 5: Partial position after trade", function () {
    let market: any;
    let token: any;
    let marketAddress: string;
    let tokenAddress: string;

    before(async function () {
      ({ token, tokenAddress, market, marketAddress } = await deployFresh());

      // Fund Alice with 100M, mint 10M shares (she'll have 90M USDT left for ask escrow)
      await token.mint(alice.address, 100_000_000n);
      await token.connect(alice).approvePlaintext(marketAddress, 100_000_000);

      const mintInput = fhevm.createEncryptedInput(marketAddress, alice.address);
      mintInput.add64(10_000_000n);
      const mintEnc = await mintInput.encrypt();
      await market.connect(alice).mintShares(mintEnc.handles[0], mintEnc.inputProof);

      // Fund Bob with 100M for bid escrow
      await token.mint(bob.address, 100_000_000n);
      await token.connect(bob).approvePlaintext(marketAddress, 100_000_000);

      // Alice places sell ask (side=YES, isBid=false) for 6 shares at price 6000
      // Ask escrow = (10000 - 6000) * 100 * 6 = 2_400_000
      const sellInput = fhevm.createEncryptedInput(marketAddress, alice.address);
      sellInput.add8(SIDE_YES); // 0 = YES
      sellInput.add64(6n); // 6 shares
      const sellEnc = await sellInput.encrypt();
      await market
        .connect(alice)
        .placeOrder(sellEnc.handles[0], 6000, false, sellEnc.handles[1], sellEnc.inputProof, sellEnc.inputProof);

      // Bob places buy bid (side=NO, isBid=true) for 6 shares at price 6000
      // OPPOSITE side for match: FHE.ne(YES, NO) = true
      // Bid escrow = 6000 * 100 * 6 = 3_600_000
      const buyInput = fhevm.createEncryptedInput(marketAddress, bob.address);
      buyInput.add8(SIDE_NO); // 1 = NO (opposite of Alice's YES)
      buyInput.add64(6n); // 6 shares
      const buyEnc = await buyInput.encrypt();
      await market
        .connect(bob)
        .placeOrder(buyEnc.handles[0], 6000, true, buyEnc.handles[1], buyEnc.inputProof, buyEnc.inputProof);

      // Permissionless match: bid=1 (Bob), ask=0 (Alice)
      await market.connect(deployer).attemptMatch(1, 0);

      await resolveMarket(market, true);
    });

    it("Alice redeems 15_998_200 YES shares = 14_918_209", async function () {
      // V2: Alice has 10M (mint) + 5_998_200 (match, net of trade fee) = 15_998_200 YES
      // 15_998_200 - 79_991(0.5%) - 1_000_000(flat) = 14_918_209
      const receipt = await redeemFor(market, alice);
      const payout = extractPayout(market, receipt);
      expect(payout).to.equal(14_918_209n);
    });

    it("Bob has 0 YES shares (only got NO from match), payout = 0", async function () {
      // V2: matching created NO tokens for Bob, not YES. With YES winning, Bob gets 0.
      const receipt = await redeemFor(market, bob);
      const payout = extractPayout(market, receipt);
      expect(payout).to.equal(0n);
    });

    it("Total fees = 1_079_991 (from Alice's redemption only)", async function () {
      expect(await market.collectedFees()).to.equal(1_079_991n);
    });
  });

  // ══════════════════════════════════════════════════════════════════
  // SCENARIO 6: V2 matching creates new tokens (doesn't transfer existing)
  // Trade fee deduction: feePerShare = ask.price * 100 * 5 / 10000
  //
  // Alice mints 10M → 10M YES + 10M NO.
  // Alice asks 10 shares (side=YES, price=5000). Escrow = (10000-5000)*100*10 = 5M cUSDT.
  // Bob bids 10 shares (side=NO, price=5000). Escrow = 5000*100*10 = 5M cUSDT.
  // feePerShare = 5000*100*5/10000 = 250
  // Match creates: 10 * (1_000_000 - 250) = 9_997_500 YES for Alice + same NO for Bob.
  //
  // After match:
  //   Alice: 10_000_000 + 9_997_500 = 19_997_500 YES, 10M NO
  //   Bob: 0 YES, 9_997_500 NO
  //
  // YES wins:
  //   Alice gross = 19_997_500, fee 0.5% = 99_987, flat $1 = 1M
  //   Alice net = 19_997_500 - 99_987 - 1_000_000 = 18_897_513
  //   Bob: 0 YES → payout = 0
  //   Total fees: 99_987 + 1_000_000 = 1_099_987
  // ══════════════════════════════════════════════════════════════════
  describe("Scenario 6: Zero winning shares", function () {
    let market: any;
    let token: any;
    let marketAddress: string;
    let tokenAddress: string;

    before(async function () {
      ({ token, tokenAddress, market, marketAddress } = await deployFresh());

      // Fund Alice with 100M and mint 10M shares
      await token.mint(alice.address, 100_000_000n);
      await token.connect(alice).approvePlaintext(marketAddress, 100_000_000);

      const mintInput = fhevm.createEncryptedInput(marketAddress, alice.address);
      mintInput.add64(10_000_000n);
      const mintEnc = await mintInput.encrypt();
      await market.connect(alice).mintShares(mintEnc.handles[0], mintEnc.inputProof);

      // Fund Bob with 100M for bid escrow
      await token.mint(bob.address, 100_000_000n);
      await token.connect(bob).approvePlaintext(marketAddress, 100_000_000);

      // Alice sells ALL 10 YES at price 5000 (ask, isBid=false, side=YES/0)
      // Ask escrow = (10000 - 5000) * 100 * 10 = 5_000_000
      const sellInput = fhevm.createEncryptedInput(marketAddress, alice.address);
      sellInput.add8(SIDE_YES); // 0 = YES
      sellInput.add64(10n); // 10 shares (all of them)
      const sellEnc = await sellInput.encrypt();
      await market
        .connect(alice)
        .placeOrder(sellEnc.handles[0], 5000, false, sellEnc.handles[1], sellEnc.inputProof, sellEnc.inputProof);

      // Bob buys 10 at price 5000 (bid, isBid=true, side=NO/1)
      // Bid escrow = 5000 * 100 * 10 = 5_000_000
      const buyInput = fhevm.createEncryptedInput(marketAddress, bob.address);
      buyInput.add8(SIDE_NO); // 1 = NO (opposite)
      buyInput.add64(10n);
      const buyEnc = await buyInput.encrypt();
      await market
        .connect(bob)
        .placeOrder(buyEnc.handles[0], 5000, true, buyEnc.handles[1], buyEnc.inputProof, buyEnc.inputProof);

      // Permissionless match: bid=1 (Bob), ask=0 (Alice)
      await market.connect(deployer).attemptMatch(1, 0);

      // YES wins
      await resolveMarket(market, true);
    });

    it("Alice payout = 18_897_513 (19_997_500 YES from mint + match)", async function () {
      // V2: Alice has 10M (mint) + 9_997_500 (match, net of trade fee) = 19_997_500 YES
      // 19_997_500 - 99_987(0.5%) - 1_000_000(flat) = 18_897_513
      const receipt = await redeemFor(market, alice);
      const payout = extractPayout(market, receipt);
      expect(payout).to.equal(18_897_513n);
    });

    it("Bob payout = 0 (only got NO tokens from match, YES wins)", async function () {
      const receipt = await redeemFor(market, bob);
      const payout = extractPayout(market, receipt);
      expect(payout).to.equal(0n);
    });

    it("Total fees from Alice's redemption = 1_099_987", async function () {
      expect(await market.collectedFees()).to.equal(1_099_987n);
    });
  });

  // ══════════════════════════════════════════════════════════════════
  // SCENARIO 7: Fee withdrawal
  // ══════════════════════════════════════════════════════════════════
  describe("Scenario 7: Fee withdrawal", function () {
    let market: any;
    let token: any;
    let marketAddress: string;
    let tokenAddress: string;

    before(async function () {
      ({ token, tokenAddress, market, marketAddress } = await deployFresh());

      await mintSharesFor(token, tokenAddress, market, marketAddress, alice, 10_000_000n);
      await resolveMarket(market, true);
      await redeemFor(market, alice);
    });

    it("feeCollector can withdraw fees", async function () {
      const tx = await market.connect(feeCollectorSigner).withdrawFees();
      await tx.wait();
      expect(await market.collectedFees()).to.equal(0n);
    });

    it("feeCollector cUSDT balance = 1_050_000", async function () {
      const feeEnc = await token.balanceOf(feeCollectorSigner.address);
      const feeBal = await fhevm.userDecryptEuint(FhevmType.euint64, feeEnc, tokenAddress, feeCollectorSigner);
      expect(feeBal).to.equal(1_050_000n);
    });

    it("second withdrawFees() reverts", async function () {
      await expect(market.connect(feeCollectorSigner).withdrawFees()).to.be.revertedWithCustomError(market, "NoFees");
    });
  });

  // ══════════════════════════════════════════════════════════════════
  // SCENARIO 8: Double redemption prevention
  // ══════════════════════════════════════════════════════════════════
  describe("Scenario 8: Double redemption prevention", function () {
    let market: any;
    let token: any;
    let marketAddress: string;
    let tokenAddress: string;

    before(async function () {
      ({ token, tokenAddress, market, marketAddress } = await deployFresh());
      await mintSharesFor(token, tokenAddress, market, marketAddress, alice, 10_000_000n);
      await resolveMarket(market, true);
      await redeemFor(market, alice);
    });

    it("should prevent double redemption request", async function () {
      await expect(market.connect(alice).requestRedemption()).to.be.revertedWithCustomError(market, "Redeemed");
    });
  });

  // ══════════════════════════════════════════════════════════════════
  // SCENARIO 9: No shares user cannot redeem
  // ══════════════════════════════════════════════════════════════════
  describe("Scenario 9: No shares user", function () {
    let market: any;
    let token: any;
    let marketAddress: string;
    let tokenAddress: string;

    before(async function () {
      ({ token, tokenAddress, market, marketAddress } = await deployFresh());
      await resolveMarket(market, true);
    });

    it("should revert for user with no shares", async function () {
      await expect(market.connect(alice).requestRedemption()).to.be.revertedWithCustomError(market, "NoShares");
    });
  });

  // ══════════════════════════════════════════════════════════════════
  // SCENARIO 10: Small Payout Fee Dominance (CRITICAL)
  // ══════════════════════════════════════════════════════════════════
  describe("Scenario 10: Fee Edge Cases", function () {
    it("should handle payout smaller than flat fee", async function () {
      const { token, tokenAddress, market, marketAddress } = await deployFresh();

      // Mint small amount: 1 share = 1_000_000 micro-cUSDT
      await mintSharesFor(token, tokenAddress, market, marketAddress, alice, 1_000_000n);

      await resolveMarket(market, true);

      // Redeem: grossPayout = 1_000_000
      // Percentage fee = 1_000_000 * 50 / 10000 = 5_000
      // Net after percentage = 1_000_000 - 5_000 = 995_000
      // Flat fee = 1_000_000
      // Net payout < WITHDRAW_FEE (995_000 < 1_000_000)
      // So: fee += netPayout (995_000), netPayout = 0
      const receipt = await redeemFor(market, alice);
      const payout = extractPayout(market, receipt);
      expect(payout).to.equal(0n);

      // Total collected fees = 5_000 + 995_000 = 1_000_000 (entire gross payout)
      expect(await market.collectedFees()).to.equal(1_000_000n);
    });

    it("should calculate correct fee for large payout", async function () {
      const { token, tokenAddress, market, marketAddress } = await deployFresh();

      // Mint 100 shares = 100_000_000 micro-cUSDT
      await token.mint(alice.address, 100_000_000n);
      await token.connect(alice).approvePlaintext(marketAddress, 100_000_000);

      const input = fhevm.createEncryptedInput(marketAddress, alice.address);
      input.add64(100_000_000n);
      const encrypted = await input.encrypt();
      await market.connect(alice).mintShares(encrypted.handles[0], encrypted.inputProof);

      await resolveMarket(market, true);

      // Redeem: grossPayout = 100_000_000
      // Percentage fee = 100_000_000 * 50 / 10000 = 500_000
      // Net after percentage = 100_000_000 - 500_000 = 99_500_000
      // Flat fee = 1_000_000
      // Net payout = 99_500_000 - 1_000_000 = 98_500_000
      // Total fee = 500_000 + 1_000_000 = 1_500_000
      const receipt = await redeemFor(market, alice);
      const payout = extractPayout(market, receipt);
      expect(payout).to.equal(98_500_000n);

      expect(await market.collectedFees()).to.equal(1_500_000n);
    });
  });

  // ══════════════════════════════════════════════════════════════════
  // SCENARIO 11: Request Before Resolution (HIGH)
  // ══════════════════════════════════════════════════════════════════
  describe("Scenario 11: Premature Redemption", function () {
    it("should revert requestRedemption before resolve", async function () {
      const { token, tokenAddress, market, marketAddress } = await deployFresh();

      // Mint shares but don't resolve
      await mintSharesFor(token, tokenAddress, market, marketAddress, alice, 10_000_000n);

      // requestRedemption should revert NotResolved
      await expect(market.connect(alice).requestRedemption()).to.be.revertedWithCustomError(market, "NotResolved");
    });

    it("should revert finalizeRedemption before resolve", async function () {
      const { token, tokenAddress, market, marketAddress } = await deployFresh();

      // Mint shares but don't resolve
      await mintSharesFor(token, tokenAddress, market, marketAddress, alice, 10_000_000n);

      // finalizeRedemption should revert NotResolved
      await expect(market.connect(alice).finalizeRedemption(10_000_000, "0x")).to.be.revertedWithCustomError(
        market,
        "NotResolved",
      );
    });
  });
});
