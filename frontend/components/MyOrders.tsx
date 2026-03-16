"use client";

import { useState, useCallback } from "react";
import { useAccount, useWriteContract, usePublicClient, useWalletClient } from "wagmi";
import { OPAQUE_MARKET_ABI } from "../lib/contracts";
import { useMyOrders } from "../hooks/useMyOrders";
import { formatPrice } from "../lib/constants";
import { getFHEInstance } from "../lib/fhe";

interface MyOrdersProps {
  marketAddress: string;
  resolved: boolean;
  onSuccess?: () => void;
}

interface DecryptedFill {
  size: bigint;
  filled: bigint;
}

function formatAmount(raw: bigint): string {
  const w = raw / 1_000_000n;
  const f = (raw % 1_000_000n) * 100n / 1_000_000n;
  return `${w}.${f.toString().padStart(2, "0")}`;
}

export default function MyOrders({ marketAddress, resolved, onSuccess }: MyOrdersProps) {
  const { address: userAddress } = useAccount();
  const { orders, activeOrders, isLoading, refetch } = useMyOrders(marketAddress, userAddress);
  const { writeContractAsync } = useWriteContract();
  const publicClient = usePublicClient();
  const { data: walletClient } = useWalletClient();
  const [cancellingId, setCancellingId] = useState<number | null>(null);
  const [cancelAllLoading, setCancelAllLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showClosed, setShowClosed] = useState(false);

  // FHE decrypt state for fill status
  const [fillData, setFillData] = useState<Record<number, DecryptedFill>>({});
  const [decryptingFills, setDecryptingFills] = useState(false);
  const [fillError, setFillError] = useState("");

  async function handleCancel(orderId: number) {
    if (!publicClient) return;
    setCancellingId(orderId);
    setError(null);
    try {
      console.log(`[Cancel] Cancelling order #${orderId} on market ${marketAddress}`);
      const hash = await writeContractAsync({
        address: marketAddress as `0x${string}`,
        abi: OPAQUE_MARKET_ABI,
        functionName: "cancelOrder",
        args: [BigInt(orderId)],
      });
      console.log(`[Cancel] TX sent: ${hash}`);
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      console.log(`[Cancel] TX status: ${receipt.status}`, receipt);
      if (receipt.status === "reverted") {
        setError("Cancel reverted on-chain — order may already be matched or cancelled");
      } else {
        setError(null);
      }
      // Always refetch to update UI
      refetch();
      onSuccess?.();
    } catch (err: unknown) {
      console.error("[Cancel] Error:", err);
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("User rejected") || msg.includes("denied")) {
        // User cancelled in wallet — no error needed
      } else if (msg.includes("not active") || msg.includes("not owner") || msg.includes("reverted") || msg.includes("execution reverted")) {
        setError("Cannot cancel — order may already be matched or cancelled");
      } else {
        setError(msg.length > 100 ? msg.slice(0, 100) + "..." : msg);
      }
      // Refetch anyway so UI matches on-chain state
      refetch();
    }
    setCancellingId(null);
  }

  async function handleCancelAll() {
    if (!publicClient) return;
    setCancelAllLoading(true);
    setError(null);

    const allIds = activeOrders.map((o) => BigInt(o.id));
    const BATCH_SIZE = 15;
    let cancelled = 0;
    let failed = 0;

    console.log(`[CancelAll] Cancelling ${allIds.length} orders in batches of ${BATCH_SIZE}`);

    for (let i = 0; i < allIds.length; i += BATCH_SIZE) {
      const batch = allIds.slice(i, i + BATCH_SIZE);
      setError(`Cancelling ${i + 1}-${Math.min(i + BATCH_SIZE, allIds.length)} of ${allIds.length}...`);
      try {
        const hash = await writeContractAsync({
          address: marketAddress as `0x${string}`,
          abi: OPAQUE_MARKET_ABI,
          functionName: "cancelOrders",
          args: [batch],
        });
        console.log(`[CancelAll] Batch ${i / BATCH_SIZE + 1} TX: ${hash}`);
        const receipt = await publicClient.waitForTransactionReceipt({ hash });
        if (receipt.status === "reverted") {
          console.warn(`[CancelAll] Batch reverted`);
          failed += batch.length;
        } else {
          cancelled += batch.length;
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[CancelAll] Batch error:`, msg);
        if (msg.includes("User rejected") || msg.includes("denied")) {
          setError(`Cancelled ${cancelled} orders. Stopped by user.`);
          break;
        }
        failed += batch.length;
      }
    }

    if (failed > 0 && cancelled > 0) {
      setError(`${cancelled} cancelled, ${failed} failed (may already be matched)`);
    } else if (failed > 0) {
      setError(`Cancel failed — orders may already be matched or inactive`);
    } else if (cancelled > 0) {
      setError(null);
    }

    refetch();
    onSuccess?.();
    setCancelAllLoading(false);
  }

  const handleDecryptFills = useCallback(async () => {
    if (!publicClient || !walletClient || !userAddress || orders.length === 0) return;
    setDecryptingFills(true);
    setFillError("");

    try {
      // 1. Read encrypted handles for all orders
      const handleResults = await Promise.all(
        orders.map((o) =>
          publicClient.readContract({
            address: marketAddress as `0x${string}`,
            abi: OPAQUE_MARKET_ABI,
            functionName: "getOrderEncrypted",
            args: [BigInt(o.id)],
            account: userAddress as `0x${string}`,
          })
        )
      );

      // 2. Collect all non-zero handles (size + filled for each order)
      const handleEntries: { orderId: number; field: "size" | "filled"; handle: bigint; hex: `0x${string}` }[] = [];

      for (let i = 0; i < orders.length; i++) {
        const result = handleResults[i] as readonly [bigint, bigint, bigint, bigint];
        // result: [encSide, size, filled, escrow]
        const sizeHandle = result[1];
        const filledHandle = result[2];

        if (sizeHandle > 0n) {
          const hex = `0x${sizeHandle.toString(16).padStart(64, "0")}` as `0x${string}`;
          handleEntries.push({ orderId: orders[i].id, field: "size", handle: sizeHandle, hex });
        }
        if (filledHandle > 0n) {
          const hex = `0x${filledHandle.toString(16).padStart(64, "0")}` as `0x${string}`;
          handleEntries.push({ orderId: orders[i].id, field: "filled", handle: filledHandle, hex });
        }
      }

      // Initialize result map
      const result: Record<number, DecryptedFill> = {};
      for (const o of orders) {
        result[o.id] = { size: 0n, filled: 0n };
      }

      if (handleEntries.length === 0) {
        setFillData(result);
        return;
      }

      // 3. FHE setup + signature (once)
      const fhe = await getFHEInstance();
      if (!fhe) throw new Error("FHE initialization failed");

      const keypair = fhe.generateKeypair();
      const startTimestamp = Math.floor(Date.now() / 1000);
      const durationDays = 1;
      const eip712 = fhe.createEIP712(keypair.publicKey, [marketAddress], startTimestamp, durationDays);
      const { domain, types, primaryType, message } = eip712;
      const signature = await walletClient.signTypedData({ domain, types, primaryType, message });

      // 4. Chunk handles to stay under 2048-bit FHE decrypt limit
      //    euint64 = 64 bits → max 32 handles per request (2048/64)
      //    Use 30 as safe batch size
      const BATCH_SIZE = 30;
      for (let start = 0; start < handleEntries.length; start += BATCH_SIZE) {
        const chunk = handleEntries.slice(start, start + BATCH_SIZE);
        const decryptInputs = chunk.map((e) => ({
          handle: e.hex,
          contractAddress: marketAddress,
        }));

        const clearValues = await fhe.userDecrypt(
          decryptInputs,
          keypair.privateKey,
          keypair.publicKey,
          signature,
          [marketAddress],
          userAddress,
          startTimestamp,
          durationDays,
        );

        for (const entry of chunk) {
          const val = clearValues[entry.hex];
          const bigVal = typeof val === "bigint" ? val : BigInt(val as string || "0");
          if (entry.field === "size") {
            result[entry.orderId].size = bigVal;
          } else {
            result[entry.orderId].filled = bigVal;
          }
        }
      }

      setFillData(result);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("User rejected") || msg.includes("denied")) {
        setFillError("Signature rejected");
      } else {
        setFillError(msg.length > 80 ? msg.slice(0, 80) + "..." : msg);
      }
    } finally {
      setDecryptingFills(false);
    }
  }, [orders, marketAddress, publicClient, walletClient, userAddress]);

  const hasFillData = Object.keys(fillData).length > 0;

  if (!userAddress) return null;
  if (isLoading) return null;
  if (orders.length === 0) return null;

  return (
    <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h4 className="text-sm font-semibold text-gray-900 dark:text-gray-100">My Orders</h4>
          <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">
            {activeOrders.length} active / {orders.length} total
          </p>
        </div>
        <div className="flex items-center gap-2">
          {orders.length !== activeOrders.length && (
            <label className="flex items-center gap-1.5 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={showClosed}
                onChange={(e) => setShowClosed(e.target.checked)}
                className="w-3.5 h-3.5 rounded border-gray-300 dark:border-gray-600 text-blue-600 focus:ring-blue-500"
              />
              <span className="text-xs text-gray-400 dark:text-gray-500">Show closed</span>
            </label>
          )}
          {!hasFillData && (
            <button
              onClick={handleDecryptFills}
              disabled={decryptingFills}
              className="text-xs bg-blue-600 hover:bg-blue-700 text-white px-3 py-1.5 rounded-lg font-medium transition-colors disabled:opacity-50"
            >
              {decryptingFills ? "Decrypting..." : "Reveal Fills"}
            </button>
          )}
          {activeOrders.length > 1 && (
            <button
              onClick={handleCancelAll}
              disabled={cancelAllLoading}
              className="text-xs border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800 px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50"
            >
              {cancelAllLoading ? "Cancelling..." : "Cancel All"}
            </button>
          )}
        </div>
      </div>

      {fillError && <p className="text-red-600 text-xs mb-3">{fillError}</p>}

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100 dark:border-gray-800">
              <th className="text-xs font-medium uppercase tracking-wider text-gray-400 dark:text-gray-500 text-left pb-2 pr-3">ID</th>
              <th className="text-xs font-medium uppercase tracking-wider text-gray-400 dark:text-gray-500 text-left pb-2 pr-3">Side</th>
              <th className="text-xs font-medium uppercase tracking-wider text-gray-400 dark:text-gray-500 text-left pb-2 pr-3">Price</th>
              <th className="text-xs font-medium uppercase tracking-wider text-gray-400 dark:text-gray-500 text-left pb-2 pr-3">Fill Status</th>
              <th className="text-xs font-medium uppercase tracking-wider text-gray-400 dark:text-gray-500 text-left pb-2 pr-3">Status</th>
              <th className="text-xs font-medium uppercase tracking-wider text-gray-400 dark:text-gray-500 text-right pb-2">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50 dark:divide-gray-800">
            {orders.filter((o) => showClosed || o.isActive).map((order) => {
              const fill = fillData[order.id];
              const fillPercent = fill && fill.size > 0n
                ? Number((fill.filled * 100n) / fill.size)
                : 0;
              const isFilled = fill && fill.size > 0n && fill.filled >= fill.size;
              const isPartial = fill && fill.filled > 0n && fill.size > 0n && fill.filled < fill.size;

              return (
                <tr
                  key={order.id}
                  className={`hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors ${!order.isActive ? "opacity-50" : ""}`}
                >
                  <td className="py-2.5 pr-3 text-gray-500 dark:text-gray-400 font-mono text-xs">#{order.id}</td>
                  <td className="py-2.5 pr-3">
                    <span className={`text-xs font-semibold ${order.isBid ? "text-green-600" : "text-red-600"}`}>
                      {order.isBid ? "BUY" : "SELL"}
                    </span>
                  </td>
                  <td className="py-2.5 pr-3 text-gray-900 dark:text-gray-100 font-mono text-xs">{formatPrice(order.price)}</td>
                  <td className="py-2.5 pr-3">
                    {fill ? (
                      <div className="space-y-1">
                        <div className="flex items-center gap-1.5">
                          {isFilled ? (
                            <span className="inline-flex items-center gap-1 text-xs font-semibold text-green-600">
                              <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
                                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.857-9.809a.75.75 0 00-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 10-1.06 1.061l2.5 2.5a.75.75 0 001.137-.089l4-5.5z" clipRule="evenodd" />
                              </svg>
                              Filled
                            </span>
                          ) : isPartial ? (
                            <span className="text-xs font-medium text-amber-600">
                              {formatAmount(fill.filled)} / {formatAmount(fill.size)}
                            </span>
                          ) : fill.size > 0n ? (
                            <span className="text-xs text-gray-400 dark:text-gray-500">
                              0 / {formatAmount(fill.size)}
                            </span>
                          ) : (
                            <span className="text-xs text-gray-400 dark:text-gray-500">-</span>
                          )}
                        </div>
                        {fill.size > 0n && !isFilled && (
                          <div className="w-full bg-gray-100 dark:bg-gray-800 rounded-full h-1.5">
                            <div
                              className={`h-1.5 rounded-full transition-all ${isPartial ? "bg-amber-400" : "bg-gray-200 dark:bg-gray-700"}`}
                              style={{ width: `${Math.min(fillPercent, 100)}%` }}
                            />
                          </div>
                        )}
                      </div>
                    ) : (
                      <span className="text-xs text-gray-400 dark:text-gray-500 flex items-center gap-1">
                        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                        </svg>
                        Encrypted
                      </span>
                    )}
                  </td>
                  <td className="py-2.5 pr-3">
                    {order.isActive ? (
                      isFilled ? (
                        <span className="inline-flex items-center gap-1 text-xs text-green-600 font-semibold">
                          <span className="w-1.5 h-1.5 rounded-full bg-green-500"></span>
                          Matched
                        </span>
                      ) : isPartial ? (
                        <span className="inline-flex items-center gap-1 text-xs text-amber-600 font-semibold">
                          <span className="w-1.5 h-1.5 rounded-full bg-amber-400"></span>
                          Partial
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-xs text-green-600">
                          <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse"></span>
                          Open
                        </span>
                      )
                    ) : (
                      <span className="text-xs text-gray-400 dark:text-gray-500">Closed</span>
                    )}
                  </td>
                  <td className="py-2.5 text-right">
                    {order.isActive && (
                      <button
                        onClick={() => handleCancel(order.id)}
                        disabled={cancellingId === order.id}
                        className="text-xs text-red-600 hover:bg-red-50 dark:hover:bg-red-900/30 px-2 py-1 rounded transition-colors disabled:opacity-50"
                      >
                        {cancellingId === order.id ? "..." : "Cancel"}
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Empty active state */}
      {activeOrders.length === 0 && orders.length > 0 && (
        <p className="text-sm text-gray-400 dark:text-gray-500 text-center py-4">No active orders</p>
      )}

      {/* Error */}
      {error && <p className="text-red-600 text-xs mt-3">{error}</p>}

      {/* Privacy note */}
      <div className="mt-3 border-t border-gray-100 dark:border-gray-800 pt-3">
        <p className="text-xs text-gray-400 dark:text-gray-500 text-center">
          {hasFillData
            ? "Fill data decrypted. Only you can see your order sizes."
            : "Order sizes are encrypted. Click \"Reveal Fills\" to decrypt your fill status."
          }
        </p>
      </div>
    </div>
  );
}
