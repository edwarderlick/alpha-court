"use client";

import Link from "next/link";
import { claimTitle, type ClaimSummary } from "@/lib/genlayer/claim-display";

export function LandingTape({ claims }: { claims: ClaimSummary[] }) {
  const row = claims.length > 0 ? claims : null;
  const text = row
    ? row.map((c) => `#${c.claim_id}  ${claimTitle(c)}  ${c.state.replace(/_/g, " ")}`).join("    ·    ")
    : "ALPHA COURT    ·    FILE A CLAIM    ·    STAKE FOR OR AGAINST    ·    VERDICT ON CHAIN    ·    ";

  return (
    <div className="landing-tape">
      <div className="landing-tape-track">
        <span>{text}    ·    {text}</span>
        <span>{text}    ·    {text}</span>
      </div>
      {row && row[0] ? (
        <Link href={`/cases/${row[0].claim_id}`} className="sr-only">
          Latest claim
        </Link>
      ) : null}
    </div>
  );
}
