"use client";

import { useState } from "react";
import { verdictPlainSummary } from "@/lib/genlayer/claim-display";

export function VerdictCard({
  heading,
  claimType,
  asset,
  assetB,
  metric,
  direction,
  threshold,
  deadline,
  deadlinePrice,
  deadlinePriceB,
  consensus,
  appealNote,
  reasoning,
}: {
  heading: string;
  claimType: string;
  asset: string;
  assetB?: string | null;
  metric?: string | null;
  direction?: string | null;
  threshold?: string | null;
  deadline: string;
  deadlinePrice?: string | null;
  deadlinePriceB?: string | null;
  consensus: string;
  appealNote?: string;
  reasoning: string;
}) {
  const [open, setOpen] = useState(false);
  const summary = verdictPlainSummary({
    claim_type: claimType,
    asset,
    asset_b: assetB,
    metric,
    direction,
    threshold,
    deadline,
    deadline_price: deadlinePrice,
    deadline_price_b: deadlinePriceB,
    consensus_result: consensus,
  });
  const won = consensus === "HELD";

  return (
    <div className="bg-surface-container-lowest border border-white/10 p-6 flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <span className="material-symbols-outlined text-primary">policy</span>
        <h4 className="font-display-md text-display-md text-on-surface uppercase text-xl">{heading}</h4>
      </div>
      <div
        className={`text-2xl md:text-3xl font-display uppercase leading-tight ${
          won ? "text-secondary-fixed" : "text-dispute-red"
        }`}
      >
        {consensus}
        {appealNote ? <span className="text-sm font-mono normal-case tracking-wide ml-2">{appealNote}</span> : null}
      </div>
      {summary ? (
        <p className="text-base md:text-lg text-on-surface leading-relaxed">{summary}</p>
      ) : (
        <p className="text-base text-on-surface-variant">Consensus recorded. Full reasoning is below.</p>
      )}
      {reasoning ? (
        <div>
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="font-mono text-[11px] uppercase tracking-widest text-on-surface-variant hover:text-secondary-fixed"
          >
            {open ? "Hide full reasoning" : "View full reasoning"}
          </button>
          {open ? (
            <p className="mt-3 font-body-md text-body-md text-on-surface-variant leading-relaxed border-t border-white/10 pt-3">
              {reasoning}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
