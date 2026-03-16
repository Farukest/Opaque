"use client";

import { useState, useCallback, useEffect } from "react";
import Link from "next/link";
import { useAccount, useReadContract, useReadContracts, usePublicClient, useWalletClient, useWriteContract } from "wagmi";
import { useMarkets } from "../../hooks/useMarkets";
import { OPAQUE_MARKET_ABI, CUSDT_ABI } from "../../lib/contracts";
import { CONTRACTS, priceToPercent } from "../../lib/constants";
import { getFHEInstance } from "../../lib/fhe";
import type { Market } from "../../lib/constants";
import { PortfolioSkeleton } from "../../components/Skeletons";

interface DecryptedShares {
  yes: bigint;
  no: bigint;
}

function formatCUSDT(raw: bigint): string {
  const w = raw / 1_000_000n;
  const f = (raw % 1_000_000n) * 100n / 1_000_000n;
  return `${w}.${f.toString().padStart(2, "0")}`;
}

function DecryptSharesButton({
  marketAddress,
  userAddress,
}: {
  marketAddress: string;
  userAddress: string;
}) {
  const [decrypted, setDecrypted] = useState<DecryptedShares | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const publicClient = usePublicClient();
  const { data: walletClient } = useWalletClient();

  const handleDecrypt = useCallback(async () => {
    if (!publicClient || !walletClient) return;
    setLoading(true);
    setError("");

    try {
      const [yesHandle, noHandle] = await publicClient.readContract({
        address: marketAddress as `0x${string}`,
        abi: OPAQUE_MARKET_ABI,
        functionName: "getMyShares",
        account: userAddress as `0x${string}`,
      }) as [bigint, bigint];

      if (yesHandle === 0n && noHandle === 0n) {
        setDecrypted({ yes: 0n, no: 0n });
        return;
      }

      const yesHex = `0x${yesHandle.toString(16).padStart(64, "0")}` as `0x${string}`;
      const noHex = `0x${noHandle.toString(16).padStart(64, "0")}` as `0x${string}`;

      const fhe = await getFHEInstance();
      if (!fhe) throw new Error("FHE initialization failed");
      const keypair = fhe.generateKeypair();
      const startTimestamp = Math.floor(Date.now() / 1000);
      const durationDays = 1;
      const eip712 = fhe.createEIP712(keypair.publicKey, [marketAddress], startTimestamp, durationDays);
      const { domain, types, primaryType, message } = eip712;
      const signature = await walletClient.signTypedData({ domain, types, primaryType, message });

      const clearValues = await fhe.userDecrypt(
        [
          { handle: yesHex, contractAddress: marketAddress },
          { handle: noHex, contractAddress: marketAddress },
        ],
        keypair.privateKey,
        keypair.publicKey,
        signature,
        [marketAddress],
        userAddress,
        startTimestamp,
        durationDays,
      );

      const yes = typeof clearValues[yesHex] === "bigint"
        ? clearValues[yesHex] as bigint
        : BigInt(clearValues[yesHex] as string || "0");
      const no = typeof clearValues[noHex] === "bigint"
        ? clearValues[noHex] as bigint
        : BigInt(clearValues[noHex] as string || "0");

      setDecrypted({ yes, no });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Decryption failed";
      if (msg.includes("User rejected") || msg.includes("denied")) {
        setError("Signature rejected");
      } else {
        setError(msg.length > 80 ? msg.slice(0, 80) + "..." : msg);
      }
    } finally {
      setLoading(false);
    }
  }, [marketAddress, userAddress, publicClient, walletClient]);

  if (decrypted) {
    return (
      <div className="text-right space-y-1">
        {decrypted.yes > 0n && (
          <div className="inline-flex items-center gap-1.5 bg-green-50 dark:bg-green-900/30 text-green-700 text-sm font-medium px-2.5 py-1 rounded-lg">
            {formatCUSDT(decrypted.yes)} YES
          </div>
        )}
        {decrypted.no > 0n && (
          <div className="inline-flex items-center gap-1.5 bg-red-50 dark:bg-red-900/30 text-red-700 text-sm font-medium px-2.5 py-1 rounded-lg">
            {formatCUSDT(decrypted.no)} NO
          </div>
        )}
        {decrypted.yes === 0n && decrypted.no === 0n && (
          <div className="text-xs text-gray-400 dark:text-gray-500">No shares</div>
        )}
      </div>
    );
  }

  return (
    <div className="text-right">
      {error && <div className="text-xs text-red-600 mb-1">{error}</div>}
      <button
        onClick={handleDecrypt}
        disabled={loading}
        className="text-xs bg-blue-600 hover:bg-blue-700 text-white px-3 py-1.5 rounded-lg font-medium transition-colors disabled:opacity-50"
      >
        {loading ? "Decrypting..." : "Decrypt Shares"}
      </button>
    </div>
  );
}

