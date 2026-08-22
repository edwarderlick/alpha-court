"use client";

import { useEffect, useState } from "react";
import { useLiveClaim } from "@/lib/use-live-claim";
import { OddsBar } from "./OddsBar";
import { StakeForm } from "./StakeForm";
import { saveLocalDocket } from "@/lib/local-dockets";
import type { ClaimSummary } from "@/lib/genlayer/claim-display";
import { isOnChainClaimId, stakingWindowOpen } from "@/lib/genlayer/claim-display";
import { isLegacyClaim } from "@/lib/legacy-claim-ids";

export function LiveStakePanel({
  claimId,
  state,
  deadline,
  title,
  forTotal,
  againstTotal,
  snapshot,
}: {
  claimId: string;
  state: string;
  deadline?: string;
  title?: string;
  forTotal: number;
  againstTotal: number;
  snapshot?: ClaimSummary;
}) {
  const [forAmt, setForAmt] = useState(forTotal);
  const [againstAmt, setAgainstAmt] = useState(againstTotal);
  const canStake = isOnChainClaimId(claimId);
  const legacy = isLegacyClaim(snapshot ?? { claim_id: claimId });
  const live = useLiveClaim(claimId, snapshot ?? null, { enabled: canStake && !legacy, legacy });
  const liveFor = live?.stake_for_total;
  const liveAgainst = live?.stake_against_total;
  useEffect(() => {
    if (liveFor != null) setForAmt(parseFloat(String(liveFor)) || 0);
    if (liveAgainst != null) setAgainstAmt(parseFloat(String(liveAgainst)) || 0);
  }, [liveFor, liveAgainst]);
  const liveState = live?.state || state;
  const liveDeadline = live?.deadline || deadline || snapshot?.deadline;
  const windowOpen = stakingWindowOpen(liveState, liveDeadline ?? "");

  async function reconcile() {
    try {
      const res = await fetch(`/api/claims/${claimId}`);
      const data = await res.json();
      const claim = data.claim as ClaimSummary | undefined;
      if (!claim) return;
      setForAmt(parseFloat(claim.stake_for_total) || 0);
      setAgainstAmt(parseFloat(claim.stake_against_total) || 0);
      saveLocalDocket(claim);
    } catch {
      /* keep optimistic totals */
    }
  }

  return (
    <>
      <div className="bg-surface-container-lowest border border-white/10 p-6">
        <OddsBar forTotal={forAmt} againstTotal={againstAmt} />
      </div>
      {windowOpen && canStake && (
        <StakeForm
          claimId={claimId}
          state={liveState}
          deadline={liveDeadline}
          title={title}
          originContract={live?.origin_contract || snapshot?.origin_contract}
          onStaked={(side, amount) => {
            if (side === "for") setForAmt((n) => n + amount);
            else setAgainstAmt((n) => n + amount);
            if (snapshot) {
              saveLocalDocket({
                ...snapshot,
                stake_for_total: String(side === "for" ? forAmt + amount : forAmt),
                stake_against_total: String(side === "against" ? againstAmt + amount : againstAmt),
              });
            }
            void reconcile();
          }}
        />
      )}
      {state === "OPEN" && !canStake && (
        <div className="bg-arbitration-orange/10 border border-arbitration-orange/40 p-5 font-mono text-sm text-arbitration-orange">
          This row is waiting for the real on-chain claim id. Do not stake yet. Refresh Markets
          after Studio can read, or open the numeric /cases/N link.
        </div>
      )}
      {state === "OPEN" && canStake && !windowOpen && (
        <div className="bg-surface-container-lowest border border-white/10 p-5 font-mono text-sm text-on-surface-variant">
          Staking is closed. The deadline has passed. New stakes would revert on-chain.
        </div>
      )}
    </>
  );
}
