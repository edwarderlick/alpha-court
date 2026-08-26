"use client";

import { getWalletWriteClient, waitFinalizedInBrowser } from "./wallet";
import { genToAtto, genFloatToAtto } from "./atto";
import { PendingTransferError, UnconfirmedSubmissionError } from "./errors";
import { sendNativeToTreasury, waitForNativeTxFinalized } from "./deposit";
import { studioCanWrite } from "./studio-gate";
import { extractClaimId } from "./receipt";
import { readClaimInBrowser } from "./browser-read";
import {
  explainContractError,
  isDeadlinePassed,
  isOnChainClaimId,
  type ClaimSummary,
} from "./claim-display";
import type { WalletState } from "../store";

/**
 * Build Prompt 11: the one place every write action decides real-wallet
 * vs demo-signing, mirroring Provider Court's lib/chain-client.ts
 * `requireSigningPath` pattern (confirmed to be its real, shipped
 * implementation before reusing the structure). Every UI component that
 * triggers a write (StakeForm, post-a-claim, AppealPanel) calls exactly
 * one function from this file -- no component calls `fetch` on a write
 * route or `getWalletWriteClient` directly itself, so there is exactly
 * one place the demo/real branch is decided, not one per call site.
 *
 * NEXT_PUBLIC_ALLOW_DEMO_SIGNING only controls what the FRONTEND *offers*
 * as a fallback when no wallet is connected -- it is not the real security
 * boundary. That's ALLOW_DEMO_SIGNING (server-only, lib/genlayer/client.ts),
 * which every demo-path API route below still depends on regardless of
 * what this flag says. A real wallet-connected visitor always signs with
 * their own wallet, regardless of this flag either way.
 */
const ALLOW_DEMO_SIGNING = process.env.NEXT_PUBLIC_ALLOW_DEMO_SIGNING === "true";

const CONTRACT_ADDRESS = process.env.NEXT_PUBLIC_ALPHA_COURT_CONTRACT_ADDRESS as `0x${string}`;

function canSignWithWallet(wallet: WalletState): boolean {
  return wallet.status === "connected" && !wallet.wrongNetwork && Boolean(wallet.address);
}

function requireSigningPath(wallet: WalletState): "wallet" | "demo" {
  if (canSignWithWallet(wallet)) return "wallet";
  if (ALLOW_DEMO_SIGNING) return "demo";
  throw new Error("Connect your wallet to continue.");
}

/**
 * Reconstructs UnconfirmedSubmissionError from the demo path's JSON
 * error response (see lib/genlayer/api-error.ts, the server-side
 * counterpart) so every UI component checks exactly one error type
 * regardless of which path signed -- real wallet writes throw it
 * natively (see wallet.ts), demo-signed writes reconstruct it here.
 */
async function jsonOrThrow(res: Response) {
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    if (data?.unconfirmed && data?.txHash) {
      throw new UnconfirmedSubmissionError(data.txHash, new Error(data.error ?? res.statusText));
    }
    if (data?.pendingTransfer && data?.txHash) {
      throw new PendingTransferError(data.txHash, data.error ?? res.statusText);
    }
    throw new Error(explainContractError(data?.error ?? res.statusText));
  }
  return data;
}

export type WriteResult = { txHash: string; claimId?: string; transferHash?: string };

function requireNumericClaimId(claimId: string): string {
  const id = claimId.trim();
  if (!isOnChainClaimId(id)) {
    throw new Error(explainContractError("[EXPECTED] unknown claim_id"));
  }
  return id;
}

async function readLiveClaim(claimId: string): Promise<ClaimSummary> {
  const res = await fetch(`/api/claims/${encodeURIComponent(claimId)}`, { cache: "no-store" });
  const data = await res.json().catch(() => null);
  if (res.ok && data?.claim) return data.claim as ClaimSummary;
  const fromBrowser = await readClaimInBrowser(claimId);
  if (fromBrowser) return fromBrowser;
  throw new Error(explainContractError(data?.error ?? "[EXPECTED] unknown claim_id"));
}

async function assertStakeAllowed(claimId: string): Promise<ClaimSummary> {
  const id = requireNumericClaimId(claimId);
  const claim = await readLiveClaim(id);
  if (claim.state !== "OPEN") {
    throw new Error(
      explainContractError("[EXPECTED] claim is not OPEN") + ` On-chain state is ${claim.state}.`
    );
  }
  if (isDeadlinePassed(claim.deadline)) {
    throw new Error(
      "Staking window closed — the deadline has already passed. Do not send a stake transaction."
    );
  }
  return claim;
}

async function depositIfNeeded(from: string, valueAtto: bigint): Promise<string> {
  if (valueAtto <= 0n) return "";
  if (!studioCanWrite()) {
    throw new Error("Studio is rate-limiting writes. Check MetaMask Activity before sending again.");
  }
  const transferHash = await sendNativeToTreasury(from, valueAtto);
  await waitForNativeTxFinalized(from, transferHash);
  return transferHash;
}

