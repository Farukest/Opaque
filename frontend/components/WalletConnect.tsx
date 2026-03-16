"use client";

import { useState, useEffect } from "react";
import { useAccount, useConnect, useDisconnect, useBalance, useWriteContract, usePublicClient, useSwitchChain, useReadContract, useWalletClient } from "wagmi";
import { formatUnits } from "viem";
import { sepolia } from "wagmi/chains";
import { CONTRACTS } from "../lib/constants";
import { CUSDT_ABI } from "../lib/contracts";
import { useToast } from "./Toast";
import { getFHEInstance } from "../lib/fhe";
import { DEPLOYED } from "../lib/wagmi";

const EXPECTED_CHAIN_ID = sepolia.id;

export default function WalletConnect() {
  const { address, isConnected, chain } = useAccount();
  const { connect, connectors, isPending } = useConnect();
  const { disconnect } = useDisconnect();
  const { data: ethBalance } = useBalance({ address });
  const { writeContractAsync } = useWriteContract();
  const publicClient = usePublicClient();
  const { addToast } = useToast();
  const { switchChain } = useSwitchChain();
  const { data: walletClient } = useWalletClient();
  const [isMinting, setIsMinting] = useState(false);
  const [decryptedBalance, setDecryptedBalance] = useState<number | null>(null);
  const [isDecrypting, setIsDecrypting] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Read encrypted balanceOf handle
  const { data: balanceHandle } = useReadContract({
    address: DEPLOYED.ConfidentialUSDT,
    abi: CUSDT_ABI,
    functionName: "balanceOf",
    args: [address!],
    query: { enabled: !!address },
  });

  async function handleDecryptBalance() {
    if (!address) { addToast("Wallet not connected", "error"); return; }
    if (!walletClient) { addToast("Wallet client not ready — try again", "error"); return; }
    if (!balanceHandle || (balanceHandle as bigint) === 0n) {
      setDecryptedBalance(0);
      return;
    }
    setIsDecrypting(true);
    try {
      const fhe = await getFHEInstance();
      if (!fhe) throw new Error("FHE initialization failed");
      const { publicKey, privateKey } = fhe.generateKeypair();
      const startTimestamp = Math.floor(Date.now() / 1000);
      const durationDays = 1;
      const eip712 = fhe.createEIP712(publicKey, [DEPLOYED.ConfidentialUSDT], startTimestamp, durationDays);
      const { domain, types, primaryType, message } = eip712;
      const signature = await walletClient.signTypedData({ domain, types, primaryType, message });
      const handleHex = `0x${(balanceHandle as bigint).toString(16).padStart(64, "0")}`;
      const result = await fhe.userDecrypt(
        [{ handle: handleHex, contractAddress: DEPLOYED.ConfidentialUSDT }],
        privateKey,
        publicKey,
        signature,
        [DEPLOYED.ConfidentialUSDT],
        address,
        startTimestamp,
        durationDays,
      );
      const clearValue = result[handleHex] ?? result;
      setDecryptedBalance(Number(clearValue));
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("User rejected") || msg.includes("denied")) {
        addToast("Signature rejected", "error");
      } else {
        addToast("Failed to decrypt balance", "error");
      }
    }
    setIsDecrypting(false);
  }

  const isWrongNetwork = isConnected && chain?.id !== EXPECTED_CHAIN_ID;

  async function handleMint() {
    if (!address || !publicClient) return;
    setIsMinting(true);
    try {
      const hash = await writeContractAsync({
        address: CONTRACTS.CUSDT,
        abi: CUSDT_ABI,
        functionName: "mint",
        args: [address, BigInt(1000_000_000)], // 1000 cUSDT
      });
      await publicClient.waitForTransactionReceipt({ hash });
      addToast("Minted 1000 cUSDT!", "success");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("OwnableUnauthorizedAccount") || msg.includes("caller is not the owner") || msg.includes("reverted")) {
        addToast("Only token owner can mint", "error");
      } else {
        addToast("Mint failed", "error");
      }
    }
    setIsMinting(false);
  }

  if (!mounted) {
    return (
      <button className="bg-blue-600 text-white px-4 py-2.5 rounded-lg text-sm font-medium opacity-50" disabled>
        Connect Wallet
      </button>
    );
  }

  if (isConnected && address) {
    return (
      <div className="relative flex items-center gap-2">
        {/* Wrong Network Warning */}
        {isWrongNetwork && (
          <button
            onClick={() => switchChain({ chainId: EXPECTED_CHAIN_ID })}
            className="text-xs bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-400 border border-red-200 px-3 py-1.5 rounded-lg font-medium hover:bg-red-100 dark:hover:bg-red-900/50 transition-colors"
          >
            Switch to Sepolia
          </button>
        )}

        {/* Network Badge */}
        {!isWrongNetwork && (
          <span className="text-xs bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 px-2.5 py-1 rounded-full font-medium">
            {chain?.name || "Unknown"}
          </span>
        )}

        {/* Wallet Button (click to toggle dropdown) */}
        <button
          onClick={() => setShowDropdown(!showDropdown)}
          className="flex items-center gap-2 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2 hover:border-gray-300 dark:hover:border-gray-600 transition-colors shadow-sm"
        >
          <div className={`h-2 w-2 rounded-full ${isWrongNetwork ? "bg-red-500" : "bg-green-500"}`} />
          <span className="text-sm text-gray-900 dark:text-gray-100 font-medium font-mono">
            {address.slice(0, 6)}...{address.slice(-4)}
          </span>
          <svg className={`w-3.5 h-3.5 text-gray-400 dark:text-gray-500 transition-transform ${showDropdown ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </button>

        {/* Dropdown */}
        {showDropdown && (
          <>
            {/* Backdrop to close dropdown */}
            <div className="fixed inset-0 z-40" onClick={() => setShowDropdown(false)} />
            <div className="absolute right-0 top-full mt-2 z-50 w-64 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl shadow-lg dark:shadow-gray-900/50 p-4 space-y-3">
              {/* ETH Balance */}
              {ethBalance && (
                <div className="flex items-center justify-between text-sm">
                  <span className="text-gray-500 dark:text-gray-400">ETH Balance</span>
                  <span className="text-gray-900 dark:text-gray-100 font-medium font-mono">
                    {parseFloat(formatUnits(ethBalance.value, ethBalance.decimals)).toFixed(4)}
                  </span>
                </div>
              )}

              {/* cUSDT Balance */}
              <div className="flex items-center justify-between text-sm">
                <span className="text-gray-500 dark:text-gray-400">cUSDT Balance</span>
                {decryptedBalance !== null ? (
                  <span className="text-green-600 font-medium font-mono">
                    {(decryptedBalance / 1_000_000).toFixed(2)}
                  </span>
                ) : !balanceHandle || (balanceHandle as bigint) === 0n ? (
                  <span className="text-gray-400 dark:text-gray-500 font-mono">0.00</span>
                ) : (
                  <button
                    onClick={handleDecryptBalance}
                    disabled={isDecrypting || isWrongNetwork}
                    className="text-xs bg-blue-50 dark:bg-blue-900/30 text-blue-600 px-2.5 py-1 rounded-lg font-medium hover:bg-blue-100 dark:hover:bg-blue-900/50 transition-colors disabled:opacity-50"
                  >
                    {isDecrypting ? "Decrypting..." : "Decrypt"}
                  </button>
                )}
              </div>

              <div className="border-t border-gray-100 dark:border-gray-800" />

              {/* Mint cUSDT */}
              <button
                onClick={handleMint}
                disabled={isMinting || isWrongNetwork}
                className="w-full flex items-center justify-center gap-1.5 text-sm text-gray-700 dark:text-gray-300 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors disabled:opacity-50 font-medium"
              >
                {isMinting ? (
                  <>
                    <svg className="animate-spin h-3.5 w-3.5" viewBox="0 0 24 24" fill="none">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    Minting...
                  </>
                ) : (
                  "Mint 1000 cUSDT"
                )}
              </button>

              {/* Disconnect */}
              <button
                onClick={() => { disconnect(); setShowDropdown(false); }}
                className="w-full text-sm text-red-600 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-900/30 rounded-lg px-3 py-2 transition-colors font-medium"
              >
                Disconnect
              </button>
            </div>
          </>
        )}
      </div>
    );
  }

  return (
    <button
      onClick={() => {
        const connector = connectors[0];
        if (connector) connect({ connector });
      }}
      disabled={isPending}
      className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2.5 rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
    >
      {isPending ? "Connecting..." : "Connect Wallet"}
    </button>
  );
}
