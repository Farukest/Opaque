/**
 * OPAQUE V3 SDK Unit Tests
 *
 * Mock-based tests — no network connection needed.
 * Tests cover: type exports, ABI correctness, address validation,
 * constants, client instantiation, method existence, FHE helpers, and error handling.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { ethers } from "ethers";

// ═══════════════════════════════════════
// IMPORTS
// ═══════════════════════════════════════

import {
  // Client
  OpaqueClient,
  OpaqueMarketClient,
  ConfidentialTokenClient,
  MarketFactoryClient,

  // ABIs
  OPAQUE_MARKET_ABI,
  MARKET_FACTORY_ABI,
  MARKET_GROUP_ABI,
  ORACLE_RESOLVER_ABI,
  CUSDT_ABI,

  // Addresses
  SEPOLIA_ADDRESSES,
  SEPOLIA_CHAIN_ID,
  getAddresses,

  // Constants
  SIDE_YES,
  SIDE_NO,
  SHARE_UNIT,
  BPS,
  PRICE_TO_USDT,
  FEE_BPS,
  TRADE_FEE_BPS,
  WITHDRAW_FEE,
  MAX_ACTIVE_ORDERS,
  GRACE_PERIOD,
  DECRYPT_TIMEOUT,
  MIN_PRICE,
  MAX_PRICE,
  TOKEN_DECIMALS,

  // Utility functions
  formatPrice,
  priceToPercent,
  dollarsToMicro,
  microToDollars,
  isValidPrice,

  // FHE helpers
  initFhe,
  resetFheInstance,
  encryptSide,
  encryptAmount,
  encryptOrderInputs,
  toHex,
  handleToBytes32,
} from "../src/index";

import type {
  Side,
  SideValue,
  MarketInfo,
  Order,
  PriceLevel,
  BestPrices,
  ShareBalances,
  GroupInfo,
  GroupOutcome,
  MarketGroupData,
  CreateMarketParams,
  OpaqueClientConfig,
  FheInstance,
  EncryptedInput,
  EncryptedInputResult,
  SharesMintedEvent,
  OrderPlacedEvent,
  OrderCancelledEvent,
  MatchAttemptedEvent,
  MarketResolvedEvent,
  MarketCreatedEvent,
} from "../src/index";

// ═══════════════════════════════════════
// MOCK HELPERS
// ═══════════════════════════════════════

function createMockProvider(): ethers.Provider {
  return {
    getNetwork: vi.fn().mockResolvedValue({ chainId: 11155111n }),
    getBlockNumber: vi.fn().mockResolvedValue(1000),
    getBalance: vi.fn().mockResolvedValue(0n),
    call: vi.fn().mockResolvedValue("0x"),
  } as unknown as ethers.Provider;
}

function createMockSigner(): ethers.Signer {
  return {
    getAddress: vi.fn().mockResolvedValue("0xF505e2E71df58D7244189072008f25f6b6aaE5ae"),
    sendTransaction: vi.fn(),
    provider: createMockProvider(),
  } as unknown as ethers.Signer;
}

function createMockFheInstance(): FheInstance {
  const mockEncryptedResult: EncryptedInputResult = {
    handles: [new Uint8Array(32).fill(0xab)],
    inputProof: new Uint8Array(64).fill(0xcd),
  };

  return {
    createEncryptedInput: vi.fn().mockReturnValue({
      addBool: vi.fn().mockReturnThis(),
      add4: vi.fn().mockReturnThis(),
      add8: vi.fn().mockReturnThis(),
      add16: vi.fn().mockReturnThis(),
      add32: vi.fn().mockReturnThis(),
      add64: vi.fn().mockReturnThis(),
      add128: vi.fn().mockReturnThis(),
      addAddress: vi.fn().mockReturnThis(),
      encrypt: vi.fn().mockReturnValue(mockEncryptedResult),
    }),
  };
}

// ═══════════════════════════════════════
// TESTS: CONSTANTS
// ═══════════════════════════════════════

describe("Constants", () => {
  it("should have correct SIDE values", () => {
    expect(SIDE_YES).toBe(0);
    expect(SIDE_NO).toBe(1);
  });

  it("should have correct SHARE_UNIT (1_000_000)", () => {
    expect(SHARE_UNIT).toBe(1_000_000n);
  });

  it("should have correct BPS (10_000)", () => {
    expect(BPS).toBe(10_000);
  });

  it("should have correct PRICE_TO_USDT (100)", () => {
    expect(PRICE_TO_USDT).toBe(100n);
  });

  it("should have correct fee constants", () => {
    expect(FEE_BPS).toBe(50);
    expect(TRADE_FEE_BPS).toBe(5);
    expect(WITHDRAW_FEE).toBe(1_000_000n);
  });

  it("should have correct MAX_ACTIVE_ORDERS (200)", () => {
    expect(MAX_ACTIVE_ORDERS).toBe(200);
  });

  it("should have correct time constants", () => {
    expect(GRACE_PERIOD).toBe(7 * 24 * 60 * 60); // 7 days
    expect(DECRYPT_TIMEOUT).toBe(7 * 24 * 60 * 60); // 7 days
  });

  it("should have correct price range", () => {
    expect(MIN_PRICE).toBe(100);
    expect(MAX_PRICE).toBe(9900);
  });

  it("should have correct TOKEN_DECIMALS (6)", () => {
    expect(TOKEN_DECIMALS).toBe(6);
  });
});

// ═══════════════════════════════════════
// TESTS: UTILITY FUNCTIONS
// ═══════════════════════════════════════

describe("Utility Functions", () => {
  it("formatPrice should convert BPS to dollar string", () => {
    expect(formatPrice(5000)).toBe("$0.50");
    expect(formatPrice(100)).toBe("$0.01");
    expect(formatPrice(9900)).toBe("$0.99");
    expect(formatPrice(2500)).toBe("$0.25");
  });

  it("priceToPercent should convert BPS to percentage", () => {
    expect(priceToPercent(5000)).toBe(50);
    expect(priceToPercent(100)).toBe(1);
    expect(priceToPercent(9900)).toBe(99);
  });

  it("dollarsToMicro should convert dollars to micro-cUSDT", () => {
    expect(dollarsToMicro(1)).toBe(1_000_000n);
    expect(dollarsToMicro(1.5)).toBe(1_500_000n);
    expect(dollarsToMicro(0.01)).toBe(10_000n);
    expect(dollarsToMicro(100)).toBe(100_000_000n);
  });

  it("microToDollars should convert micro-cUSDT to dollars", () => {
    expect(microToDollars(1_000_000n)).toBe(1);
    expect(microToDollars(1_500_000n)).toBe(1.5);
    expect(microToDollars(10_000n)).toBe(0.01);
  });

  it("isValidPrice should validate price range", () => {
    expect(isValidPrice(100)).toBe(true);
    expect(isValidPrice(9900)).toBe(true);
    expect(isValidPrice(5000)).toBe(true);
    expect(isValidPrice(99)).toBe(false);
    expect(isValidPrice(9901)).toBe(false);
    expect(isValidPrice(0)).toBe(false);
    expect(isValidPrice(-100)).toBe(false);
    expect(isValidPrice(5000.5)).toBe(false); // not integer
  });
});

// ═══════════════════════════════════════
// TESTS: ADDRESSES
// ═══════════════════════════════════════

describe("Addresses", () => {
  it("should have correct Sepolia chain ID", () => {
    expect(SEPOLIA_CHAIN_ID).toBe(11155111);
  });

  it("should have valid Sepolia addresses", () => {
    expect(ethers.isAddress(SEPOLIA_ADDRESSES.ConfidentialUSDT)).toBe(true);
    expect(ethers.isAddress(SEPOLIA_ADDRESSES.OracleResolver)).toBe(true);
    expect(ethers.isAddress(SEPOLIA_ADDRESSES.MarketFactory)).toBe(true);
    expect(ethers.isAddress(SEPOLIA_ADDRESSES.MarketGroup)).toBe(true);
  });

  it("should have correct Sepolia v7 addresses", () => {
    expect(SEPOLIA_ADDRESSES.ConfidentialUSDT).toBe("0xc35eA8889D2C09B2bCF3641236D325C4dF7318f1");
    expect(SEPOLIA_ADDRESSES.OracleResolver).toBe("0x165C3B6635EB21A22cEc631046810941BC8731b9");
    expect(SEPOLIA_ADDRESSES.MarketFactory).toBe("0x29B59C016616e644297a2b38Cf4Ef60E0F03a29B");
    expect(SEPOLIA_ADDRESSES.MarketGroup).toBe("0x96A89c4de09054Bcb4222E3868d9a44ecC52Cca9");
  });

  it("getAddresses should return Sepolia addresses for chain 11155111", () => {
    const addrs = getAddresses(11155111);
    expect(addrs).toBe(SEPOLIA_ADDRESSES);
  });

  it("getAddresses should throw for unsupported chain ID", () => {
    expect(() => getAddresses(1)).toThrow("Unsupported chain ID: 1");
    expect(() => getAddresses(42161)).toThrow("Unsupported chain ID");
  });
});

// ═══════════════════════════════════════
// TESTS: ABIs
// ═══════════════════════════════════════

describe("ABIs", () => {
  it("OPAQUE_MARKET_ABI should contain core view functions", () => {
    const abi = OPAQUE_MARKET_ABI.join("\n");
    expect(abi).toContain("getMarketInfo");
    expect(abi).toContain("getCurrentPrice");
    expect(abi).toContain("getOrder");
    expect(abi).toContain("getBestPrices");
    expect(abi).toContain("getMyShares");
    expect(abi).toContain("getUserOrders");
    expect(abi).toContain("getPriceLevel");
    expect(abi).toContain("hasUserShares");
  });

  it("OPAQUE_MARKET_ABI should contain core mutating functions", () => {
    const abi = OPAQUE_MARKET_ABI.join("\n");
    expect(abi).toContain("mintShares");
    expect(abi).toContain("burnShares");
    expect(abi).toContain("placeOrder");
    expect(abi).toContain("cancelOrder");
    expect(abi).toContain("cancelOrders");
    expect(abi).toContain("attemptMatch");
    expect(abi).toContain("requestRedemption");
    expect(abi).toContain("resolve");
  });

  it("OPAQUE_MARKET_ABI should contain events", () => {
    const abi = OPAQUE_MARKET_ABI.join("\n");
    expect(abi).toContain("event SharesMinted");
    expect(abi).toContain("event OrderPlaced");
    expect(abi).toContain("event OrderCancelled");
    expect(abi).toContain("event MatchAttempted");
    expect(abi).toContain("event MarketResolved");
    expect(abi).toContain("event RedemptionRequested");
  });

  it("MARKET_FACTORY_ABI should contain factory functions", () => {
    const abi = MARKET_FACTORY_ABI.join("\n");
    expect(abi).toContain("createMarket");
    expect(abi).toContain("createMarketWithResolver");
    expect(abi).toContain("getMarketCount");
    expect(abi).toContain("getAllMarkets");
    expect(abi).toContain("event MarketCreated");
  });

  it("MARKET_GROUP_ABI should contain group functions", () => {
    const abi = MARKET_GROUP_ABI.join("\n");
    expect(abi).toContain("getGroupInfo");
    expect(abi).toContain("getOutcome");
    expect(abi).toContain("addOutcome");
    expect(abi).toContain("resolveGroup");
    expect(abi).toContain("outcomeCount");
  });

  it("ORACLE_RESOLVER_ABI should contain resolver functions", () => {
    const abi = ORACLE_RESOLVER_ABI.join("\n");
    expect(abi).toContain("resolveChainlink");
    expect(abi).toContain("resolveOnchain");
    expect(abi).toContain("resolveDirectly");
    expect(abi).toContain("getConfig");
  });

  it("CUSDT_ABI should contain token functions", () => {
    const abi = CUSDT_ABI.join("\n");
    expect(abi).toContain("balanceOf");
    expect(abi).toContain("mint");
    expect(abi).toContain("transfer");
    expect(abi).toContain("approvePlaintext");
    expect(abi).toContain("allowancePlaintext");
    expect(abi).toContain("totalSupply");
  });

  it("ABIs should be parseable by ethers.Interface", () => {
    expect(() => new ethers.Interface(OPAQUE_MARKET_ABI)).not.toThrow();
    expect(() => new ethers.Interface(MARKET_FACTORY_ABI)).not.toThrow();
    expect(() => new ethers.Interface(MARKET_GROUP_ABI)).not.toThrow();
    expect(() => new ethers.Interface(ORACLE_RESOLVER_ABI)).not.toThrow();
    expect(() => new ethers.Interface(CUSDT_ABI)).not.toThrow();
  });
});

// ═══════════════════════════════════════
// TESTS: CLIENT INSTANTIATION
// ═══════════════════════════════════════

describe("OpaqueClient", () => {
  let provider: ethers.Provider;
  let signer: ethers.Signer;

  beforeEach(() => {
    provider = createMockProvider();
    signer = createMockSigner();
  });

  it("should instantiate with provider only (read-only)", () => {
    const client = new OpaqueClient({ provider });
    expect(client.provider).toBe(provider);
    expect(client.signer).toBeUndefined();
    expect(client.chainId).toBe(SEPOLIA_CHAIN_ID);
    expect(client.hasSigner()).toBe(false);
  });

  it("should instantiate with provider and signer", () => {
    const client = new OpaqueClient({ provider, signer });
    expect(client.provider).toBe(provider);
    expect(client.signer).toBe(signer);
    expect(client.hasSigner()).toBe(true);
  });

  it("should accept custom chain ID", () => {
    const client = new OpaqueClient({ provider, chainId: 1 });
    expect(client.chainId).toBe(1);
  });

  it("should create market client with valid address", () => {
    const client = new OpaqueClient({ provider });
    const market = client.market(SEPOLIA_ADDRESSES.ConfidentialUSDT);
    expect(market).toBeInstanceOf(OpaqueMarketClient);
    expect(market.address).toBe(SEPOLIA_ADDRESSES.ConfidentialUSDT);
  });

  it("should throw on invalid market address", () => {
    const client = new OpaqueClient({ provider });
    expect(() => client.market("not-an-address")).toThrow("Invalid market address");
  });

  it("should create token client with default address", () => {
    const client = new OpaqueClient({ provider });
    const token = client.token();
    expect(token).toBeInstanceOf(ConfidentialTokenClient);
    expect(token.address).toBe(SEPOLIA_ADDRESSES.ConfidentialUSDT);
  });

  it("should create token client with custom address", () => {
    const addr = "0x0000000000000000000000000000000000000001";
    const client = new OpaqueClient({ provider });
    const token = client.token(addr);
    expect(token.address).toBe(addr);
  });

  it("should throw on invalid token address", () => {
    const client = new OpaqueClient({ provider });
    expect(() => client.token("bad")).toThrow("Invalid token address");
  });

  it("should create factory client with default address", () => {
    const client = new OpaqueClient({ provider });
    const factory = client.factory();
    expect(factory).toBeInstanceOf(MarketFactoryClient);
    expect(factory.address).toBe(SEPOLIA_ADDRESSES.MarketFactory);
  });

  it("should throw on invalid factory address", () => {
    const client = new OpaqueClient({ provider });
    expect(() => client.factory("bad")).toThrow("Invalid factory address");
  });

  it("should throw when getFhe called before initFhe", () => {
    const client = new OpaqueClient({ provider });
    expect(() => client.getFhe()).toThrow("FHE not initialized");
  });

  it("should return addresses for supported chain", () => {
    const client = new OpaqueClient({ provider });
    const addrs = client.getAddresses();
    expect(addrs).toBe(SEPOLIA_ADDRESSES);
  });

  it("should throw getAddresses for unsupported chain", () => {
    const client = new OpaqueClient({ provider, chainId: 999 });
    expect(() => client.getAddresses()).toThrow("Unsupported chain ID");
  });
});

// ═══════════════════════════════════════
// TESTS: MARKET CLIENT METHODS
// ═══════════════════════════════════════

describe("OpaqueMarketClient", () => {
  it("should have all expected methods", () => {
    const provider = createMockProvider();
    const market = new OpaqueMarketClient(SEPOLIA_ADDRESSES.ConfidentialUSDT, provider);

    // View methods
    expect(typeof market.getMarketInfo).toBe("function");
    expect(typeof market.getOrder).toBe("function");
    expect(typeof market.getUserOrders).toBe("function");
    expect(typeof market.getMyShares).toBe("function");
    expect(typeof market.getPriceLevel).toBe("function");
    expect(typeof market.getBestPrices).toBe("function");
    expect(typeof market.hasUserShares).toBe("function");
    expect(typeof market.getCurrentPrice).toBe("function");

    // Write methods
    expect(typeof market.mintShares).toBe("function");
    expect(typeof market.burnShares).toBe("function");
    expect(typeof market.placeOrder).toBe("function");
    expect(typeof market.cancelOrder).toBe("function");
    expect(typeof market.cancelOrders).toBe("function");
    expect(typeof market.attemptMatch).toBe("function");
    expect(typeof market.requestRedemption).toBe("function");
    expect(typeof market.emergencyWithdraw).toBe("function");
    expect(typeof market.emergencyRefundAfterResolution).toBe("function");
  });

  it("should store the contract address", () => {
    const provider = createMockProvider();
    const addr = "0x0000000000000000000000000000000000000042";
    const market = new OpaqueMarketClient(addr, provider);
    expect(market.address).toBe(addr);
  });

  it("should expose the ethers Contract instance", () => {
    const provider = createMockProvider();
    const market = new OpaqueMarketClient(SEPOLIA_ADDRESSES.ConfidentialUSDT, provider);
    expect(market.contract).toBeDefined();
  });
});

// ═══════════════════════════════════════
// TESTS: TOKEN CLIENT METHODS
// ═══════════════════════════════════════

describe("ConfidentialTokenClient", () => {
  it("should have all expected methods", () => {
    const provider = createMockProvider();
    const token = new ConfidentialTokenClient(provider);

    expect(typeof token.balanceOf).toBe("function");
    expect(typeof token.allowance).toBe("function");
    expect(typeof token.name).toBe("function");
    expect(typeof token.symbol).toBe("function");
    expect(typeof token.decimals).toBe("function");
    expect(typeof token.totalSupply).toBe("function");
    expect(typeof token.mint).toBe("function");
    expect(typeof token.transfer).toBe("function");
    expect(typeof token.approve).toBe("function");
    expect(typeof token.approvePlaintext).toBe("function");
  });

  it("should default to Sepolia cUSDT address", () => {
    const provider = createMockProvider();
    const token = new ConfidentialTokenClient(provider);
    expect(token.address).toBe(SEPOLIA_ADDRESSES.ConfidentialUSDT);
  });

  it("should accept custom address", () => {
    const provider = createMockProvider();
    const addr = "0x0000000000000000000000000000000000000099";
    const token = new ConfidentialTokenClient(provider, addr);
    expect(token.address).toBe(addr);
  });
});

// ═══════════════════════════════════════
// TESTS: FACTORY CLIENT METHODS
// ═══════════════════════════════════════

describe("MarketFactoryClient", () => {
  it("should have all expected methods", () => {
    const provider = createMockProvider();
    const factory = new MarketFactoryClient(provider);

    expect(typeof factory.createMarket).toBe("function");
    expect(typeof factory.getMarketCount).toBe("function");
    expect(typeof factory.getMarket).toBe("function");
    expect(typeof factory.getAllMarkets).toBe("function");
    expect(typeof factory.getOwner).toBe("function");
    expect(typeof factory.getDefaultResolver).toBe("function");
    expect(typeof factory.isCreationFeeEnabled).toBe("function");
    expect(typeof factory.getCreationFee).toBe("function");
    expect(typeof factory.getTokenAddress).toBe("function");
  });

  it("should default to Sepolia factory address", () => {
    const provider = createMockProvider();
    const factory = new MarketFactoryClient(provider);
    expect(factory.address).toBe(SEPOLIA_ADDRESSES.MarketFactory);
  });

  it("should validate required params in createMarket", async () => {
    const signer = createMockSigner();
    const factory = new MarketFactoryClient(signer);

    const baseParams: CreateMarketParams = {
      question: "Will BTC hit 100k?",
      deadline: Math.floor(Date.now() / 1000) + 86400,
      resolutionSource: "chainlink",
      resolutionSourceType: "crypto",
      resolutionCriteria: "BTC/USD > 100000",
      category: "crypto",
    };

    // Empty question
    await expect(factory.createMarket({ ...baseParams, question: " " })).rejects.toThrow(
      "Question is required",
    );

    // Empty resolution source
    await expect(factory.createMarket({ ...baseParams, resolutionSource: "" })).rejects.toThrow(
      "Resolution source is required",
    );

    // Past deadline
    await expect(factory.createMarket({ ...baseParams, deadline: 1000 })).rejects.toThrow(
      "Deadline must be in the future",
    );
  });
});

// ═══════════════════════════════════════
// TESTS: FHE HELPERS
// ═══════════════════════════════════════

describe("FHE Helpers", () => {
  beforeEach(() => {
    resetFheInstance();
  });

  it("initFhe should call createInstance and return the instance", async () => {
    const mockInstance = createMockFheInstance();
    const mockCreateInstance = vi.fn().mockResolvedValue(mockInstance);
    const config = { network: "https://rpc.sepolia.org" };

    const result = await initFhe(mockCreateInstance, config);
    expect(result).toBe(mockInstance);
    expect(mockCreateInstance).toHaveBeenCalledWith(config);
  });

  it("initFhe should return cached instance on second call", async () => {
    const mockInstance = createMockFheInstance();
    const mockCreateInstance = vi.fn().mockResolvedValue(mockInstance);
    const config = { network: "https://rpc.sepolia.org" };

    const result1 = await initFhe(mockCreateInstance, config);
    const result2 = await initFhe(mockCreateInstance, config);
    expect(result1).toBe(result2);
    expect(mockCreateInstance).toHaveBeenCalledTimes(1);
  });

  it("initFhe should reset on failure and allow retry", async () => {
    const mockCreateInstance = vi
      .fn()
      .mockRejectedValueOnce(new Error("init failed"))
      .mockResolvedValueOnce(createMockFheInstance());

    const config = { network: "https://rpc.sepolia.org" };

    await expect(initFhe(mockCreateInstance, config)).rejects.toThrow("init failed");

    // Should work on retry
    const result = await initFhe(mockCreateInstance, config);
    expect(result).toBeDefined();
    expect(mockCreateInstance).toHaveBeenCalledTimes(2);
  });

  it("encryptSide should encrypt YES as 0", () => {
    const fhe = createMockFheInstance();
    const result = encryptSide(fhe, "0x1234", "0x5678", "YES");

    expect(result.handles).toHaveLength(1);
    expect(result.inputProof).toBeDefined();
    expect(fhe.createEncryptedInput).toHaveBeenCalledWith("0x1234", "0x5678");
  });

  it("encryptSide should encrypt NO as 1", () => {
    const fhe = createMockFheInstance();
    const result = encryptSide(fhe, "0x1234", "0x5678", "NO");

    expect(result.handles).toHaveLength(1);
    const encInput = (fhe.createEncryptedInput as ReturnType<typeof vi.fn>).mock.results[0].value;
    expect(encInput.add8).toHaveBeenCalledWith(1);
  });

  it("encryptAmount should encrypt a bigint amount", () => {
    const fhe = createMockFheInstance();
    const result = encryptAmount(fhe, "0xabc", "0xdef", 10_000_000n);

    expect(result.handles).toHaveLength(1);
    expect(result.inputProof).toBeDefined();
    const encInput = (fhe.createEncryptedInput as ReturnType<typeof vi.fn>).mock.results[0].value;
    expect(encInput.add64).toHaveBeenCalledWith(10_000_000n);
  });

  it("encryptOrderInputs should return side and amount encrypted separately", () => {
    const fhe = createMockFheInstance();
    const result = encryptOrderInputs(fhe, "0xabc", "0xdef", "YES", 5_000_000n);

    expect(result.sideEncrypted).toBeDefined();
    expect(result.sideEncrypted.handles).toHaveLength(1);
    expect(result.amountEncrypted).toBeDefined();
    expect(result.amountEncrypted.handles).toHaveLength(1);
    expect(fhe.createEncryptedInput).toHaveBeenCalledTimes(2);
  });

  it("toHex should convert Uint8Array to hex string", () => {
    const bytes = new Uint8Array([0, 1, 255, 16]);
    expect(toHex(bytes)).toBe("0x0001ff10");
  });

  it("handleToBytes32 should pad short arrays to 32 bytes", () => {
    const short = new Uint8Array([1, 2, 3]);
    const result = handleToBytes32(short);
    expect(result).toHaveLength(66); // 0x + 64 hex chars
    expect(result.startsWith("0x")).toBe(true);
    // Should end with 010203
    expect(result.endsWith("010203")).toBe(true);
  });

  it("handleToBytes32 should pass through 32-byte arrays", () => {
    const full = new Uint8Array(32).fill(0xff);
    const result = handleToBytes32(full);
    expect(result).toBe("0x" + "ff".repeat(32));
  });
});

// ═══════════════════════════════════════
// TESTS: TYPE EXPORTS (compile-time)
// ═══════════════════════════════════════

describe("Type Exports", () => {
  it("should export all expected types (compile-time check)", () => {
    // These are compile-time checks — if the types don't exist, TS will fail to compile.
    // At runtime we just verify the test file itself compiled successfully.
    const side: Side = "YES";
    const sideValue: SideValue = 0;

    const marketInfo: MarketInfo = {
      question: "test",
      deadline: 0,
      resolved: false,
      outcome: false,
      totalSharesMinted: 0n,
      activeOrderCount: 0n,
      resolutionSource: "",
      resolutionSourceType: "",
      resolutionCriteria: "",
      category: "",
      yesPrice: 5000,
      noPrice: 5000,
    };

    const order: Order = {
      id: 0,
      owner: "0x0",
      price: 5000,
      isBid: true,
      isActive: true,
      sequence: 0n,
      createdAt: 0n,
    };

    const priceLevel: PriceLevel = { bidCount: 0n, askCount: 0n };
    const bestPrices: BestPrices = { bestBid: 5000, bestAsk: 6000 };
    const shareBalances: ShareBalances = { yes: 0n, no: 0n };

    const groupInfo: GroupInfo = {
      question: "test",
      outcomeCount: 3,
      resolved: false,
      winningIndex: 0,
      category: "politics",
    };

    const groupOutcome: GroupOutcome = { label: "Option A", market: "0x0" };

    const createParams: CreateMarketParams = {
      question: "test",
      deadline: 0,
      resolutionSource: "api",
      resolutionSourceType: "api",
      resolutionCriteria: "check",
      category: "tech",
    };

    const config: OpaqueClientConfig = {
      provider: createMockProvider(),
    };

    // Verify variables are used (avoid TS unused errors)
    expect(side).toBe("YES");
    expect(sideValue).toBe(0);
    expect(marketInfo.question).toBe("test");
    expect(order.id).toBe(0);
    expect(priceLevel.bidCount).toBe(0n);
    expect(bestPrices.bestBid).toBe(5000);
    expect(shareBalances.yes).toBe(0n);
    expect(groupInfo.outcomeCount).toBe(3);
    expect(groupOutcome.label).toBe("Option A");
    expect(createParams.question).toBe("test");
    expect(config.provider).toBeDefined();
  });

  it("should export event types (compile-time check)", () => {
    const mintEvent: SharesMintedEvent = { user: "0x0", timestamp: 0n };
    const orderEvent: OrderPlacedEvent = {
      orderId: 0n,
      owner: "0x0",
      price: 5000,
      isBid: true,
      sequence: 0n,
      timestamp: 0n,
    };
    const cancelEvent: OrderCancelledEvent = { orderId: 0n, owner: "0x0", timestamp: 0n };
    const matchEvent: MatchAttemptedEvent = {
      bidId: 0n,
      askId: 1n,
      caller: "0x0",
      timestamp: 0n,
    };
    const resolveEvent: MarketResolvedEvent = { outcome: true, timestamp: 0n };
    const createEvent: MarketCreatedEvent = {
      market: "0x0",
      creator: "0x0",
      question: "test",
      deadline: 0n,
      resolutionSource: "",
      resolutionSourceType: "",
      category: "",
      marketIndex: 0n,
    };

    expect(mintEvent.user).toBe("0x0");
    expect(orderEvent.orderId).toBe(0n);
    expect(cancelEvent.orderId).toBe(0n);
    expect(matchEvent.bidId).toBe(0n);
    expect(resolveEvent.outcome).toBe(true);
    expect(createEvent.market).toBe("0x0");
  });

  it("should export MarketGroupData type", () => {
    const groupData: MarketGroupData = {
      address: "0x0",
      question: "Who wins the election?",
      category: "politics",
      outcomeCount: 3,
      resolved: false,
      winningIndex: 0,
      outcomes: [
        {
          label: "Candidate A",
          market: "0x1",
          yesPrice: 3000,
          noPrice: 7000,
          resolved: false,
          outcome: false,
        },
      ],
    };

    expect(groupData.outcomes).toHaveLength(1);
    expect(groupData.outcomes[0].label).toBe("Candidate A");
  });
});

// ═══════════════════════════════════════
// TESTS: ERROR HANDLING
// ═══════════════════════════════════════

describe("Error Handling", () => {
  it("market write methods should throw without signer", async () => {
    const provider = createMockProvider();
    const market = new OpaqueMarketClient(SEPOLIA_ADDRESSES.ConfidentialUSDT, provider);
    const fhe = createMockFheInstance();

    await expect(
      market.mintShares(fhe, "0xuser", 1_000_000n),
    ).rejects.toThrow("Signer required");

    await expect(market.cancelOrder(1)).rejects.toThrow("Signer required");
    await expect(market.cancelOrders([1, 2])).rejects.toThrow("Signer required");
    await expect(market.attemptMatch(0, 1)).rejects.toThrow("Signer required");
    await expect(market.requestRedemption()).rejects.toThrow("Signer required");
    await expect(market.emergencyWithdraw()).rejects.toThrow("Signer required");
  });

  it("token write methods should throw without signer", async () => {
    const provider = createMockProvider();
    const token = new ConfidentialTokenClient(provider);

    await expect(token.mint("0xuser", 1_000_000n)).rejects.toThrow("Signer required");
    await expect(token.approvePlaintext("0xspender", 1_000_000n)).rejects.toThrow(
      "Signer required",
    );
  });

  it("factory createMarket should throw without signer", async () => {
    const provider = createMockProvider();
    const factory = new MarketFactoryClient(provider);

    await expect(
      factory.createMarket({
        question: "test",
        deadline: Math.floor(Date.now() / 1000) + 86400,
        resolutionSource: "api",
        resolutionSourceType: "api",
        resolutionCriteria: "check",
        category: "tech",
      }),
    ).rejects.toThrow("Signer required");
  });

  it("placeOrder should reject invalid price", async () => {
    const signer = createMockSigner();
    const market = new OpaqueMarketClient(SEPOLIA_ADDRESSES.ConfidentialUSDT, signer);
    const fhe = createMockFheInstance();

    await expect(
      market.placeOrder(fhe, "0xuser", "YES", 50, true, 1_000_000n),
    ).rejects.toThrow("Invalid price: 50");

    await expect(
      market.placeOrder(fhe, "0xuser", "NO", 10000, false, 1_000_000n),
    ).rejects.toThrow("Invalid price: 10000");
  });
});
