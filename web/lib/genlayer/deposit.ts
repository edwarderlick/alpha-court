"use client";

import { TREASURY_ADDRESS } from "./treasury";
import { PendingTransferError } from "./errors";
import { getActiveProvider, getWalletWriteClient } from "./wallet";
import { studioCanWrite, studioNoteError } from "./studio-gate";

function hexValue(atto: bigint): `0x${string}` {
  return `0x${atto.toString(16)}`;
}

function isFinalized(tx: unknown): boolean {
  if (!tx || typeof tx !== "object") return false;
  const status = (tx as { status?: unknown; status_name?: unknown }).status ??
    (tx as { status_name?: unknown }).status_name;
  if (status === 7 || status === "7") return true;
  return String(status).toUpperCase() === "FINALIZED";
}

/**
 * Wallet native send to the published treasury. Zero contract interaction.
 * Gated on the same Studio write window as every other write — a stake
 * now costs a consensus round on register, so it must not bypass the
 * rate-limit coordinator.
 */
export async function sendNativeToTreasury(from: string, valueAtto: bigint): Promise<string> {
  if (!studioCanWrite()) {
    throw new Error("Studio is rate-limiting writes. Check MetaMask Activity before sending again.");
  }
  if (valueAtto <= 0n) {
    throw new Error("Deposit amount must be positive");
  }
  const provider = getActiveProvider();
  if (!provider) {
    throw new Error("No wallet extension detected.");
  }
  try {
    const hash = (await provider.request({
      method: "eth_sendTransaction",
      params: [
        {
          from,
          to: TREASURY_ADDRESS,
          value: hexValue(valueAtto),
        },
      ],
    })) as string;
    if (!hash || !hash.startsWith("0x")) {
      throw new Error("Wallet did not return a transfer hash");
    }
    return hash;
  } catch (err) {
    studioNoteError(err, "write");
    throw err;
  }
}

/** Poll until Studio RPC reports the native send as FINALIZED. */
export async function waitForNativeTxFinalized(
  from: string,
  hash: string,
  attempts = 24,
  intervalMs = 2500
): Promise<void> {
  const client = getWalletWriteClient(from);
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      const tx = await client.getTransaction({ hash: hash as never });
      if (isFinalized(tx)) return;
    } catch (err) {
      lastErr = err;
      studioNoteError(err, "read");
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new PendingTransferError(hash, lastErr);
}
