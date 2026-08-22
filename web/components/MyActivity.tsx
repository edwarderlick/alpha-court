"use client";

import { useEffect, useState } from "react";
import { useAppState } from "@/lib/store";
import { AddressMark } from "./AddressMark";
import { StakeRows } from "./StakeRows";
import type { StakeViewRow } from "@/lib/stakes-view";

export function MyActivity() {
  const { wallet, openWalletModal } = useAppState();
  const address = wallet.status === "connected" && wallet.address ? wallet.address : "";
  const [rows, setRows] = useState<StakeViewRow[] | null>(address ? null : []);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!address) {
      setRows([]);
      setError(null);
      return;
    }
    let cancelled = false;
    setRows(null);
    fetch(`/api/stakes/${encodeURIComponent(address)}`)
      .then((res) => res.json())
      .then((data) => {
        if (cancelled) return;
        if (data.error) {
          setError(typeof data.error === "string" ? data.error : "Failed to load stakes");
          setRows([]);
          return;
        }
        setError(null);
        setRows(Array.isArray(data.stakes) ? data.stakes : []);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
        setRows([]);
      });
    return () => {
      cancelled = true;
    };
  }, [address]);

  const decided = rows?.filter((r) => r.outcome === "won" || r.outcome === "lost") ?? [];
  const wins = decided.filter((r) => r.outcome === "won").length;
  const losses = decided.filter((r) => r.outcome === "lost").length;

  return (
    <section className="mb-10 pb-8 border-b border-white/10">
      <div className="flex items-end justify-between gap-4 mb-4">
        <div className="flex items-center gap-3 min-w-0">
          <img src="/cast/challenger.jpg" alt="" className="h-14 w-auto hidden sm:block" />
          <div>
            <h2 className="font-display text-3xl md:text-5xl text-on-surface uppercase tracking-tight leading-none">
              My Activity
            </h2>
            <p className="font-mono text-[11px] uppercase tracking-widest text-on-surface-variant mt-2">
              Your stakes on this court, from the same receipts as My Stakes
            </p>
          </div>
        </div>
        {address && rows && rows.length > 0 ? (
          <div className="text-right shrink-0">
            <div className="font-display text-2xl text-secondary-fixed leading-none">
              {wins}W {losses}L
            </div>
            <div className="font-mono text-[10px] uppercase tracking-widest text-on-surface-variant mt-1">
              Settled stakes
            </div>
          </div>
        ) : null}
      </div>

      {!address && (
        <div className="border border-white/10 bg-surface-container-lowest p-6 flex items-center gap-4">
          <div className="w-12 h-12 rounded-full bg-surface-variant border border-white/10 shrink-0" />
          <div>
            <p className="font-body-md text-on-surface-variant">
              Connect a wallet to see the stakes you placed, and whether they won or lost.
            </p>
            <button
              type="button"
              suppressHydrationWarning
              onClick={openWalletModal}
              className="pressable mt-2 font-mono text-[11px] uppercase tracking-widest text-secondary-fixed hover:underline"
            >
              Connect to sign
            </button>
          </div>
        </div>
      )}

      {address && error && (
        <p className="font-mono text-sm text-dispute-red">{error}</p>
      )}

      {address && rows === null && !error && (
        <p className="font-mono text-xs text-on-surface-variant">Loading your stakes…</p>
      )}

      {address && rows && rows.length === 0 && !error && (
        <div className="border border-white/10 bg-surface-container-lowest p-6 flex items-center gap-4">
          <AddressMark address={address} size={40} />
          <p className="font-body-md text-on-surface-variant">
            This wallet hasn&apos;t staked on any claims yet.
          </p>
        </div>
      )}

      {address && rows && rows.length > 0 && <StakeRows rows={rows} compact />}
    </section>
  );
}
