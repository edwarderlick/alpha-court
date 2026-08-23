"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AddressMark, shortenAddress } from "./AddressMark";
import { useLiveStakers } from "@/lib/use-live-claim";

type Staker = {
  address: string;
  side: "for" | "against";
  amount: string;
  stakedAt: number | null;
  stakedAtSource: "claim" | "observed";
  wins: number;
  losses: number;
  winRatePct: number | null;
  won: boolean;
};

function whenLabel(row: Staker): string {
  if (!row.stakedAt) return "";
  const t = new Date(row.stakedAt);
  return t.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

export function StakersList({
  claimId,
  legacy = false,
  origin,
}: {
  claimId: string;
  legacy?: boolean;
  /** Which court's claim this is, when known -- disambiguates a reused
   * claim_id once more than one retired court exists. Without it, `legacy=1`
   * alone can't say which retired court's claim to look up. */
  origin?: string | null;
}) {
  const [rows, setRows] = useState<Staker[] | null>(null);
  const [winningSide, setWinningSide] = useState<"for" | "against" | null>(null);
  const liveTick = useLiveStakers(claimId);

  useEffect(() => {
    let cancelled = false;
    const params = new URLSearchParams();
    if (legacy) params.set("legacy", "1");
    if (origin) params.set("origin", origin);
    const qs = params.toString() ? `?${params.toString()}` : "";
    fetch(`/api/claims/${encodeURIComponent(claimId)}/stakers${qs}`, { cache: "no-store" })
      .then((res) => res.json())
      .then((data) => {
        if (cancelled) return;
        setRows(Array.isArray(data.stakers) ? data.stakers : []);
        setWinningSide(data.winningSide === "for" || data.winningSide === "against" ? data.winningSide : null);
      })
      .catch(() => {
        if (!cancelled) setRows([]);
      });
    return () => {
      cancelled = true;
    };
  }, [claimId, liveTick, legacy, origin]);

  if (rows === null) {
    return (
      <section className="flex flex-col gap-3">
        <h2 className="font-display-md text-display-md text-on-surface uppercase">Stakers</h2>
        <p className="font-mono text-xs text-on-surface-variant">Loading on-chain stakes…</p>
      </section>
    );
  }

  if (rows.length === 0) {
    return (
      <section className="flex flex-col gap-3">
        <h2 className="font-display-md text-display-md text-on-surface uppercase">Stakers</h2>
        <p className="font-mono text-sm text-on-surface-variant">
          No stakers indexed yet. Poster posting-stakes and stakes placed in this app appear here.
        </p>
      </section>
    );
  }

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-end justify-between gap-3">
        <h2 className="font-display-md text-display-md text-on-surface uppercase">Stakers</h2>
        <span className="font-mono text-[11px] uppercase tracking-widest text-on-surface-variant">
          {rows.length} on this claim
        </span>
      </div>
      <div className="flex flex-col gap-2">
        {rows.map((row) => (
          <Link
            key={`${row.address}:${row.side}`}
            href={`/alpha-passport?address=${row.address}`}
            className={`flex items-center gap-3 p-3 border transition-colors ${
              row.won
                ? "border-secondary-fixed/60 bg-secondary-fixed/10"
                : "border-white/10 bg-surface-container-lowest hover:border-white/25"
            }`}
          >
            <AddressMark address={row.address} size={36} />
            <div className="min-w-0 flex-1">
              <div className="font-mono text-sm text-on-surface">{shortenAddress(row.address)}</div>
              <div className="font-mono text-[10px] uppercase tracking-widest text-on-surface-variant">
                {row.winRatePct == null ? "no settled stakes yet" : `${row.winRatePct}% win rate · ${row.wins}W ${row.losses}L`}
                {row.stakedAt ? ` · ${whenLabel(row)}` : ""}
              </div>
            </div>
            <div className="text-right shrink-0">
              <div className={`font-mono text-sm font-bold uppercase ${row.side === "for" ? "text-secondary-fixed" : "text-dispute-red"}`}>
                {row.side} {row.amount}
              </div>
              {row.won ? (
                <div className="font-mono text-[10px] uppercase tracking-widest text-secondary-fixed">won</div>
              ) : winningSide ? (
                <div className="font-mono text-[10px] uppercase tracking-widest text-on-surface-variant">lost</div>
              ) : null}
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}
