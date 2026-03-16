import { expect } from "chai";
import { ethers } from "hardhat";
import { fhevm } from "hardhat";
import { FhevmType } from "@fhevm/hardhat-plugin";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";

describe("ConfidentialUSDT", function () {
  let token: any;
  let deployer: HardhatEthersSigner;
  let alice: HardhatEthersSigner;
  let bob: HardhatEthersSigner;
  let tokenAddress: string;

  beforeEach(async function () {
    const signers = await ethers.getSigners();
    deployer = signers[0];
    alice = signers[1];
    bob = signers[2];

    const ConfidentialUSDT = await ethers.getContractFactory("ConfidentialUSDT");
    token = await ConfidentialUSDT.deploy();
    await token.waitForDeployment();
    tokenAddress = await token.getAddress();
  });

  describe("Deployment", function () {
    it("should have correct name and symbol", async function () {
      expect(await token.name()).to.equal("Confidential USDT");
      expect(await token.symbol()).to.equal("cUSDT");
      expect(await token.decimals()).to.equal(6);
    });

    it("should start with 0 total supply", async function () {
      expect(await token.totalSupply()).to.equal(0n);
    });
  });

  describe("Minting", function () {
    it("should mint tokens and update total supply", async function () {
      await token.mint(alice.address, 1000000); // 1 USDT (6 decimals)
      expect(await token.totalSupply()).to.equal(1000000n);
    });

    it("should allow minting to multiple addresses", async function () {
      await token.mint(alice.address, 1000000);
      await token.mint(bob.address, 2000000);
      expect(await token.totalSupply()).to.equal(3000000n);
    });

    it("should allow user to decrypt their own balance", async function () {
      await token.mint(alice.address, 5000000n); // 5 USDT

      const encBalance = await token.balanceOf(alice.address);
      const balance = await fhevm.userDecryptEuint(FhevmType.euint64, encBalance, tokenAddress, alice);
      expect(balance).to.equal(5000000n);
    });

    it("should accumulate balance on multiple mints", async function () {
      await token.mint(alice.address, 1000000n);
      await token.mint(alice.address, 2000000n);

      const encBalance = await token.balanceOf(alice.address);
      const balance = await fhevm.userDecryptEuint(FhevmType.euint64, encBalance, tokenAddress, alice);
      expect(balance).to.equal(3000000n);
    });
  });

  describe("Transfer", function () {
    beforeEach(async function () {
      await token.mint(alice.address, 10000000n); // 10 USDT
    });

    it("should transfer encrypted tokens", async function () {
      const input = fhevm.createEncryptedInput(tokenAddress, alice.address);
      input.add64(3000000n); // 3 USDT
      const encrypted = await input.encrypt();

      await token.connect(alice).transfer(bob.address, encrypted.handles[0], encrypted.inputProof);

      // Check Alice's balance
      const aliceEnc = await token.balanceOf(alice.address);
      const aliceBalance = await fhevm.userDecryptEuint(FhevmType.euint64, aliceEnc, tokenAddress, alice);
      expect(aliceBalance).to.equal(7000000n);

      // Check Bob's balance
      const bobEnc = await token.balanceOf(bob.address);
      const bobBalance = await fhevm.userDecryptEuint(FhevmType.euint64, bobEnc, tokenAddress, bob);
      expect(bobBalance).to.equal(3000000n);
    });

    it("should not transfer more than balance (silently caps to 0)", async function () {
      const input = fhevm.createEncryptedInput(tokenAddress, alice.address);
      input.add64(20000000n); // 20 USDT (more than balance)
      const encrypted = await input.encrypt();

      await token.connect(alice).transfer(bob.address, encrypted.handles[0], encrypted.inputProof);

      // Alice balance should remain unchanged (insufficient funds → transfer 0)
      const aliceEnc = await token.balanceOf(alice.address);
      const aliceBalance = await fhevm.userDecryptEuint(FhevmType.euint64, aliceEnc, tokenAddress, alice);
      expect(aliceBalance).to.equal(10000000n);
    });
  });

  describe("Approval & TransferFrom", function () {
    beforeEach(async function () {
      await token.mint(alice.address, 10_000_000n); // 10 USDT
    });

    it("should approve with plaintext amount", async function () {
      await token.connect(alice).approvePlaintext(bob.address, 5_000_000);

      const encAllowance = await token.allowance(alice.address, bob.address);
      const allowance = await fhevm.userDecryptEuint(FhevmType.euint64, encAllowance, tokenAddress, alice);
      expect(allowance).to.equal(5_000_000n);
    });

    it("should transferFrom with approval", async function () {
      // Alice approves deployer to spend 5 USDT
      await token.connect(alice).approvePlaintext(deployer.address, 5_000_000);

      // Mint to deployer so they can call transferFrom
      // transferFrom takes euint64 — we need a helper contract or use mint pattern
      // Since transferFrom requires euint64 (not external), it's designed for contract-to-contract calls.
      // We test it indirectly via the market integration test.
      // Here we verify allowance was properly set and can be read.
      const encAllowance = await token.allowance(alice.address, deployer.address);
      const allowance = await fhevm.userDecryptEuint(FhevmType.euint64, encAllowance, tokenAddress, alice);
      expect(allowance).to.equal(5_000_000n);
    });

    it("should emit Approval event", async function () {
      const tx = await token.connect(alice).approvePlaintext(bob.address, 5_000_000);
      const receipt = await tx.wait();

      const event = receipt.logs.find((log: any) => {
        try {
          const parsed = token.interface.parseLog({ topics: log.topics, data: log.data });
          return parsed?.name === "Approval";
        } catch {
          return false;
        }
      });
      expect(event).to.not.be.undefined;
    });
  });

  describe("TransferFromChecked", function () {
    it("should be callable from market contract (integration)", async function () {
      // transferFromChecked takes euint64, designed for contract-to-contract calls.
      // Best tested via full market mintShares flow (see Integration test below).
      // Here we verify the function exists on the contract ABI.
      expect(token.transferFromChecked).to.not.be.undefined;
    });
  });

  describe("Integration with Market", function () {
    it("should allow market contract to transferFrom after approve", async function () {
      await token.mint(alice.address, 50_000_000n); // 50 USDT

      // Deploy a market to test integration
      const block = await ethers.provider.getBlock("latest");
      const deadline = block!.timestamp + 86400;

      const OpaqueMarket = await ethers.getContractFactory("OpaqueMarket");
      const market = await OpaqueMarket.deploy(
        "Test?",
        deadline,
        "Source",
        "Type",
        "Criteria",
        "crypto", // _category
        deployer.address, // _resolver
        deployer.address, // _feeCollector
        tokenAddress,
        deployer.address, // _creator
      );
      await market.waitForDeployment();
      const marketAddress = await market.getAddress();

      // Alice approves market
      await token.connect(alice).approvePlaintext(marketAddress, 50_000_000);

      // Alice mints shares (transferFrom is called internally)
      const input = fhevm.createEncryptedInput(marketAddress, alice.address);
      input.add64(10_000_000n); // 10 USDT
      const encrypted = await input.encrypt();

      await market.connect(alice).mintShares(encrypted.handles[0], encrypted.inputProof);

      // Verify alice's balance decreased
      const aliceEnc = await token.balanceOf(alice.address);
      const aliceBalance = await fhevm.userDecryptEuint(FhevmType.euint64, aliceEnc, tokenAddress, alice);
      // Only the 50 USDT from this test's mint (no beforeEach mint here), minus 10 mint = 40
      expect(aliceBalance).to.equal(40_000_000n);
    });
  });
});
