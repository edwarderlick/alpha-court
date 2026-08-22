"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { activityOrder, activityTiming, claimTitle, type ClaimSummary } from "@/lib/genlayer/claim-display";
import { useMergedClaims } from "@/lib/use-merged-claims";
import { AssetPairMark } from "./AssetMark";
import { AddressMark, shortenAddress } from "./AddressMark";
import { Countdown } from "./Countdown";
import { ClaimStatusLive } from "./ClaimStatusLive";
import { caseHref, claimRowKey } from "@/lib/legacy-claim-ids";
import { isPendingClaimId } from "@/lib/genlayer/claim-display";

function Timing({ claim }: { claim: ClaimSummary }) {
  const [label, setLabel] = useState("");
  useEffect(() => {
    setLabel(activityTiming(claim));
  }, [claim]);
  if (!label) return null;
  return (
    <div className="font-mono text-[11px] uppercase tracking-widest text-secondary-fixed">{label}</div>
  );
}

export function ActivityBoard({ claims }: { claims: ClaimSummary[] }) {
  const merged = activityOrder(useMergedClaims(claims));

  return (
    <>
      <p className="mt-2 font-mono text-sm text-on-surface-variant uppercase tracking-wide">
        {merged.length} dockets on the board
      </p>
      {merged.length === 0 && (
        <p className="text-on-surface-variant mt-6">
          Studio cannot list claims right now. Anything you just filed still lives on-chain and will
          show here from this browser after you submit.
        </p>
      )}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 mt-6">
        {merged.map((claim) => {
          const isOpen = claim.state === "OPEN" || claim.state === "EVIDENCE_LOCKED";
          const forTotal = parseFloat(claim.stake_for_total);
          const againstTotal = parseFloat(claim.stake_against_total);
          const pool = forTotal + againstTotal;
          const forPct = pool > 0 ? (forTotal / pool) * 100 : 50;
          return (
            <article
              key={claimRowKey(claim)}
              className="pressable bg-surface-container-low border border-white/10 p-5 flex flex-row gap-4 items-stretch hover:border-primary/40 transition-colors"
            >
              <div className="flex-1 min-w-0 flex flex-col gap-3">
                <div className="flex items-center gap-2 flex-wrap">
                  <ClaimStatusLive
                    state={claim.state}
                    deadline={claim.deadline}
                    consensus={claim.consensus_result}
                    claimId={claim.claim_id}
                    originContract={claim.origin_contract}
                    createdAt={claim.created_at}
                    compact
                  />
                  <span className="font-mono text-[11px] text-on-surface-variant uppercase">#{claim.claim_id}</span>
                </div>
                <Link
                  href={isPendingClaimId(claim.claim_id) ? "/browse-cases" : caseHref(claim)}
                  className="flex items-center gap-3 font-display text-2xl md:text-3xl text-on-surface hover:text-primary transition-colors leading-none tracking-tight"
                >
                  <AssetPairMark a={claim.asset} b={claim.asset_b} size={32} />
                  <span className="min-w-0 truncate">{claimTitle(claim)}</span>
                </Link>
                {claim.poster ? (
                  <div className="flex items-center gap-2 font-mono text-xs">
                    <AddressMark address={claim.poster} size={18} />
                    <span className="text-on-surface-variant uppercase">Claimant</span>
                    <Link href={`/alpha-passport?address=${claim.poster}`} className="text-secondary-fixed hover:underline">
                      {shortenAddress(claim.poster)}
                    </Link>
                  </div>
                ) : null}
                <Timing claim={claim} />
              </div>
              <div className="w-40 shrink-0 border border-white/10 bg-surface-container-lowest p-3 flex flex-col justify-between">
                {isOpen ? (
                  <>
                    <div>
                      <p className="font-mono text-[10px] uppercase tracking-wide text-on-surface-variant mb-1">Deadline</p>
                      <p className="font-display text-xl text-dispute-red leading-none">
                        <Countdown targetIso={claim.deadline} />
                      </p>
                    </div>
                    <div>
                      <div className="flex justify-between font-mono text-[10px] mb-1">
                        <span className="text-secondary-fixed">F {claim.stake_for_total}</span>
                        <span className="text-dispute-red">A {claim.stake_against_total}</span>
                      </div>
                      <div className="h-1.5 bg-surface-container-highest overflow-hidden flex">
                        <div className="h-full bg-secondary-fixed" style={{ width: `${forPct}%` }} />
                        <div className="h-full bg-dispute-red" style={{ width: `${100 - forPct}%` }} />
                      </div>
                    </div>
                  </>
                ) : (
                  <div className="flex flex-col items-center justify-center h-full text-center gap-1">
                    <p className="font-display text-2xl text-secondary-fixed leading-none">
                      {claim.consensus_result || claim.state}
                    </p>
                  </div>
                )}
              </div>
            </article>
          );
        })}
      </div>
    </>
  );
}
