"use client";

import { Countdown } from "./Countdown";
import { isDeadlinePassed } from "@/lib/genlayer/claim-display";
import { isLegacyClaim } from "@/lib/legacy-claim-ids";
import { useLiveClaim } from "@/lib/use-live-claim";

export function ClaimStatusLive({
  state,
  deadline,
  consensus,
  claimId,
  originContract,
  createdAt,
  compact = false,
  live: poll = true,
}: {
  state: string;
  deadline?: string;
  consensus?: string;
  claimId?: string;
  originContract?: string;
  createdAt?: string;
  compact?: boolean;
  live?: boolean;
}) {
  const legacy = isLegacyClaim({
    claim_id: claimId,
    origin_contract: originContract,
    created_at: createdAt,
  });
  const live = useLiveClaim(claimId || "", {
    state,
    deadline,
    consensus_result: consensus,
    claim_id: claimId,
    origin_contract: originContract,
    created_at: createdAt,
  }, { legacy, enabled: poll && !compact && Boolean(claimId) && !legacy });
  const liveState = live?.state || state;
  const liveDeadline = live?.deadline || deadline;
  const liveConsensus = live?.consensus_result || consensus;
  const elapsed = Boolean(liveDeadline && isDeadlinePassed(liveDeadline));

  if (legacy && liveState !== "RESOLVED" && liveState !== "CONTESTED" && liveState !== "APPEAL_PENDING") {
    return (
      <div className={`claim-live claim-live-legacy ${compact ? "claim-live-compact" : ""}`}>
        <div>
          <div className="claim-live-label">Legacy docket</div>
          {!compact ? (
            <p className="claim-live-copy">
              This claim is on the retired court contract. The keeper will not
              lock or resolve it. It stays as a historical record.
            </p>
          ) : null}
        </div>
      </div>
    );
  }

  if (liveState === "OPEN" && !elapsed) {
    return (
      <div className={`claim-live claim-live-open ${compact ? "claim-live-compact" : ""}`}>
        <span className="claim-live-dot" />
        <div>
          <div className="claim-live-label">Open</div>
          {liveDeadline ? (
            <div className="claim-live-detail">
              <Countdown targetIso={liveDeadline} />
            </div>
          ) : null}
        </div>
      </div>
    );
  }

  if (liveState === "OPEN" && elapsed) {
    return (
      <div className={`claim-live claim-live-wait ${compact ? "claim-live-compact" : ""}`}>
        <span className="claim-live-orbit" aria-hidden>
          <span />
          <span />
          <span />
        </span>
        <div>
          <div className="claim-live-label">Settling</div>
          {!compact ? (
            <p className="claim-live-copy">Deadline passed. Keeper will freeze the price next.</p>
          ) : null}
        </div>
      </div>
    );
  }

  if (liveState === "EVIDENCE_LOCKED") {
    return (
      <div className={`claim-live claim-live-consensus ${compact ? "claim-live-compact" : ""}`}>
        {!compact ? <img src="/cast/validator.jpg" alt="" className="claim-live-fig" /> : (
          <img src="/cast/validator.jpg" alt="" className="claim-live-fig-mini" />
        )}
        <span className="claim-live-orbit" aria-hidden>
          <span />
          <span />
          <span />
        </span>
        <div>
          <div className="claim-live-label">Consensus in progress</div>
          {!compact ? (
            <p className="claim-live-copy">
              Price is frozen. Validators are deciding HELD or BROKEN. Duration is not a
              fixed clock, so this is motion only, not a percent complete.
            </p>
          ) : null}
        </div>
      </div>
    );
  }

  if (liveState === "RESOLVED") {
    const held = (liveConsensus || "").toUpperCase() === "HELD";
    return (
      <div className={`claim-live claim-live-done ${held ? "is-held" : "is-broken"} ${compact ? "claim-live-compact" : ""}`}>
        <span className="claim-live-stamp">{liveConsensus || "RESOLVED"}</span>
        {!compact ? (
          <p className="claim-live-copy">
            Verdict is on-chain. GEN payout is a keeper native send after
            resolve — credited on My Stakes only when the wallet balance
            actually increases, not an IC→EOA transfer.
          </p>
        ) : null}
      </div>
    );
  }

  if (liveState === "REFUNDED") {
    return (
      <div className={`claim-live claim-live-wait ${compact ? "claim-live-compact" : ""}`}>
        <div>
          <div className="claim-live-label">Refunded</div>
          {!compact ? (
            <p className="claim-live-copy">
              On-chain state is REFUNDED. GEN returns as a keeper native send,
              credited on My Stakes only when the wallet balance actually increases.
            </p>
          ) : null}
        </div>
      </div>
    );
  }

  if (liveState === "CONTESTED") {
    return (
      <div className={`claim-live claim-live-wait ${compact ? "claim-live-compact" : ""}`}>
        <span className="claim-live-dot" />
        <div>
          <div className="claim-live-label">On appeal</div>
          {!compact ? (
            <p className="claim-live-copy">
              No agreed verdict. File an appeal within 48 hours, or the keeper
              refunds everyone when the window closes.
            </p>
          ) : null}
        </div>
      </div>
    );
  }

  if (liveState === "APPEAL_PENDING") {
    return (
      <div className={`claim-live claim-live-consensus ${compact ? "claim-live-compact" : ""}`}>
        {!compact ? <img src="/cast/validator.jpg" alt="" className="claim-live-fig" /> : (
          <img src="/cast/validator.jpg" alt="" className="claim-live-fig-mini" />
        )}
        <span className="claim-live-orbit" aria-hidden>
          <span />
          <span />
          <span />
        </span>
        <div>
          <div className="claim-live-label">Second consensus in progress</div>
          {!compact ? (
            <p className="claim-live-copy">
              Appeal is filed. The keeper runs the second consensus round
              the same way it resolves a frozen claim. Nobody has to click.
            </p>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div className={`claim-live ${compact ? "claim-live-compact" : ""}`}>
      <div className="claim-live-label">{liveState.replace(/_/g, " ")}</div>
    </div>
  );
}
