"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Countdown } from "@/components/Countdown";
import { useAppState } from "@/lib/store";
import { fileAppeal, resolveAppeal, expireAppeal } from "@/lib/genlayer/actions";
import { PendingTransferError, UnconfirmedSubmissionError } from "@/lib/genlayer/errors";
import { TREASURY_ADDRESS } from "@/lib/genlayer/treasury";
import { explainContractError, isOnChainClaimId } from "@/lib/genlayer/claim-display";
import { useLiveClaim } from "@/lib/use-live-claim";
import type { ClaimSummary } from "@/lib/genlayer/claim-display";

type Props = {
  claimId: string;
  state: string;
  appealBond: string | null;
  contestedAt: string;
  appealOutcome: string;
  secondVerdictText: string;
  live?: boolean;
};

const APPEAL_WINDOW_HOURS = 48;

/**
 * Build Prompt 10: file_appeal/resolve_appeal/expire_appeal wired against
 * whatever real state is actually reachable. Genuine live validator
 * disagreement can't be forced on a real network (same constraint carried
 * from Build Prompt 8) -- see README's Build Prompt 10 section for how
 * this was verified without one.
 *
 * Build Prompt 11: all three actions now sign with the connected wallet
 * when one is connected, via lib/genlayer/actions.ts -- same real-vs-demo
 * decision as StakeForm, not a separate implementation of it here.
 */
