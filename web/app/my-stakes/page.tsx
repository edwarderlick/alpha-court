"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { AppShell } from "@/components/AppShell";
import { useAppState } from "@/lib/store";
import { StakeRows } from "@/components/StakeRows";
import type { StakeViewRow } from "@/lib/stakes-view";

function StakesBody() {
  const { wallet } = useAppState();
  const params = useSearchParams();
  const lookup = params.get("address")?.trim() || "";
  const address =
    lookup || (wallet.status === "connected" && wallet.address ? wallet.address : "");
  const [rows, setRows] = useState<StakeViewRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!address) {
      setRows(null);
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

  return (
    <AppShell activeTop="Stakes" activeSide="Stakes">
      <div className="px-4 md:px-gutter max-w-7xl mx-auto pb-32">
        <section className="py-12 border-b-2 border-outline-variant mb-12 relative">
          <div className="absolute inset-0 bg-gradient-to-r from-primary-container/10 to-transparent pointer-events-none"></div>
          <h1 className="font-display-hero text-display-hero-mobile md:text-display-hero uppercase tracking-tighter mb-4">
            MY STAKES
          </h1>
          <p className="font-body-lg text-body-lg text-on-surface-variant max-w-2xl">
            Claims this wallet staked on, with real on-chain amounts. A WON row
            says Paid only after a keeper native send actually increased this
            wallet&apos;s balance. Studio IC→EOA transfers are not treated as
            credits.
          </p>
        </section>

        {!address && (
          <div className="glass-panel rounded-2xl p-12 text-center border border-white/5">
            <p className="font-body-lg text-body-lg text-on-surface-variant">
              Connect your wallet to see the stakes you&apos;ve placed.
            </p>
          </div>
        )}

        {address && error && (
          <div className="glass-panel rounded-2xl p-12 text-center border border-dispute-red/30">
            <p className="font-body-lg text-body-lg text-dispute-red">{error}</p>
          </div>
        )}

        {address && !error && rows === null && (
          <p className="font-body-md text-body-md text-on-surface-variant">Loading stakes…</p>
        )}

        {address && rows !== null && rows.length === 0 && !error && (
          <div className="glass-panel rounded-2xl p-12 text-center border border-white/5">
            <p className="font-body-lg text-body-lg text-on-surface-variant">
              This wallet hasn&apos;t staked on any claims yet.
            </p>
          </div>
        )}

        {address && rows !== null && rows.length > 0 && <StakeRows rows={rows} />}
      </div>
    </AppShell>
  );
}

export default function MyStakesPage() {
  return (
    <Suspense fallback={null}>
      <StakesBody />
    </Suspense>
  );
}
