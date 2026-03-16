import { expect } from "chai";
import { ethers } from "hardhat";
import { fhevm } from "hardhat";
import { FhevmType } from "@fhevm/hardhat-plugin";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";

describe("TokenAdvanced", function () {
  let token: any;
  let deployer: HardhatEthersSigner;
  let alice: HardhatEthersSigner;
  let bob: HardhatEthersSigner;
  let carol: HardhatEthersSigner;
  let dave: HardhatEthersSigner;
  let eve: HardhatEthersSigner;
  let tokenAddress: string;

  // -------------------------------------------------------
  // HELPERS
  // -------------------------------------------------------

  async function deployToken() {
    const ConfidentialUSDT = await ethers.getContractFactory("ConfidentialUSDT");
    token = await ConfidentialUSDT.deploy();
    await token.waitForDeployment();
    tokenAddress = await token.getAddress();
  }

  async function getBalance(signer: HardhatEthersSigner): Promise<bigint> {
    const encBalance = await token.balanceOf(signer.address);
    return fhevm.userDecryptEuint(FhevmType.euint64, encBalance, tokenAddress, signer);
  }

  async function encryptedTransfer(from: HardhatEthersSigner, to: HardhatEthersSigner, amount: bigint) {
    const input = fhevm.createEncryptedInput(tokenAddress, from.address);
    input.add64(amount);
    const encrypted = await input.encrypt();
    return token.connect(from).transfer(to.address, encrypted.handles[0], encrypted.inputProof);
  }

  async function encryptedApprove(owner: HardhatEthersSigner, spender: HardhatEthersSigner, amount: bigint) {
    const input = fhevm.createEncryptedInput(tokenAddress, owner.address);
    input.add64(amount);
    const encrypted = await input.encrypt();
    return token.connect(owner).approve(spender.address, encrypted.handles[0], encrypted.inputProof);
  }

  function findEvent(receipt: any, contract: any, eventName: string) {
    for (const log of receipt.logs) {
      try {
        const parsed = contract.interface.parseLog({ topics: log.topics, data: log.data });
        if (parsed?.name === eventName) return parsed;
      } catch {}
    }
    return null;
  }

  beforeEach(async function () {
    const signers = await ethers.getSigners();
    deployer = signers[0];
    alice = signers[1];
    bob = signers[2];
    carol = signers[3];
    dave = signers[4];
    eve = signers[5];

    await deployToken();
  });

  // ===============================================================
  // 1. MINTING EDGE CASES
  // ===============================================================
  describe("1. Minting Edge Cases", function () {
    it("should revert when minting 0 amount (AmountMustBePositive)", async function () {
      await expect(token.mint(alice.address, 0))
        .to.be.revertedWithCustomError(token, "AmountMustBePositive");
    });

    it("should mint max uint64 (type(uint64).max = 18446744073709551615)", async function () {
      const maxUint64 = 18446744073709551615n;
      await token.mint(alice.address, maxUint64);

      expect(await token.totalSupply()).to.equal(maxUint64);

      const balance = await getBalance(alice);
      expect(balance).to.equal(maxUint64);
    });

    it("should revert when non-owner mints (OnlyOwner)", async function () {
      await expect(token.connect(alice).mint(bob.address, 1_000_000))
        .to.be.revertedWithCustomError(token, "OnlyOwner");
    });

    it("should revert when minting amount exceeding uint64 (AmountTooLarge)", async function () {
      const overflowAmount = 18446744073709551616n; // type(uint64).max + 1
      await expect(token.mint(alice.address, overflowAmount))
        .to.be.revertedWithCustomError(token, "AmountTooLarge");
    });

    it("should accumulate balance correctly over multiple sequential mints", async function () {
      await token.mint(alice.address, 1_000_000n);
      await token.mint(alice.address, 2_000_000n);
      await token.mint(alice.address, 3_000_000n);
      await token.mint(alice.address, 4_000_000n);

      expect(await token.totalSupply()).to.equal(10_000_000n);

      const balance = await getBalance(alice);
      expect(balance).to.equal(10_000_000n);
    });
  });

  // ===============================================================
  // 2. TRANSFER EDGE CASES
  // ===============================================================
  describe("2. Transfer Edge Cases", function () {
    beforeEach(async function () {
      await token.mint(alice.address, 10_000_000n); // 10 USDT
    });

    it("should transfer 0 without error (FHE silent — balances unchanged)", async function () {
      await encryptedTransfer(alice, bob, 0n);

      const aliceBalance = await getBalance(alice);
      expect(aliceBalance).to.equal(10_000_000n);

      // Bob should have 0 balance (initialized to 0 by transfer)
      const bobBalance = await getBalance(bob);
      expect(bobBalance).to.equal(0n);
    });

    it("should transfer exact balance (leaves sender with 0)", async function () {
      await encryptedTransfer(alice, bob, 10_000_000n);

      const aliceBalance = await getBalance(alice);
      expect(aliceBalance).to.equal(0n);

      const bobBalance = await getBalance(bob);
      expect(bobBalance).to.equal(10_000_000n);
    });

    it("should transfer 1 micro unit (smallest possible amount)", async function () {
      await encryptedTransfer(alice, bob, 1n);

      const aliceBalance = await getBalance(alice);
      expect(aliceBalance).to.equal(9_999_999n);

      const bobBalance = await getBalance(bob);
      expect(bobBalance).to.equal(1n);
    });

    it("should transfer to self (balance unchanged)", async function () {
      await encryptedTransfer(alice, alice, 5_000_000n);

      const aliceBalance = await getBalance(alice);
      expect(aliceBalance).to.equal(10_000_000n);
    });

    it("should revert when transferring to zero address (TransferToZero)", async function () {
      const input = fhevm.createEncryptedInput(tokenAddress, alice.address);
      input.add64(1_000_000n);
      const encrypted = await input.encrypt();

      await expect(
        token.connect(alice).transfer(ethers.ZeroAddress, encrypted.handles[0], encrypted.inputProof)
      ).to.be.revertedWithCustomError(token, "TransferToZero");
    });

    it("should silently fail when transferring from zero-balance account (FHE select caps to 0)", async function () {
      // Bob has no balance, tries to transfer
      await token.mint(bob.address, 0n).catch(() => {}); // mint 0 reverts, so bob is uninitialized

      // Initialize bob with a tiny amount then transfer it away
      await token.mint(bob.address, 1n);
      await encryptedTransfer(bob, carol, 1n);

      // Now bob has 0 balance, try to transfer
      await encryptedTransfer(bob, carol, 5_000_000n);

      // Bob still has 0
      const bobBalance = await getBalance(bob);
      expect(bobBalance).to.equal(0n);

      // Carol only received the original 1
      const carolBalance = await getBalance(carol);
      expect(carolBalance).to.equal(1n);
    });

    it("should handle multiple transfers in sequence correctly", async function () {
      await encryptedTransfer(alice, bob, 2_000_000n);
      await encryptedTransfer(alice, bob, 3_000_000n);
      await encryptedTransfer(alice, bob, 1_000_000n);

      const aliceBalance = await getBalance(alice);
      expect(aliceBalance).to.equal(4_000_000n);

      const bobBalance = await getBalance(bob);
      expect(bobBalance).to.equal(6_000_000n);
    });

    it("should support chain of transfers (A -> B -> C)", async function () {
      // Alice sends 5M to Bob
      await encryptedTransfer(alice, bob, 5_000_000n);

      // Bob sends 3M to Carol
      await encryptedTransfer(bob, carol, 3_000_000n);

      const aliceBalance = await getBalance(alice);
      expect(aliceBalance).to.equal(5_000_000n);

      const bobBalance = await getBalance(bob);
      expect(bobBalance).to.equal(2_000_000n);

      const carolBalance = await getBalance(carol);
      expect(carolBalance).to.equal(3_000_000n);
    });
  });

  // ===============================================================
  // 3. APPROVAL EDGE CASES
  // ===============================================================
  describe("3. Approval Edge Cases", function () {
    beforeEach(async function () {
      await token.mint(alice.address, 10_000_000n);
    });

    it("should approve 0 amount without error", async function () {
      await token.connect(alice).approvePlaintext(bob.address, 0);

      const allowance = await token.allowancePlaintext(alice.address, bob.address);
      expect(allowance).to.equal(0n);
    });

    it("should approve max uint64", async function () {
      const maxUint64 = 18446744073709551615n;
      await token.connect(alice).approvePlaintext(bob.address, maxUint64);

      const allowance = await token.allowancePlaintext(alice.address, bob.address);
      expect(allowance).to.equal(maxUint64);
    });

    it("should override existing approval with new value", async function () {
      await token.connect(alice).approvePlaintext(bob.address, 5_000_000);

      const allowanceBefore = await token.allowancePlaintext(alice.address, bob.address);
      expect(allowanceBefore).to.equal(5_000_000n);

      // Override with a different amount
      await token.connect(alice).approvePlaintext(bob.address, 2_000_000);

      const allowanceAfter = await token.allowancePlaintext(alice.address, bob.address);
      expect(allowanceAfter).to.equal(2_000_000n);
    });

    it("should set plaintext approval and verify with allowancePlaintext", async function () {
      await token.connect(alice).approvePlaintext(bob.address, 7_500_000);

      const ptAllowance = await token.allowancePlaintext(alice.address, bob.address);
      expect(ptAllowance).to.equal(7_500_000n);

      // Also verify the encrypted allowance matches
      const encAllowance = await token.allowance(alice.address, bob.address);
      const decryptedAllowance = await fhevm.userDecryptEuint(
        FhevmType.euint64, encAllowance, tokenAddress, alice
      );
      expect(decryptedAllowance).to.equal(7_500_000n);
    });

    it("should allow approving self as spender", async function () {
      await token.connect(alice).approvePlaintext(alice.address, 1_000_000);

      const allowance = await token.allowancePlaintext(alice.address, alice.address);
      expect(allowance).to.equal(1_000_000n);
    });

    it("should approve multiple spenders independently from same owner", async function () {
      await token.connect(alice).approvePlaintext(bob.address, 3_000_000);
      await token.connect(alice).approvePlaintext(carol.address, 5_000_000);
      await token.connect(alice).approvePlaintext(dave.address, 1_000_000);

      expect(await token.allowancePlaintext(alice.address, bob.address)).to.equal(3_000_000n);
      expect(await token.allowancePlaintext(alice.address, carol.address)).to.equal(5_000_000n);
      expect(await token.allowancePlaintext(alice.address, dave.address)).to.equal(1_000_000n);
    });

    it("should emit Approval event on approvePlaintext", async function () {
      const tx = await token.connect(alice).approvePlaintext(bob.address, 5_000_000);
      const receipt = await tx.wait();

      const event = findEvent(receipt, token, "Approval");
      expect(event).to.not.be.null;
      expect(event.args.owner).to.equal(alice.address);
      expect(event.args.spender).to.equal(bob.address);
    });
  });

  // ===============================================================
  // 4. BALANCE AND SUPPLY TRACKING
  // ===============================================================
  describe("4. Balance and Supply Tracking", function () {
    it("should return euint64(0) for unminted address balance", async function () {
      // Mint to alice so the token is initialized, then check an unrelated address
      await token.mint(alice.address, 1_000_000n);

      // Bob has no balance — balanceOf returns a zero euint64 handle
      const encBalance = await token.balanceOf(bob.address);
      // The handle should be 0n (uninitialized mapping returns default euint64)
      expect(encBalance).to.equal(0n);
    });

    it("should track total supply correctly after multiple mints and transfers", async function () {
      await token.mint(alice.address, 10_000_000n);
      await token.mint(bob.address, 5_000_000n);
      await token.mint(carol.address, 3_000_000n);

      // Total supply = 18M (transfers don't change supply)
      expect(await token.totalSupply()).to.equal(18_000_000n);

      // Transfer between users
      await encryptedTransfer(alice, bob, 2_000_000n);
      await encryptedTransfer(bob, carol, 1_000_000n);

      // Total supply unchanged by transfers
      expect(await token.totalSupply()).to.equal(18_000_000n);

      // Verify individual balances still add up
      const aliceBalance = await getBalance(alice);
      const bobBalance = await getBalance(bob);
      const carolBalance = await getBalance(carol);
      expect(aliceBalance + bobBalance + carolBalance).to.equal(18_000_000n);
    });

    it("should return an encrypted handle (not plaintext) from balanceOf", async function () {
      await token.mint(alice.address, 5_000_000n);

      const encBalance = await token.balanceOf(alice.address);
      // The encrypted balance is a euint64 handle (uint256 internally).
      // It should NOT equal the plaintext value — it's a FHE ciphertext reference.
      // In the mock, handles are non-trivial uint256 values.
      // The encrypted balance is a handle — could be bigint or hex string depending on mock
      expect(encBalance).to.not.be.undefined;
      expect(encBalance).to.not.equal(0);
      expect(encBalance).to.not.equal(0n);
    });

    it("should accumulate balance when minting to same address multiple times", async function () {
      await token.mint(alice.address, 1_000_000n);
      await token.mint(alice.address, 1_000_000n);
      await token.mint(alice.address, 1_000_000n);
      await token.mint(alice.address, 1_000_000n);
      await token.mint(alice.address, 1_000_000n);

      expect(await token.totalSupply()).to.equal(5_000_000n);

      const balance = await getBalance(alice);
      expect(balance).to.equal(5_000_000n);
    });

    it("should leave balance unchanged after insufficient transfer (FHE silent failure)", async function () {
      await token.mint(alice.address, 3_000_000n);

      // Attempt to transfer more than balance
      await encryptedTransfer(alice, bob, 10_000_000n);

      // Alice balance should remain unchanged (FHE.select caps to 0)
      const aliceBalance = await getBalance(alice);
      expect(aliceBalance).to.equal(3_000_000n);

      // Bob should have 0 (initialized but received nothing)
      const bobBalance = await getBalance(bob);
      expect(bobBalance).to.equal(0n);
    });
  });

  // ===============================================================
  // 5. INTEGRATION SCENARIOS
  // ===============================================================
  describe("5. Integration Scenarios", function () {
    it("should complete mint -> approve -> transferFromChecked flow via market contract", async function () {
      await token.mint(alice.address, 50_000_000n);

      // Deploy a market to test transferFromChecked (it requires contract caller)
      const block = await ethers.provider.getBlock("latest");
      const deadline = block!.timestamp + 86400;

      const OpaqueMarket = await ethers.getContractFactory("OpaqueMarket");
      const market = await OpaqueMarket.deploy(
        "Test?",
        deadline,
        "Source",
        "Type",
        "Criteria",
        "crypto",
        deployer.address,
        deployer.address,
        tokenAddress,
        deployer.address,
      );
      await market.waitForDeployment();
      const marketAddress = await market.getAddress();

      // Alice approves market
      await token.connect(alice).approvePlaintext(marketAddress, 50_000_000);

      // Alice mints shares (triggers transferFromChecked internally)
      const input = fhevm.createEncryptedInput(marketAddress, alice.address);
      input.add64(10_000_000n);
      const encrypted = await input.encrypt();

      await market.connect(alice).mintShares(encrypted.handles[0], encrypted.inputProof);

      // Verify alice's balance decreased by 10M
      const aliceBalance = await getBalance(alice);
      expect(aliceBalance).to.equal(40_000_000n);
    });

    it("should handle mint -> transfer -> recipient transfers to third party", async function () {
      await token.mint(alice.address, 20_000_000n);

      // Alice -> Bob: 12M
      await encryptedTransfer(alice, bob, 12_000_000n);

      // Bob -> Carol: 8M
      await encryptedTransfer(bob, carol, 8_000_000n);

      const aliceBalance = await getBalance(alice);
      expect(aliceBalance).to.equal(8_000_000n);

      const bobBalance = await getBalance(bob);
      expect(bobBalance).to.equal(4_000_000n);

      const carolBalance = await getBalance(carol);
      expect(carolBalance).to.equal(8_000_000n);

      // Total should be conserved
      expect(aliceBalance + bobBalance + carolBalance).to.equal(20_000_000n);
    });

    it("should mint to 5 addresses and verify all balances", async function () {
      const amounts = [1_000_000n, 2_000_000n, 3_000_000n, 4_000_000n, 5_000_000n];
      const addresses = [alice, bob, carol, dave, eve];

      for (let i = 0; i < addresses.length; i++) {
        await token.mint(addresses[i].address, amounts[i]);
      }

      // Verify total supply
      expect(await token.totalSupply()).to.equal(15_000_000n);

      // Verify each balance individually
      for (let i = 0; i < addresses.length; i++) {
        const balance = await getBalance(addresses[i]);
        expect(balance).to.equal(amounts[i]);
      }
    });

    it("should reduce approval by overriding with lower amount", async function () {
      await token.mint(alice.address, 10_000_000n);

      // Set high approval
      await token.connect(alice).approvePlaintext(bob.address, 10_000_000);
      expect(await token.allowancePlaintext(alice.address, bob.address)).to.equal(10_000_000n);

      // Override with lower amount
      await token.connect(alice).approvePlaintext(bob.address, 2_000_000);
      expect(await token.allowancePlaintext(alice.address, bob.address)).to.equal(2_000_000n);

      // Verify encrypted allowance also reflects the reduced amount
      const encAllowance = await token.allowance(alice.address, bob.address);
      const decrypted = await fhevm.userDecryptEuint(FhevmType.euint64, encAllowance, tokenAddress, alice);
      expect(decrypted).to.equal(2_000_000n);
    });

    it("should complete full lifecycle: mint -> approve -> transferFrom via market -> check balance", async function () {
      await token.mint(alice.address, 100_000_000n);

      // Deploy a market
      const block = await ethers.provider.getBlock("latest");
      const deadline = block!.timestamp + 86400;

      const OpaqueMarket = await ethers.getContractFactory("OpaqueMarket");
      const market = await OpaqueMarket.deploy(
        "Lifecycle test?",
        deadline,
        "Source",
        "Type",
        "Criteria",
        "crypto",
        deployer.address,
        deployer.address,
        tokenAddress,
        deployer.address,
      );
      await market.waitForDeployment();
      const marketAddress = await market.getAddress();

      // Step 1: Alice approves market for 30M
      await token.connect(alice).approvePlaintext(marketAddress, 30_000_000);

      // Step 2: Alice mints 10M shares (triggers transferFromChecked)
      const input1 = fhevm.createEncryptedInput(marketAddress, alice.address);
      input1.add64(10_000_000n);
      const encrypted1 = await input1.encrypt();
      await market.connect(alice).mintShares(encrypted1.handles[0], encrypted1.inputProof);

      // Step 3: Alice mints another 15M shares
      const input2 = fhevm.createEncryptedInput(marketAddress, alice.address);
      input2.add64(15_000_000n);
      const encrypted2 = await input2.encrypt();
      await market.connect(alice).mintShares(encrypted2.handles[0], encrypted2.inputProof);

      // Step 4: Check balance — started with 100M, spent 25M
      const aliceBalance = await getBalance(alice);
      expect(aliceBalance).to.equal(75_000_000n);

      // Step 5: Verify total supply unchanged (transfers don't alter supply)
      expect(await token.totalSupply()).to.equal(100_000_000n);
    });
  });

  // ===============================================================
  // 6. ADDITIONAL EDGE CASES
  // ===============================================================
  describe("6. Additional Edge Cases", function () {
    it("should emit Mint event with correct args", async function () {
      const tx = await token.mint(alice.address, 5_000_000);
      const receipt = await tx.wait();

      const event = findEvent(receipt, token, "Mint");
      expect(event).to.not.be.null;
      expect(event.args.to).to.equal(alice.address);
      expect(event.args.amount).to.equal(5_000_000n);
    });

    it("should emit Transfer event on encrypted transfer", async function () {
      await token.mint(alice.address, 10_000_000n);

      const tx = await encryptedTransfer(alice, bob, 3_000_000n);
      const receipt = await tx.wait();

      const event = findEvent(receipt, token, "Transfer");
      expect(event).to.not.be.null;
      expect(event.args.from).to.equal(alice.address);
      expect(event.args.to).to.equal(bob.address);
    });

    it("should emit Approval event on encrypted approve", async function () {
      await token.mint(alice.address, 10_000_000n);

      const tx = await encryptedApprove(alice, bob, 5_000_000n);
      const receipt = await tx.wait();

      const event = findEvent(receipt, token, "Approval");
      expect(event).to.not.be.null;
      expect(event.args.owner).to.equal(alice.address);
      expect(event.args.spender).to.equal(bob.address);
    });

    it("should verify encrypted approve sets allowance correctly", async function () {
      await token.mint(alice.address, 10_000_000n);

      await encryptedApprove(alice, bob, 4_000_000n);

      const encAllowance = await token.allowance(alice.address, bob.address);
      const decrypted = await fhevm.userDecryptEuint(FhevmType.euint64, encAllowance, tokenAddress, alice);
      expect(decrypted).to.equal(4_000_000n);
    });

    it("should report correct owner", async function () {
      expect(await token.owner()).to.equal(deployer.address);
    });

    it("should report correct token metadata", async function () {
      expect(await token.name()).to.equal("Confidential USDT");
      expect(await token.symbol()).to.equal("cUSDT");
      expect(await token.decimals()).to.equal(6);
    });
  });
});
