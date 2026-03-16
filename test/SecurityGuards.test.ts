import { expect } from "chai";
import { ethers } from "hardhat";
import { fhevm } from "hardhat";
import { FhevmType } from "@fhevm/hardhat-plugin";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";

describe("SecurityGuards", function () {
  let market: any;
  let token: any;
  let signers: HardhatEthersSigner[];
  let deployer: HardhatEthersSigner;
  let alice: HardhatEthersSigner;
  let bob: HardhatEthersSigner;
  let resolver: HardhatEthersSigner;
  let charlie: HardhatEthersSigner;
  let feeCollector: HardhatEthersSigner;
  let dave: HardhatEthersSigner;
  let marketAddress: string;
  let tokenAddress: string;
  let deadline: number;

  const QUESTION = "BTC exceeds $200K by Dec 2026?";
  const RESOLUTION_SOURCE = "Chainlink BTC/USD Price Feed";
  const RESOLUTION_TYPE = "onchain_oracle";
  const RESOLUTION_CRITERIA = ">= 200000";

  const SIDE_YES = 0;
  const SIDE_NO = 1;

  const ONE_DAY = 86400;
  const SEVEN_DAYS = 7 * ONE_DAY;

  // -------------------------------------------------------
  // HELPERS
  // -------------------------------------------------------

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

  async function mintSharesFor(signer: HardhatEthersSigner, microCusdt: bigint) {
    const input = fhevm.createEncryptedInput(marketAddress, signer.address);
    input.add64(microCusdt);
    const enc = await input.encrypt();
    return market.connect(signer).mintShares(enc.handles[0], enc.inputProof);
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
    dave = signers[6];

    // Deploy ConfidentialUSDT
    const ConfidentialUSDT = await ethers.getContractFactory("ConfidentialUSDT");
    token = await ConfidentialUSDT.deploy();
    await token.waitForDeployment();
    tokenAddress = await token.getAddress();

    // Mint tokens to alice, bob, charlie, dave (100 USDT each)
    await token.mint(alice.address, 100_000_000n);
    await token.mint(bob.address, 100_000_000n);
    await token.mint(charlie.address, 100_000_000n);
    await token.mint(dave.address, 100_000_000n);

    // Get current block timestamp and set deadline 1 day from now
    const block = await ethers.provider.getBlock("latest");
    deadline = block!.timestamp + ONE_DAY;

    // Deploy OpaqueMarket (10 constructor args)
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

    // Approve market to spend tokens for alice, bob, charlie, dave
    await token.connect(alice).approvePlaintext(marketAddress, 100_000_000);
    await token.connect(bob).approvePlaintext(marketAddress, 100_000_000);
    await token.connect(charlie).approvePlaintext(marketAddress, 100_000_000);
    await token.connect(dave).approvePlaintext(marketAddress, 100_000_000);
  });

  // ===================================================================
  // 1. ACCESS CONTROL (10 tests)
  // ===================================================================

  describe("Access Control", function () {
    it("should reject non-creator from calling pause", async function () {
      await expect(market.connect(alice).pause()).to.be.revertedWithCustomError(market, "OnlyCreator");
    });

    it("should reject non-creator from calling unpause", async function () {
      await market.connect(deployer).pause();
      await expect(market.connect(alice).unpause()).to.be.revertedWithCustomError(market, "OnlyCreator");
    });

    it("should reject non-creator from calling setResolver", async function () {
      await expect(market.connect(alice).setResolver(bob.address)).to.be.revertedWithCustomError(
        market,
        "OnlyCreator",
      );
    });

    it("should reject non-creator from calling setFeeCollector", async function () {
      await expect(market.connect(alice).setFeeCollector(bob.address)).to.be.revertedWithCustomError(
        market,
        "OnlyCreator",
      );
    });

    it("should reject non-creator from calling transferCreator", async function () {
      await expect(market.connect(alice).transferCreator(bob.address)).to.be.revertedWithCustomError(
        market,
        "OnlyCreator",
      );
    });

    it("should reject non-creator from calling cancelMarket", async function () {
      await expect(market.connect(alice).cancelMarket()).to.be.revertedWithCustomError(market, "OnlyCreator");
    });

    it("should reject non-resolver from calling resolve", async function () {
      await advanceTime(ONE_DAY + 1);
      await expect(market.connect(alice).resolve(true)).to.be.revertedWithCustomError(market, "OnlyResolver");
    });

    it("should reject non-feeCollector from calling withdrawFees", async function () {
      await expect(market.connect(alice).withdrawFees()).to.be.revertedWithCustomError(market, "OnlyCollector");
    });

    it("should reject non-owner from cancelling another user's order", async function () {
      await placeOrder(alice, SIDE_YES, 5000, true, 10n);
      await expect(market.connect(bob).cancelOrder(0)).to.be.revertedWithCustomError(market, "NotOwner");
    });

    it("should reject random user from calling acceptCreator when not pending", async function () {
      await expect(market.connect(alice).acceptCreator()).to.be.revertedWithCustomError(market, "NotPending");
    });
  });

  // ===================================================================
  // 2. STATE GUARDS (8 tests)
  // ===================================================================

  describe("State Guards", function () {
    it("should reject placeOrder after market is resolved", async function () {
      await resolveMarket(true);

      const input = fhevm.createEncryptedInput(marketAddress, alice.address);
      input.add8(SIDE_YES);
      input.add64(5n);
      const enc = await input.encrypt();

      await expect(
        market.connect(alice).placeOrder(enc.handles[0], 6000, true, enc.handles[1], enc.inputProof, enc.inputProof),
      ).to.be.revertedWithCustomError(market, "Resolved");
    });

    it("should reject mintShares after market is resolved", async function () {
      await resolveMarket(true);

      const input = fhevm.createEncryptedInput(marketAddress, alice.address);
      input.add64(1_000_000n);
      const enc = await input.encrypt();

      await expect(market.connect(alice).mintShares(enc.handles[0], enc.inputProof)).to.be.revertedWithCustomError(
        market,
        "Resolved",
      );
    });

    it("should reject attemptMatch after market is resolved", async function () {
      // Place orders before resolution
      await placeOrder(alice, SIDE_YES, 6000, true, 5n);
      await placeOrder(bob, SIDE_NO, 6000, false, 5n);

      await resolveMarket(true);

      await expect(market.connect(charlie).attemptMatch(0, 1)).to.be.revertedWithCustomError(market, "Resolved");
    });

    it("should reject resolve before deadline (NotEnded)", async function () {
      await expect(market.connect(resolver).resolve(true)).to.be.revertedWithCustomError(market, "NotEnded");
    });

    it("should reject double resolution (Resolved)", async function () {
      await advanceTime(ONE_DAY + 1);
      await market.connect(resolver).resolve(true);

      await expect(market.connect(resolver).resolve(false)).to.be.revertedWithCustomError(market, "Resolved");
    });

    it("should reject setResolver after someone has minted shares (HasMints)", async function () {
      await mintSharesFor(alice, 1_000_000n);

      await expect(market.connect(deployer).setResolver(bob.address)).to.be.revertedWithCustomError(
        market,
        "HasMints",
      );
    });

    it("should reject cancelMarket after someone has minted shares (HasParticipants)", async function () {
      await mintSharesFor(alice, 1_000_000n);

      await expect(market.connect(deployer).cancelMarket()).to.be.revertedWithCustomError(market, "HasParticipants");
    });

    it("should reject requestRedemption before market is resolved (NotResolved)", async function () {
      await mintSharesFor(alice, 1_000_000n);

      await expect(market.connect(alice).requestRedemption()).to.be.revertedWithCustomError(market, "NotResolved");
    });
  });

  // ===================================================================
  // 3. PAUSE MECHANISM (5 tests)
  // ===================================================================

  describe("Pause Mechanism", function () {
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

    it("should allow cancelOrder when paused (user protection)", async function () {
      await placeOrder(alice, SIDE_YES, 5000, true, 10n);
      expect(await market.activeOrderCount()).to.equal(1n);

      await market.connect(deployer).pause();

      // cancelOrder does not have whenNotPaused — user can always exit
      await market.connect(alice).cancelOrder(0);
      expect(await market.activeOrderCount()).to.equal(0n);
    });

    it("should allow placeOrder after unpause", async function () {
      await market.connect(deployer).pause();
      expect(await market.paused()).to.equal(true);

      await market.connect(deployer).unpause();
      expect(await market.paused()).to.equal(false);

      // placeOrder should work again
      await placeOrder(alice, SIDE_YES, 5000, true, 5n);
      expect(await market.activeOrderCount()).to.equal(1n);
    });

    it("should persist paused state across blocks", async function () {
      await market.connect(deployer).pause();
      expect(await market.paused()).to.equal(true);

      // Advance several blocks
      await ethers.provider.send("evm_mine", []);
      await ethers.provider.send("evm_mine", []);
      await ethers.provider.send("evm_mine", []);

      // Still paused
      expect(await market.paused()).to.equal(true);

      // placeOrder still blocked
      const input = fhevm.createEncryptedInput(marketAddress, alice.address);
      input.add8(SIDE_YES);
      input.add64(5n);
      const enc = await input.encrypt();

      await expect(
        market.connect(alice).placeOrder(enc.handles[0], 5000, true, enc.handles[1], enc.inputProof, enc.inputProof),
      ).to.be.revertedWithCustomError(market, "EnforcedPause");
    });
  });

  // ===================================================================
  // 4. TWO-STEP OWNERSHIP TRANSFER (5 tests)
  // ===================================================================

  describe("Two-Step Ownership Transfer", function () {
    it("should set pendingCreator on transferCreator", async function () {
      await market.connect(deployer).transferCreator(alice.address);
      expect(await market.pendingCreator()).to.equal(alice.address);
      // Creator is still deployer until accepted
      expect(await market.creator()).to.equal(deployer.address);
    });

    it("should change creator on acceptCreator", async function () {
      await market.connect(deployer).transferCreator(alice.address);
      await market.connect(alice).acceptCreator();

      expect(await market.creator()).to.equal(alice.address);
      expect(await market.pendingCreator()).to.equal(ethers.ZeroAddress);
    });

    it("should revoke old creator privileges after transfer", async function () {
      await market.connect(deployer).transferCreator(alice.address);
      await market.connect(alice).acceptCreator();

      // Old creator (deployer) can no longer pause
      await expect(market.connect(deployer).pause()).to.be.revertedWithCustomError(market, "OnlyCreator");
    });

    it("should grant new creator all privileges after transfer", async function () {
      await market.connect(deployer).transferCreator(alice.address);
      await market.connect(alice).acceptCreator();

      // New creator (alice) can pause
      await market.connect(alice).pause();
      expect(await market.paused()).to.equal(true);

      // New creator (alice) can unpause
      await market.connect(alice).unpause();
      expect(await market.paused()).to.equal(false);

      // New creator (alice) can setFeeCollector
      await market.connect(alice).setFeeCollector(bob.address);
      expect(await market.feeCollector()).to.equal(bob.address);

      // New creator (alice) can transfer again
      await market.connect(alice).transferCreator(charlie.address);
      expect(await market.pendingCreator()).to.equal(charlie.address);
    });

    it("should reject acceptCreator from non-pending address (NotPending)", async function () {
      await market.connect(deployer).transferCreator(alice.address);

      // Bob is not the pending creator
      await expect(market.connect(bob).acceptCreator()).to.be.revertedWithCustomError(market, "NotPending");

      // Deployer (old creator) is also not the pending creator
      await expect(market.connect(deployer).acceptCreator()).to.be.revertedWithCustomError(market, "NotPending");
    });
  });

  // ===================================================================
  // 5. EMERGENCY MECHANISMS (7 tests)
  // ===================================================================

  describe("Emergency Mechanisms", function () {
    beforeEach(async function () {
      await mintSharesFor(alice, 5_000_000n);
    });

    it("should reject emergencyWithdraw during grace period (GraceActive)", async function () {
      // Just past deadline, but within 7-day grace period
      await advanceTime(ONE_DAY + 1);

      await expect(market.connect(alice).emergencyWithdraw()).to.be.revertedWithCustomError(market, "GraceActive");
    });

    it("should allow emergencyWithdraw after grace period (7 days past deadline)", async function () {
      // Advance past deadline + full grace period
      await advanceTime(ONE_DAY + SEVEN_DAYS + 1);

      // Should not revert
      await market.connect(alice).emergencyWithdraw();

      // Verify the request was recorded by checking that a second call reverts with Requested
      await expect(market.connect(alice).emergencyWithdraw()).to.be.revertedWithCustomError(market, "Requested");
    });

    it("should reject emergencyRefundAfterResolution during timeout period (TimeoutActive)", async function () {
      await resolveMarket(true);

      // Only advance 1 day after resolution, not the full 7-day timeout
      await advanceTime(ONE_DAY);

      await expect(market.connect(alice).emergencyRefundAfterResolution()).to.be.revertedWithCustomError(
        market,
        "TimeoutActive",
      );
    });

    it("should allow emergencyRefundAfterResolution after timeout (7 days post-resolution)", async function () {
      await resolveMarket(true);

      // Advance past the 7-day decrypt timeout
      await advanceTime(SEVEN_DAYS + 1);

      // Should not revert
      await market.connect(alice).emergencyRefundAfterResolution();

      // Verify the request was recorded
      await expect(market.connect(alice).emergencyRefundAfterResolution()).to.be.revertedWithCustomError(
        market,
        "Requested",
      );
    });

    it("should reject double emergency withdraw (Requested)", async function () {
      await advanceTime(ONE_DAY + SEVEN_DAYS + 1);

      await market.connect(alice).emergencyWithdraw();

      // Second call should revert
      await expect(market.connect(alice).emergencyWithdraw()).to.be.revertedWithCustomError(market, "Requested");
    });

    it("should reject emergency withdraw before resolution on a resolved market (Resolved)", async function () {
      // Resolve the market
      await resolveMarket(true);

      // Even after grace period, emergencyWithdraw checks resolved first
      await advanceTime(SEVEN_DAYS + 1);

      await expect(market.connect(alice).emergencyWithdraw()).to.be.revertedWithCustomError(market, "Resolved");
    });

    it("should reject emergencyWithdraw at exact grace period boundary (GraceActive)", async function () {
      // Advance to just before the grace period ends
      // Contract checks block.timestamp <= deadline + GRACE_PERIOD
      await advanceTime(ONE_DAY + SEVEN_DAYS - 60);

      await expect(market.connect(alice).emergencyWithdraw()).to.be.revertedWithCustomError(market, "GraceActive");
    });
  });

  // ===================================================================
  // 6. ADDITIONAL SECURITY GUARDS (bonus tests beyond the 35 minimum)
  // ===================================================================

  describe("Additional Security Guards", function () {
    it("should reject transferCreator with zero address (ZeroAddress)", async function () {
      await expect(market.connect(deployer).transferCreator(ethers.ZeroAddress)).to.be.revertedWithCustomError(
        market,
        "ZeroAddress",
      );
    });

    it("should reject setResolver with zero address (ZeroAddress)", async function () {
      await expect(market.connect(deployer).setResolver(ethers.ZeroAddress)).to.be.revertedWithCustomError(
        market,
        "ZeroAddress",
      );
    });

    it("should reject setFeeCollector with zero address (ZeroAddress)", async function () {
      await expect(market.connect(deployer).setFeeCollector(ethers.ZeroAddress)).to.be.revertedWithCustomError(
        market,
        "ZeroAddress",
      );
    });

    it("should reject setResolver on already resolved market (Resolved)", async function () {
      await resolveMarket(true);

      await expect(market.connect(deployer).setResolver(alice.address)).to.be.revertedWithCustomError(
        market,
        "Resolved",
      );
    });

    it("should reject cancelMarket on already resolved market (Resolved)", async function () {
      await resolveMarket(true);

      await expect(market.connect(deployer).cancelMarket()).to.be.revertedWithCustomError(market, "Resolved");
    });

    it("should reject emergencyRefundAfterResolution when not resolved (NotResolved)", async function () {
      await mintSharesFor(alice, 1_000_000n);

      await expect(market.connect(alice).emergencyRefundAfterResolution()).to.be.revertedWithCustomError(
        market,
        "NotResolved",
      );
    });

    it("should reject emergencyWithdraw from non-shareholder (NoShares)", async function () {
      await advanceTime(ONE_DAY + SEVEN_DAYS + 1);

      // bob has no shares
      await expect(market.connect(bob).emergencyWithdraw()).to.be.revertedWithCustomError(market, "NoShares");
    });

    it("should reject requestRedemption from non-shareholder (NoShares)", async function () {
      await resolveMarket(true);

      // bob has no shares
      await expect(market.connect(bob).requestRedemption()).to.be.revertedWithCustomError(market, "NoShares");
    });

    it("should reject emergencyRefundAfterResolution from non-shareholder (NoShares)", async function () {
      await mintSharesFor(alice, 1_000_000n);
      await resolveMarket(true);
      await advanceTime(SEVEN_DAYS + 1);

      // bob has no shares
      await expect(market.connect(bob).emergencyRefundAfterResolution()).to.be.revertedWithCustomError(
        market,
        "NoShares",
      );
    });

    it("should reject burnShares after market is resolved (Resolved)", async function () {
      await mintSharesFor(alice, 5_000_000n);
      await resolveMarket(true);

      const input = fhevm.createEncryptedInput(marketAddress, alice.address);
      input.add64(1_000_000n);
      const enc = await input.encrypt();

      await expect(market.connect(alice).burnShares(enc.handles[0], enc.inputProof)).to.be.revertedWithCustomError(
        market,
        "Resolved",
      );
    });

    it("should reject non-feeCollector from calling withdrawTradeFees (OnlyCollector)", async function () {
      await expect(market.connect(alice).withdrawTradeFees()).to.be.revertedWithCustomError(market, "OnlyCollector");
    });
  });
});