export async function createClaim(
  wallet: WalletState,
  body:
    | { claimType: "PRICE_THRESHOLD"; asset: string; thresholdPrice: string; direction: string; deadline: string; postingStakeGen: number }
    | { claimType: "RELATIVE_PERFORMANCE"; assetA: string; assetB: string; deadline: string; postingStakeGen: number }
    | { claimType: "FUNDAMENTALS_THRESHOLD"; asset: string; metric: string; thresholdValue: string; direction: string; deadline: string; postingStakeGen: number },
  existingTransferHash?: string
): Promise<WriteResult> {
  if (requireSigningPath(wallet) === "demo") {
    const res = await fetch("/api/claims", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(150_000),
    });
    return jsonOrThrow(res);
  }

  if (!studioCanWrite()) {
    throw new Error("Studio is rate-limiting writes. Check MetaMask Activity before sending again.");
  }

  const value = genFloatToAtto(body.postingStakeGen ?? 0);
  let transferHash = existingTransferHash || "";
  if (existingTransferHash) {
    await waitForNativeTxFinalized(wallet.address!, existingTransferHash);
  } else {
    transferHash = await depositIfNeeded(wallet.address!, value);
  }

  const client = getWalletWriteClient(wallet.address!);
  let functionName: string;
  let args: unknown[];
  if (body.claimType === "RELATIVE_PERFORMANCE") {
    functionName = "create_relative_performance_claim";
    args = [body.assetA, body.assetB, body.deadline, transferHash];
  } else if (body.claimType === "FUNDAMENTALS_THRESHOLD") {
    functionName = "create_fundamentals_claim";
    args = [body.asset, body.metric, body.thresholdValue, body.direction, body.deadline, transferHash];
  } else {
    functionName = "create_claim";
    args = [body.asset, body.thresholdPrice, body.direction, body.deadline, transferHash];
  }

  const hash = await client.writeContract({
    address: CONTRACT_ADDRESS,
    functionName,
    args: args as never,
    value: 0n,
  });
  const receipt = await waitFinalizedInBrowser(client, hash);
  return { txHash: hash, claimId: extractClaimId(receipt), transferHash };
}

export async function stake(
  wallet: WalletState,
  claimId: string,
  side: "for" | "against",
  amountGen: number,
  existingTransferHash?: string
): Promise<WriteResult> {
  await assertStakeAllowed(claimId);
  if (!studioCanWrite()) {
    throw new Error("Studio is rate-limiting writes. Check MetaMask Activity before sending again.");
  }
  if (requireSigningPath(wallet) === "demo") {
    const res = await fetch(`/api/claims/${claimId}/stake`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ side, amountGen, transferHash: existingTransferHash }),
    });
    return jsonOrThrow(res);
  }

  const value = genFloatToAtto(amountGen);
  const transferHash =
    existingTransferHash || (await depositIfNeeded(wallet.address!, value));
  if (!existingTransferHash) {
    // depositIfNeeded already waited; if the caller passed a hash they
    // already saw as pending, wait once more before registering.
  } else {
    await waitForNativeTxFinalized(wallet.address!, transferHash);
  }

  const client = getWalletWriteClient(wallet.address!);
  const hash = await client.writeContract({
    address: CONTRACT_ADDRESS,
    functionName: side === "for" ? "stake_for" : "stake_against",
    args: [claimId, transferHash],
    value: 0n,
  });
  await waitFinalizedInBrowser(client, hash);
  return { txHash: hash, transferHash };
}

/**
 * fileAppeal needs the claim's real, already-computed appeal_bond (exact
 * decimal string from get_claim) so it can send EXACTLY that amount via
 * genToAtto -- same exact-match discipline as the server path, now
 * needed client-side too since real signing happens here.
 */
export async function fileAppeal(
  wallet: WalletState,
  claimId: string,
  appealBondDecimal: string,
  existingTransferHash?: string
): Promise<WriteResult> {
  const id = requireNumericClaimId(claimId);
  if (!studioCanWrite()) {
    throw new Error("Studio is rate-limiting writes. Check MetaMask Activity before sending again.");
  }
  if (requireSigningPath(wallet) === "demo") {
    const res = await fetch(`/api/claims/${id}/appeal`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ transferHash: existingTransferHash }),
    });
    return jsonOrThrow(res);
  }

  const value = genToAtto(appealBondDecimal);
  const transferHash =
    existingTransferHash || (await depositIfNeeded(wallet.address!, value));
  if (existingTransferHash) {
    await waitForNativeTxFinalized(wallet.address!, transferHash);
  }

  const client = getWalletWriteClient(wallet.address!);
  const hash = await client.writeContract({
    address: CONTRACT_ADDRESS,
    functionName: "file_appeal",
    args: [id, transferHash],
    value: 0n,
  });
  await waitFinalizedInBrowser(client, hash);
  return { txHash: hash, transferHash };
}

export async function resolveAppeal(wallet: WalletState, claimId: string): Promise<WriteResult> {
  const id = requireNumericClaimId(claimId);
  if (requireSigningPath(wallet) === "demo") {
    const res = await fetch(`/api/claims/${id}/resolve-appeal`, { method: "POST" });
    return jsonOrThrow(res);
  }
  const client = getWalletWriteClient(wallet.address!);
  const hash = await client.writeContract({
    address: CONTRACT_ADDRESS,
    functionName: "resolve_appeal",
    args: [id],
    value: 0n,
  });
  await waitFinalizedInBrowser(client, hash);
  return { txHash: hash };
}

export async function expireAppeal(wallet: WalletState, claimId: string): Promise<WriteResult> {
  const id = requireNumericClaimId(claimId);
  if (requireSigningPath(wallet) === "demo") {
    const res = await fetch(`/api/claims/${id}/expire-appeal`, { method: "POST" });
    return jsonOrThrow(res);
  }
  const client = getWalletWriteClient(wallet.address!);
  const hash = await client.writeContract({
    address: CONTRACT_ADDRESS,
    functionName: "expire_appeal",
    args: [id],
    value: 0n,
  });
  await waitFinalizedInBrowser(client, hash);
  return { txHash: hash };
}