export function AppealPanel({
  claimId,
  state,
  appealBond,
  contestedAt,
  appealOutcome,
  secondVerdictText,
  live: liveEnabled = true,
}: Props) {
  const live = useLiveClaim(
    claimId,
    {
      claim_id: claimId,
      state,
      contested_at: contestedAt,
    } as ClaimSummary,
    { enabled: liveEnabled && isOnChainClaimId(claimId) }
  );
  const shownState = live?.state || state;
  const shownBond =
    live && "appeal_bond" in live && live.appeal_bond != null
      ? String(live.appeal_bond)
      : appealBond;
  const shownContestedAt = live?.contested_at || contestedAt;
  const shownOutcome =
    live && "appeal_outcome" in live && live.appeal_outcome != null
      ? String(live.appeal_outcome)
      : appealOutcome;
  const shownSecond =
    live && "second_verdict_text" in live && live.second_verdict_text != null
      ? String(live.second_verdict_text)
      : secondVerdictText;
  const { wallet } = useAppState();
  const router = useRouter();
  const [status, setStatus] = useState<
    | { kind: "idle" }
    | { kind: "pending" }
    | { kind: "waiting_transfer"; txHash: string }
    | { kind: "done"; txHash: string }
    | { kind: "error"; message: string }
    | { kind: "unconfirmed"; txHash: string }
  >({ kind: "idle" });
  const locked = status.kind === "pending" || status.kind === "unconfirmed" || status.kind === "done";

  // Real incident (Build Prompt 12): a submission can succeed on-chain
  // but fail to CONFIRM back to the UI (a transient network blip after
  // broadcast) -- see lib/genlayer/errors.ts. Shared by all three actions
  // below rather than duplicated per-call-site.
  function handleResult(result: Promise<{ txHash: string }>) {
    return result
      .then(({ txHash }) => {
        setStatus({ kind: "done", txHash });
        router.refresh();
      })
      .catch((err) => {
        if (err instanceof PendingTransferError) {
          setStatus({ kind: "waiting_transfer", txHash: err.txHash });
          return;
        }
        if (err instanceof UnconfirmedSubmissionError) {
          setStatus({ kind: "unconfirmed", txHash: err.txHash });
          return;
        }
        setStatus({ kind: "error", message: err instanceof Error ? err.message : String(err) });
      });
  }

  function rejectPlaceholder(): boolean {
    if (isOnChainClaimId(claimId)) return false;
    setStatus({
      kind: "error",
      message: explainContractError("[EXPECTED] unknown claim_id"),
    });
    return true;
  }

  async function callAppeal() {
    if (rejectPlaceholder()) return;
    const existing = status.kind === "waiting_transfer" ? status.txHash : undefined;
    setStatus({ kind: "pending" });
    await handleResult(fileAppeal(wallet, claimId, shownBond ?? "0", existing));
  }

  async function callResolve() {
    if (rejectPlaceholder()) return;
    setStatus({ kind: "pending" });
    await handleResult(resolveAppeal(wallet, claimId));
  }

  async function callExpire() {
    if (rejectPlaceholder()) return;
    setStatus({ kind: "pending" });
    await handleResult(expireAppeal(wallet, claimId));
  }

  const statusMessages = (
    <>
      {status.kind === "done" && (
        <div className="text-secondary-fixed font-label-mono-sm text-label-mono-sm break-all">
          Tx: {status.txHash}
        </div>
      )}
      {status.kind === "error" && (
        <div className="text-dispute-red font-label-mono-sm text-label-mono-sm break-all">
          {status.message}
        </div>
      )}
      {status.kind === "waiting_transfer" && (
        <div className="bg-arbitration-orange/10 border border-arbitration-orange/40 rounded-lg p-4 flex flex-col gap-2">
          <p className="text-arbitration-orange font-label-mono-sm text-label-mono-sm break-all">
            Bond transfer submitted (tx {status.txHash}) but Studio has not finalized it yet.
            Visibility lag, not a failed send. Do not send the GEN again.
          </p>
        </div>
      )}
      {status.kind === "unconfirmed" && (
        <div className="bg-arbitration-orange/10 border border-arbitration-orange/40 rounded-lg p-4 flex flex-col gap-2">
          <p className="text-arbitration-orange font-label-mono-sm text-label-mono-sm break-all">
            Submitted (tx {status.txHash}) but we couldn&apos;t confirm it -- a network blip, not
            necessarily a failure.
          </p>
          <p className="font-body-md text-body-md text-on-surface-variant">
            Reload this page to check the real claim state above before trying again, to avoid a
            duplicate.
          </p>
        </div>
      )}
    </>
  );

  if (shownState === "CONTESTED") {
    const windowCloses = shownContestedAt
      ? new Date(new Date(shownContestedAt).getTime() + APPEAL_WINDOW_HOURS * 3600 * 1000).toISOString()
      : null;
    return (
      <div className="bg-dispute-red/10 border border-dispute-red/30 p-6 flex flex-col gap-4">
        <div className="font-label-mono-sm text-label-mono-sm text-dispute-red uppercase">
          CONTESTED — no agreed verdict reached
        </div>
        <div className="font-body-md text-body-md text-on-surface-variant">
          Required bond:{" "}
          <span className="text-on-surface font-bold">{shownBond ?? "—"} GEN</span> (25% of
          pool, clamped 1-5 GEN — send this exact amount to the court, then register
          the tx hash. The contract pays it back from the same balance.)
        </div>
        <p className="font-body-md text-body-md text-on-surface-variant break-all">
          Treasury: <span className="font-mono text-on-surface">{TREASURY_ADDRESS}</span>
        </p>
        {windowCloses && (
          <div className="font-label-mono-sm text-label-mono-sm text-on-surface-variant">
            Appeal window closes in: <Countdown targetIso={windowCloses} />
          </div>
        )}
        <button
          onClick={callAppeal}
          disabled={locked}
          className="w-full bg-background border border-dispute-red text-dispute-red font-display-md text-xl py-4 uppercase tracking-wide hover:bg-dispute-red hover:text-on-error transition-all disabled:opacity-50"
        >
          {status.kind === "pending"
            ? wallet.status === "connected"
              ? "Confirm transfer, then register..."
              : "Submitting..."
            : status.kind === "waiting_transfer"
              ? "Register transfer"
              : "File Appeal"}
        </button>
        {windowCloses && (
          <button
            onClick={callExpire}
            disabled={locked}
            className="w-full border border-white/20 text-on-surface-variant font-label-mono-sm text-label-mono-sm py-2 uppercase disabled:opacity-50"
          >
            Expire (only succeeds once the window has actually elapsed on-chain)
          </button>
        )}
        {statusMessages}
      </div>
    );
  }

  if (shownState === "APPEAL_PENDING") {
    return (
      <div className="bg-surface-container-lowest border border-white/10 p-6 flex flex-col gap-4">
        <div className="font-label-mono-sm text-label-mono-sm text-secondary-fixed uppercase">
          APPEAL_PENDING — keeper is running the second round
        </div>
        <p className="font-body-md text-body-md text-on-surface-variant">
          The keeper calls resolve_appeal on its own, the same way it resolves a
          frozen claim. Nobody has to click. The control below is only a
          permissionless fallback if you do not want to wait for the next tick.
        </p>
        <button
          onClick={callResolve}
          disabled={locked}
          className="w-full border border-white/20 text-on-surface-variant font-label-mono-sm text-label-mono-sm py-2 uppercase disabled:opacity-50"
        >
          {status.kind === "pending"
            ? wallet.status === "connected"
              ? "Confirm in wallet..."
              : "Running consensus..."
            : "Fallback: run second round now"}
        </button>
        {statusMessages}
      </div>
    );
  }

  if (shownState === "REFUNDED") {
    return (
      <div className="bg-surface-container-lowest border border-white/10 p-6">
        <div className="font-label-mono-sm text-label-mono-sm text-on-surface-variant uppercase mb-2">
          REFUNDED
        </div>
        <p className="font-body-md text-body-md text-on-surface-variant">
          {shownOutcome === "NO_AGREEMENT"
            ? "The appeal round also failed to reach an agreed verdict. The contract marked REFUNDED. Stakes and the forfeited bond are refunded directly via emit_transfer from the contract balance."
            : "Window elapsed with no appeal filed. The contract marked REFUNDED. Stakes are refunded directly via emit_transfer from the contract balance."}
        </p>
      </div>
    );
  }

  if (shownOutcome === "SETTLED") {
    return (
      <div className="bg-surface-container-lowest border border-secondary-fixed/40 p-6">
        <div className="font-label-mono-sm text-label-mono-sm text-secondary-fixed uppercase mb-2">
          RESOLVED VIA APPEAL (SETTLED)
        </div>
        <p className="font-body-md text-body-md text-on-surface-variant">{shownSecond}</p>
      </div>
    );
  }

  return null;
}
