"use client";

import { useEffect, useState } from "react";
import { ClaimStatusLive } from "@/components/ClaimStatusLive";
import { isDeadlinePassed } from "@/lib/genlayer/claim-display";
import { isLegacyClaim } from "@/lib/legacy-claim-ids";

/**
 * Status only. Settlement is the keeper (lock_deadline_evidence, then
 * resolve_verdict + payout, or resolve_appeal after an appeal is filed).
 * There is no user-facing lock or resolve control here under any keeper
 * flag — those writes are not offered from this app's UI.
 */
export function LifecyclePanel({
  claimId,
  state,
  deadline,
  originContract,
  createdAt,
}: {
  claimId: string;
  state: string;
  deadline: string;
  originContract?: string;
  createdAt?: string;
}) {
  const [elapsed, setElapsed] = useState(() => isDeadlinePassed(deadline));
  const [liveState, setLiveState] = useState(state);

  useEffect(() => {
    setLiveState(state);
  }, [state]);

  useEffect(() => {
    if (elapsed || state !== "OPEN") return;
    const tick = () => {
      if (isDeadlinePassed(deadline)) setElapsed(true);
    };
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [deadline, elapsed, state]);

  useEffect(() => {
    if (state !== "OPEN" || !isDeadlinePassed(deadline)) return;
    setLiveState(state);
  }, [claimId, deadline, state]);

  const shown = liveState || state;
  if (
    isLegacyClaim({
      claim_id: claimId,
      origin_contract: originContract,
      created_at: createdAt,
    })
  ) {
    return null;
  }

  // Current status already renders ClaimStatusLive for EVIDENCE_LOCKED.
  if (shown === "EVIDENCE_LOCKED") {
    return null;
  }

  return null;
}
