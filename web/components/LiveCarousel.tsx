"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { claimTitle, prettyState, type ClaimSummary } from "@/lib/genlayer/claim-display";
import { caseHref, claimRowKey } from "@/lib/legacy-claim-ids";
import { AssetPairMark } from "./AssetMark";

export function LiveCarousel({ claims }: { claims: ClaimSummary[] }) {
  const [index, setIndex] = useState(0);
  const n = claims.length;

  useEffect(() => {
    if (n < 2) return;
    const id = window.setInterval(() => setIndex((i) => (i + 1) % n), 3800);
    return () => window.clearInterval(id);
  }, [n]);

  if (n === 0) {
    return (
      <div className="relative max-w-7xl mx-auto h-[400px] flex justify-center items-center">
        <Link
          href="/post-a-claim"
          className="absolute z-20 w-72 h-96 bg-alpha-purple text-white shadow-2xl clip-hex flex flex-col justify-center items-center p-8 text-center glow-purple hover:scale-[1.05] transition-transform duration-300 ease-snappy"
        >
          <h4 className="font-display text-3xl uppercase leading-none mb-4">FILE THE FIRST CLAIM</h4>
          <div className="font-mono text-xs uppercase opacity-80">Open a live docket</div>
        </Link>
      </div>
    );
  }

  const at = (offset: number) => claims[(index + offset + n) % n];
  const slots = [
    { claim: at(-2), cls: "absolute left-0 w-48 h-64 bg-white rounded-xl shadow-sm opacity-40 scale-75 -translate-x-12 blur-sm" },
    { claim: at(-1), cls: "absolute left-1/4 w-56 h-72 bg-white rounded-2xl shadow-md opacity-70 -translate-x-1/2 scale-90 hover:opacity-90" },
    { claim: at(0), cls: "absolute z-20 w-72 h-96 bg-alpha-purple text-white shadow-2xl scale-110 clip-hex glow-purple hover:scale-[1.15]" },
    { claim: at(1), cls: "absolute right-1/4 w-56 h-72 bg-white rounded-2xl shadow-md opacity-70 translate-x-1/2 scale-90 hover:opacity-90" },
    { claim: at(2), cls: "absolute right-0 w-48 h-64 bg-white rounded-xl shadow-sm opacity-40 scale-75 translate-x-12 blur-sm" },
  ];

  return (
    <div className="relative max-w-7xl mx-auto h-[400px] flex justify-center items-center carousel-container">
      {slots.map((slot, i) => (
        <Link
          key={`${claimRowKey(slot.claim)}-${i}`}
          href={caseHref(slot.claim)}
          className={`${slot.cls} transition-all duration-500 ease-snappy flex flex-col justify-center items-center p-6 text-center`}
        >
          <AssetPairMark a={slot.claim.asset} b={slot.claim.asset_b} size={40} />
          <h4 className="font-display text-2xl md:text-3xl uppercase leading-none mb-3 mt-3">{claimTitle(slot.claim)}</h4>
          {i === 2 ? (
            <div className="font-mono text-xl font-bold border-t border-white/30 pt-4 w-full">
              #{slot.claim.claim_id}
              <span className="text-[10px] block font-normal opacity-70">{prettyState(slot.claim.state)}</span>
            </div>
          ) : (
            <span className="font-mono text-[10px] uppercase tracking-widest text-gray-500">#{slot.claim.claim_id}</span>
          )}
        </Link>
      ))}
    </div>
  );
}
