"use client";

import { useEffect, useState } from "react";
import { useAppState } from "@/lib/store";

type Standing = { wins: number; losses: number; pending: number; winRatePct: number | null };

export function StandingChip() {
  const { wallet } = useAppState();
  const address = wallet.status === "connected" ? wallet.address : null;
  const [standing, setStanding] = useState<Standing | null>(null);

  useEffect(() => {
    if (!address) {
      setStanding(null);
      return;
    }
    let cancelled = false;
    fetch(`/api/standing/${encodeURIComponent(address)}`)
      .then((res) => res.json())
      .then((data) => {
        if (cancelled) return;
        if (typeof data.wins === "number") setStanding(data);
      })
      .catch(() => {
        if (!cancelled) setStanding(null);
      });
    return () => {
      cancelled = true;
    };
  }, [address]);

  if (!standing || standing.wins + standing.losses + standing.pending === 0) return null;

  const label =
    standing.winRatePct == null
      ? `${standing.pending} open`
      : `${standing.wins}W ${standing.losses}L`;

  return (
    <div className="font-mono text-[10px] uppercase tracking-widest text-secondary-fixed mt-0.5">
      {label}
      {standing.pending > 0 && standing.winRatePct != null ? ` · ${standing.pending} open` : ""}
    </div>
  );
}
