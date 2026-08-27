"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAppState } from "@/lib/store";
import { stake } from "@/lib/genlayer/actions";
import { PendingTransferError, UnconfirmedSubmissionError } from "@/lib/genlayer/errors";
import { TREASURY_ADDRESS } from "@/lib/genlayer/treasury";
import { emitPulse, hrefForKind, tabForKind } from "@/lib/market-pulse";
import { notifyStakesChanged } from "@/lib/use-live-claim";
import { explainContractError, isDeadlinePassed, isOnChainClaimId, stakingWindowOpen } from "@/lib/genlayer/claim-display";

/**
 * Build Prompt 9: no staking UI existed anywhere in the merged Stitch
 * exports (checked every theme folder, not just the merged app) -- this is
 * a real addition, not a reuse-in-place wiring of something that already
 * existed. Kept minimal and visually consistent with the surrounding
 * case-detail panels rather than introducing new design language.
 *
 * Build Prompt 11: now signs with the connected wallet when one is
 * connected (via lib/genlayer/actions.ts's stake()), falling back to
 * demo signing only if NEXT_PUBLIC_ALLOW_DEMO_SIGNING is set and no
 * wallet is connected -- see that file's header for the real signing-path
 * decision.
 */
export function StakeForm({
  claimId,
  state,
  deadline,
  title,
  originContract,
  onStaked,
}: {
  claimId: string;
  state: string;
  deadline?: string;
  title?: string;
  originContract?: string;
  onStaked?: (side: "for" | "against", amount: number) => void;
}) {
  const { wallet } = useAppState();
  const router = useRouter();
  const [side, setSide] = useState<"for" | "against">("for");
  const [amount, setAmount] = useState("1");
  const [status, setStatus] = useState<
    | { kind: "idle" }
    | { kind: "pending" }
    | { kind: "waiting_transfer"; txHash: string }
    | { kind: "done"; txHash: string }
    | { kind: "error"; message: string }
    | { kind: "unconfirmed"; txHash: string }
  >({ kind: "idle" });

  const windowOpen = stakingWindowOpen(state, deadline ?? "");
  const deadlineElapsed = Boolean(deadline) && isDeadlinePassed(deadline!);
  const locked = status.kind === "unconfirmed";
  const retryingTransfer = status.kind === "waiting_transfer";

  async function submit() {
    const amountNum = parseFloat(amount);
    if (!Number.isFinite(amountNum) || amountNum < 1 || amountNum > 10) {
      setStatus({ kind: "error", message: "Amount must be between 1 and 10 GEN" });
      return;
    }
    if (!isOnChainClaimId(claimId)) {
      setStatus({
        kind: "error",
        message: explainContractError("[EXPECTED] unknown claim_id"),
      });
      return;
    }
    if (!windowOpen) {
      setStatus({
        kind: "error",
        message: deadlineElapsed
          ? "Staking window closed — the deadline has already passed."
          : `Staking is only open while a claim is OPEN (this one is ${state}).`,
      });
      return;
    }
    const existing = status.kind === "waiting_transfer" ? status.txHash : undefined;
    setStatus({ kind: "pending" });
    try {
      // Two-step: native send to the published treasury, then a zero-value
      // register with that tx_hash. A rejected MetaMask signature throws
      // here before any transaction is ever sent.
      const { txHash } = await stake(wallet, claimId.trim(), side, amountNum, existing);
      setStatus({ kind: "done", txHash });
      if (wallet.address) {
        void fetch("/api/stakes/remember", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            address: wallet.address,
            claimId: claimId.trim(),
            side,
            amountGen: amountNum,
            originContract: originContract || undefined,
          }),
        });
      }
      onStaked?.(side, amountNum);
      notifyStakesChanged(claimId.trim());
      const kind = side === "for" ? "stake_for" : "stake_against";
      emitPulse({
        kind,
        claimId: claimId.trim(),
        title: title || `Claim #${claimId}`,
        amount: String(amountNum),
        href: hrefForKind(kind, claimId.trim()),
        tab: tabForKind(kind),
      });
      router.refresh();
    } catch (err) {
      // Real incident: a submission can succeed on-chain but fail to
      // CONFIRM back to the UI (a transient network blip after
      // broadcast) -- see lib/genlayer/errors.ts. Shown distinctly and
      // the form stays disabled, so a visitor can't blindly retry into a
      // real duplicate stake.
      if (err instanceof PendingTransferError) {
        setStatus({ kind: "waiting_transfer", txHash: err.txHash });
        return;
      }
      if (err instanceof UnconfirmedSubmissionError) {
        setStatus({ kind: "unconfirmed", txHash: err.txHash });
        return;
      }
      setStatus({
        kind: "error",
        message: explainContractError(err instanceof Error ? err.message : String(err)),
      });
    }
  }

  return (
    <div className="bg-surface-container-lowest border border-white/10 p-6 flex flex-col gap-4">
      <div className="font-label-mono-bold text-label-mono-bold text-on-surface-variant uppercase tracking-widest">
        Stake on this claim
      </div>
      {!windowOpen && (
        <p className="font-body-md text-body-md text-on-surface-variant">
          {deadlineElapsed
            ? "Staking is closed. The deadline has passed — new stakes would revert on-chain."
            : `Staking is only open while a claim is in state OPEN (this one is ${state}).`}
        </p>
      )}
      {windowOpen && (
        <>
          <div className="flex gap-2">
            <button
              onClick={() => setSide("for")}
              disabled={locked || retryingTransfer}
              className={`pressable flex-1 py-3 rounded-full font-label-mono-bold text-label-mono-bold uppercase transition-colors disabled:opacity-50 ${
                side === "for" ? "bg-secondary-fixed text-on-secondary-fixed" : "bg-surface-variant text-on-surface-variant"
              }`}
            >
              For
            </button>
            <button
              onClick={() => setSide("against")}
              disabled={locked || retryingTransfer}
              className={`pressable flex-1 py-3 rounded-full font-label-mono-bold text-label-mono-bold uppercase transition-colors disabled:opacity-50 ${
                side === "against" ? "bg-dispute-red text-white" : "bg-surface-variant text-on-surface-variant"
              }`}
            >
              Against
            </button>
          </div>
          <p className="font-body-md text-body-md text-on-surface-variant break-all">
            Send this amount to the court. The contract verifies the
            transfer by hash and pays winners from that same balance.
            Deposit address: <span className="font-mono text-on-surface">{TREASURY_ADDRESS}</span>
          </p>
          <label className="flex flex-col gap-1">
            <span className="font-label-mono-sm text-label-mono-sm text-on-surface-variant">Amount (GEN, 1-10)</span>
            <input
              type="number"
              min={1}
              max={10}
              step="0.1"
              value={amount}
              disabled={locked || retryingTransfer}
              onChange={(e) => setAmount(e.target.value)}
              className="bg-surface-container border border-white/10 rounded-lg px-4 py-2 text-on-surface disabled:opacity-50"
            />
          </label>
          <button
            onClick={submit}
            disabled={status.kind === "pending" || locked}
            className="pressable bg-primary text-on-primary font-label-mono-bold text-label-mono-bold py-3 rounded-full uppercase disabled:opacity-50"
          >
            {status.kind === "pending"
              ? wallet.status === "connected"
                ? "Confirm transfer, then register..."
                : "Submitting..."
              : status.kind === "waiting_transfer"
                ? "Register transfer"
                : `Stake ${side.toUpperCase()}`}
          </button>
        </>
      )}
      {status.kind === "done" && (
        <div className="stake-ink text-secondary-fixed font-label-mono-sm text-label-mono-sm">
          <img src="/cast/challenger.jpg" alt="" />
          <div>
            <div className="font-display text-xl uppercase leading-none">Stake landed</div>
            <div className="break-all mt-1">Tx: {status.txHash}</div>
          </div>
        </div>
      )}
      {status.kind === "error" && (
        <div className="text-dispute-red font-label-mono-sm text-label-mono-sm break-all">
          Error: {status.message}
        </div>
      )}
      {status.kind === "waiting_transfer" && (
        <div className="bg-arbitration-orange/10 border border-arbitration-orange/40 rounded-lg p-4 flex flex-col gap-2">
          <p className="text-arbitration-orange font-label-mono-sm text-label-mono-sm">
            Transfer submitted (tx {status.txHash.slice(0, 10)}...{status.txHash.slice(-6)}) but
            Studio has not finalized it yet. That is visibility lag, not a failed send.
          </p>
          <p className="font-body-md text-body-md text-on-surface-variant">
            Do not send the GEN again. Use Register transfer once Studio can see the hash.
          </p>
        </div>
      )}
      {status.kind === "unconfirmed" && (
        <div className="bg-arbitration-orange/10 border border-arbitration-orange/40 rounded-lg p-4 flex flex-col gap-2">
          <p className="text-arbitration-orange font-label-mono-sm text-label-mono-sm">
            Submitted (tx {status.txHash.slice(0, 10)}...{status.txHash.slice(-6)}) but we couldn&apos;t
            confirm it -- a network blip, not necessarily a failure. It may have already gone through.
          </p>
          <p className="font-body-md text-body-md text-on-surface-variant">
            Reload this page to check the real stake totals below before submitting again, to avoid a
            duplicate.
          </p>
        </div>
      )}
    </div>
  );
}