const FAUCET_AMOUNT = 1000_000_000n; // 1000 cUSDT
const DEPLOYER_ADDRESS = "0xF505e2E71df58D7244189072008f25f6b6aaE5ae";

export default function PortfolioPage() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const { address: userAddress, isConnected } = useAccount();
  const { markets, isLoading: loadingMarkets } = useMarkets();
  const { writeContractAsync } = useWriteContract();
  const publicClient = usePublicClient();
  const { data: walletClient } = useWalletClient();
  const [faucetLoading, setFaucetLoading] = useState(false);
  const [faucetMsg, setFaucetMsg] = useState("");
  const [mintTo, setMintTo] = useState("");

  const isDeployer = userAddress?.toLowerCase() === DEPLOYER_ADDRESS.toLowerCase();
  const [decryptedBalance, setDecryptedBalance] = useState<bigint | null>(null);
  const [balanceDecrypting, setBalanceDecrypting] = useState(false);
  const [balanceError, setBalanceError] = useState("");

  // Read cUSDT balance handle (encrypted)
  const { data: cUSDTHandle } = useReadContract({
    address: CONTRACTS.CUSDT,
    abi: CUSDT_ABI,
    functionName: "balanceOf",
    args: userAddress ? [userAddress] : undefined,
    query: { enabled: !!userAddress, refetchInterval: 10_000 },
  });

  const hasBalance = cUSDTHandle ? (cUSDTHandle as bigint) > 0n : false;

  const handleDecryptBalance = useCallback(async () => {
    if (!userAddress) { setBalanceError("Wallet not connected"); return; }
    if (!publicClient || !walletClient) { setBalanceError("Wallet client not ready — try again in a moment"); return; }
    const handle = cUSDTHandle as bigint | undefined;
    if (!handle || handle === 0n) { setDecryptedBalance(0n); return; }
    setBalanceDecrypting(true);
    setBalanceError("");
    try {
      console.log("[DecryptBalance] Handle raw:", handle.toString());
      const handleHex = `0x${handle.toString(16).padStart(64, "0")}` as `0x${string}`;
      console.log("[DecryptBalance] Handle hex:", handleHex);
      const contractAddr = CONTRACTS.CUSDT;
      console.log("[DecryptBalance] Contract:", contractAddr);

      const fhe = await getFHEInstance();
      if (!fhe) throw new Error("FHE init failed");
      console.log("[DecryptBalance] FHE instance ready");

      const keypair = fhe.generateKeypair();
      const startTimestamp = Math.floor(Date.now() / 1000);
      const durationDays = 1;
      const eip712 = fhe.createEIP712(keypair.publicKey, [contractAddr], startTimestamp, durationDays);
      console.log("[DecryptBalance] EIP712 created, requesting signature...");

      const { domain, types, primaryType, message } = eip712;
      const signature = await walletClient.signTypedData({ domain, types, primaryType, message });
      console.log("[DecryptBalance] Signature obtained, decrypting...");

      const clearValues = await fhe.userDecrypt(
        [{ handle: handleHex, contractAddress: contractAddr }],
        keypair.privateKey,
        keypair.publicKey,
        signature,
        [contractAddr],
        userAddress,
        startTimestamp,
        durationDays,
      );
      console.log("[DecryptBalance] Clear values:", clearValues);

      const val = typeof clearValues[handleHex] === "bigint"
        ? clearValues[handleHex] as bigint
        : BigInt(clearValues[handleHex] as string || "0");
      setDecryptedBalance(val);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[DecryptBalance] Error:", err);
      setBalanceError(msg.length > 80 ? msg.slice(0, 80) + "..." : msg);
    } finally {
      setBalanceDecrypting(false);
    }
  }, [cUSDTHandle, publicClient, walletClient, userAddress]);

  // Batch check hasUserShares for all markets
  const contracts = markets.map((m) => ({
    address: m.address as `0x${string}`,
    abi: OPAQUE_MARKET_ABI,
    functionName: "hasUserShares" as const,
    args: [userAddress as `0x${string}`],
  }));

  const { data: shareChecks, isLoading: loadingShares } = useReadContracts({
    contracts,
    query: { enabled: isConnected && !!userAddress && markets.length > 0 },
  });

  const myMarkets: { market: Market; hasShares: boolean }[] = [];
  if (shareChecks) {
    for (let i = 0; i < markets.length; i++) {
      const check = shareChecks[i];
      if (check && check.status === "success" && check.result === true) {
        myMarkets.push({ market: markets[i], hasShares: true });
      }
    }
  }

  const activePositions = myMarkets.filter((b) => !b.market.resolved).reverse();
  const resolvedPositions = myMarkets.filter((b) => b.market.resolved).reverse();
  const isLoading = loadingMarkets || loadingShares;

  async function handleFaucet() {
    if (!publicClient || !userAddress) return;
    const recipient = (isDeployer && mintTo.trim()) ? mintTo.trim() as `0x${string}` : userAddress;
    setFaucetLoading(true);
    setFaucetMsg("");
    try {
      const hash = await writeContractAsync({
        address: CONTRACTS.CUSDT,
        abi: CUSDT_ABI,
        functionName: "mint",
        args: [recipient, FAUCET_AMOUNT],
      });
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status === "reverted") {
        setFaucetMsg("Transaction reverted");
      } else {
        const short = recipient === userAddress ? "" : ` to ${recipient.slice(0, 6)}...${recipient.slice(-4)}`;
        setFaucetMsg(`1,000 cUSDT sent${short}!`);
        setTimeout(() => setFaucetMsg(""), 4000);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Faucet failed";
      if (msg.includes("User rejected") || msg.includes("denied")) {
        setFaucetMsg("Transaction rejected");
      } else if (msg.includes("OwnableUnauthorizedAccount") || msg.includes("OnlyOwner") || msg.includes("caller is not the owner") || msg.includes("revert")) {
        setFaucetMsg("Only the deployer wallet can mint cUSDT. Import deployer key into MetaMask.");
      } else {
        setFaucetMsg(msg.length > 80 ? msg.slice(0, 80) + "..." : msg);
      }
    }
    setFaucetLoading(false);
  }

  if (!mounted) {
    return <PortfolioSkeleton />;
  }

  if (!isConnected) {
    return (
      <div className="text-center py-20">
        <div className="w-16 h-16 mx-auto mb-4 bg-gray-100 dark:bg-gray-800 rounded-full flex items-center justify-center">
          <svg className="w-8 h-8 text-gray-400 dark:text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
          </svg>
        </div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-2">Connect Your Wallet</h1>
        <p className="text-gray-500 dark:text-gray-400">Connect your wallet to view your portfolio.</p>
      </div>
    );
  }

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-1">Portfolio</h1>
      <p className="text-sm text-gray-500 dark:text-gray-400 mb-8">
        Your funds and positions. cUSDT is used to trade on all markets.
      </p>

      {/* Balance + Faucet + Summary */}
      <div className="grid lg:grid-cols-4 gap-4 mb-8">
        {/* cUSDT Balance - large card */}
        <div className="lg:col-span-2 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl shadow-sm p-6">
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs font-medium uppercase tracking-wider text-gray-400 dark:text-gray-500">cUSDT Balance</span>
            <span className="text-[10px] bg-green-50 dark:bg-green-900/30 text-green-600 px-1.5 py-0.5 rounded font-medium">Sepolia Testnet</span>
          </div>
          <div className="flex items-center gap-3 mb-3">
            {decryptedBalance !== null ? (
              <>
                <span className="text-3xl font-bold text-gray-900 dark:text-gray-100">{formatCUSDT(decryptedBalance)}</span>
                <span className="text-lg text-gray-400 dark:text-gray-500 font-normal">cUSDT</span>
              </>
            ) : hasBalance ? (
              <>
                <svg className="w-5 h-5 text-gray-400 dark:text-gray-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
                </svg>
                <span className="text-2xl font-bold text-gray-500 dark:text-gray-400">Encrypted</span>
                <button
                  onClick={handleDecryptBalance}
                  disabled={balanceDecrypting}
                  className="text-sm bg-blue-600 hover:bg-blue-700 text-white px-3 py-1.5 rounded-lg font-medium transition-colors disabled:opacity-50"
                >
                  {balanceDecrypting ? "Decrypting..." : "Reveal"}
                </button>
              </>
            ) : (
              <>
                <span className="text-3xl font-bold text-gray-900 dark:text-gray-100">0.00</span>
                <span className="text-lg text-gray-400 dark:text-gray-500 font-normal">cUSDT</span>
              </>
            )}
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            {isDeployer && (
              <input
                type="text"
                value={mintTo}
                onChange={(e) => setMintTo(e.target.value)}
                placeholder="0x... recipient address"
                className="text-sm border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 rounded-lg px-3 py-2 w-56 placeholder-gray-400 dark:placeholder-gray-600"
              />
            )}
            <button
              onClick={handleFaucet}
              disabled={faucetLoading}
              className="text-sm bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg font-medium transition-colors disabled:opacity-50"
            >
              {faucetLoading ? "Minting..." : isDeployer && mintTo.trim() ? `Mint to ${mintTo.slice(0, 6)}...` : "Get Test cUSDT"}
            </button>
            {faucetMsg && (
              <span className={`text-sm font-medium ${faucetMsg.includes("sent") || faucetMsg.includes("received") ? "text-green-600" : "text-red-500"}`}>
                {faucetMsg}
              </span>
            )}
          </div>
          {balanceError && (
            <p className="text-xs text-red-500 mt-2">{balanceError}</p>
          )}
          <p className="text-xs text-gray-400 dark:text-gray-500 mt-3">
            cUSDT is your trading currency. Go to any market and place orders directly — no deposit needed.
          </p>
        </div>

        {/* Summary Cards */}
        <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl shadow-sm p-4">
          <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">Active Positions</div>
          <div className="text-2xl font-bold text-gray-900 dark:text-gray-100">{activePositions.length}</div>
        </div>
        <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl shadow-sm p-4">
          <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">Resolved</div>
          <div className="text-2xl font-bold text-gray-900 dark:text-gray-100">{resolvedPositions.length}</div>
        </div>
      </div>

      {/* How It Works */}
      <div className="bg-blue-50 dark:bg-blue-900/30 border border-blue-100 dark:border-blue-800 rounded-xl p-4 mb-8">
        <div className="flex items-start gap-3">
          <svg className="w-5 h-5 text-blue-500 mt-0.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <div className="text-sm text-blue-800 dark:text-blue-200">
            <span className="font-semibold">How it works:</span> Get cUSDT from the faucet, then go to any market and trade.
            Your cUSDT is used as collateral when you place orders. When your orders are matched, you receive outcome shares.
            After resolution, redeem winning shares for cUSDT. No deposits or withdrawals needed — fully non-custodial.
          </div>
        </div>
      </div>

      {isLoading && (
        <div className="animate-pulse">
          <div className="h-5 w-32 bg-gray-200 dark:bg-gray-700/60 rounded mb-4" />
          <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl shadow-sm divide-y divide-gray-100 dark:divide-gray-800">
            {[1, 2, 3].map((i) => (
              <div key={i} className="px-5 py-4">
                <div className="flex items-center justify-between">
                  <div className="flex-1 mr-4">
                    <div className="h-4 w-3/4 bg-gray-200 dark:bg-gray-700/60 rounded mb-2" />
                    <div className="flex items-center gap-3">
                      <div className="h-3 w-16 bg-gray-200 dark:bg-gray-700/60 rounded" />
                      <div className="h-3 w-14 bg-gray-200 dark:bg-gray-700/60 rounded" />
                    </div>
                  </div>
                  <div className="h-8 w-24 bg-gray-200 dark:bg-gray-700/60 rounded-lg" />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Active Positions */}
      {!isLoading && (
        <div className="mb-8">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">Active Positions</h2>
          {activePositions.length > 0 ? (
            <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl shadow-sm divide-y divide-gray-100 dark:divide-gray-800">
              {activePositions.map((b) => (
                <div key={b.market.address} className="px-5 py-4">
                  <div className="flex items-center justify-between">
                    <div className="min-w-0 flex-1 mr-4">
                      <Link href={`/market/${b.market.id}`} className="text-gray-900 dark:text-gray-100 font-medium hover:text-blue-600 transition-colors">
                        {b.market.question}
                      </Link>
                      <div className="flex items-center gap-3 mt-1 text-sm">
                        <span className="text-green-600 font-medium">{priceToPercent(b.market.yesPrice).toFixed(1)}% YES</span>
                        <span className="text-gray-400 dark:text-gray-500">{b.market.activeOrderCount} orders</span>
                      </div>
                    </div>
                    {userAddress && (
                      <DecryptSharesButton marketAddress={b.market.address} userAddress={userAddress} />
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-8 text-gray-400 dark:text-gray-500 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl">
              <p>No active positions yet.</p>
              <Link href="/" className="text-blue-600 hover:text-blue-700 text-sm font-medium mt-1 inline-block">
                Browse markets
              </Link>
            </div>
          )}
        </div>
      )}

      {/* Resolved */}
      {!isLoading && resolvedPositions.length > 0 && (
        <div>
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">Resolved</h2>
          <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl shadow-sm divide-y divide-gray-100 dark:divide-gray-800">
            {resolvedPositions.map((b) => (
              <div key={b.market.address} className="px-5 py-4">
                <div className="flex items-center justify-between">
                  <div className="min-w-0 flex-1 mr-4">
                    <Link href={`/market/${b.market.id}`} className="text-gray-900 dark:text-gray-100 font-medium hover:text-blue-600 transition-colors">
                      {b.market.question}
                    </Link>
                    <div className="flex items-center gap-3 mt-1 text-sm">
                      <span className={b.market.outcome ? "text-green-600 font-medium" : "text-red-600 font-medium"}>
                        Outcome: {b.market.outcome ? "YES" : "NO"}
                      </span>
                    </div>
                  </div>
                  {userAddress && (
                    <DecryptSharesButton marketAddress={b.market.address} userAddress={userAddress} />
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Empty State */}
      {!isLoading && myMarkets.length === 0 && (
        <div className="text-center py-12 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl">
          <div className="w-12 h-12 mx-auto mb-3 bg-gray-100 dark:bg-gray-800 rounded-full flex items-center justify-center">
            <svg className="w-6 h-6 text-gray-400 dark:text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 18.75a60.07 60.07 0 0115.797 2.101c.727.198 1.453-.342 1.453-1.096V18.75M3.75 4.5v.75A.75.75 0 013 6h-.75m0 0v-.375c0-.621.504-1.125 1.125-1.125H20.25M2.25 6v9m18-10.5v.75c0 .414.336.75.75.75h.75m-1.5-1.5h.375c.621 0 1.125.504 1.125 1.125v9.75c0 .621-.504 1.125-1.125 1.125h-.375m1.5-1.5H21a.75.75 0 00-.75.75v.75m0 0H3.75m0 0h-.375a1.125 1.125 0 01-1.125-1.125V15m1.5 1.5v-.75A.75.75 0 003 15h-.75M15 10.5a3 3 0 11-6 0 3 3 0 016 0zm3 0h.008v.008H18V10.5zm-12 0h.008v.008H6V10.5z" />
            </svg>
          </div>
          <p className="text-gray-500 dark:text-gray-400">No positions yet.</p>
          <p className="text-sm text-gray-400 dark:text-gray-500 mt-1">Get cUSDT from the faucet above, then trade on any market.</p>
          <Link href="/" className="text-blue-600 hover:text-blue-700 text-sm font-medium mt-2 inline-block">
            Browse markets
          </Link>
        </div>
      )}
    </div>
  );
}
