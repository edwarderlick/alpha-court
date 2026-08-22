"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { useAppState } from "@/lib/store";
import { AssetPairMark } from "@/components/AssetMark";
import { listLocalDockets, listenLocalDockets, mergeDockets } from "@/lib/local-dockets";
import type { ClaimSummary } from "@/lib/genlayer/claim-display";
import { caseHref, claimRowKey, isLegacyClaim } from "@/lib/legacy-claim-ids";

type Claim = {
  claim_id: string;
  claim_type: string;
  asset: string;
  asset_b: string | null;
  metric: string | null;
  direction: string;
  threshold: string;
  state: string;
  consensus_result: string;
  stake_for_total: string;
  stake_against_total: string;
  poster: string;
  origin_contract?: string;
  created_at?: string;
};

function claimTitle(claim: Claim): string {
  if (claim.claim_type === "RELATIVE_PERFORMANCE") return `${claim.asset} vs ${claim.asset_b}`;
  if (claim.claim_type === "FUNDAMENTALS_THRESHOLD") {
    return `${claim.metric} (${claim.asset}) ${claim.direction} ${claim.threshold}`;
  }
  return `${claim.asset} ${claim.direction} ${claim.threshold}`;
}

/**
 * Pre-launch audit finding, area 3 (data scoping): this page was 100%
 * static mock before this -- three hardcoded fake claim cards shown
 * identically to every visitor regardless of which wallet (if any) was
 * connected. A page titled "MY CLAIMS" showing the same content to
 * everyone isn't just stale copy (the class of bug Build Prompts 9/10
 * already found elsewhere) -- it fails the page's own stated purpose,
 * the same shape of gap as Provider Court's unfiltered buyer dashboard.
 *
 * First real fix attempt used get_passport(address).claim_history --
 * looked right (it's real, per-address, contract-exposed data) but
 * verified wrong: claim_history is only ever appended by
 * _record_passport, which the contract calls exclusively from
 * resolve_verdict's RESOLVED branch, resolve_appeal, and expire_appeal --
 * never from create_claim. A wallet's still-OPEN claims (the most common
 * real case) would never appear, silently telling an active claimant they
 * had posted nothing. Caught by testing against the real Build Prompt 11
 * test wallet, which has a real OPEN claim (#5) that this approach
 * couldn't show. Fixed by filtering the full real claim list
 * (GET /api/claims, already used by browse-cases/activity) by
 * `poster === connected address` instead -- covers every state, not just
 * terminal ones.
 */
export default function MyClaimsPage() {
  const { wallet } = useAppState();
  const [claims, setClaims] = useState<Claim[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (wallet.status !== "connected" || !wallet.address) return;
    let cancelled = false;
    const address = wallet.address.toLowerCase();
    fetch("/api/claims")
      .then((res) => res.json())
      .then((data) => {
        if (cancelled) return;
        if (data.error) {
          setError(typeof data.error === "string" ? data.error : "Failed to load claims");
          setClaims([]);
          return;
        }
        const remote: Claim[] = (data.claims ?? []).filter(
          (c: Claim) => (c.poster || "").toLowerCase() === address
        );
        const local = listLocalDockets().filter((c) => (c.poster || "").toLowerCase() === address || !c.poster);
        setClaims(mergeDockets(remote as ClaimSummary[], local) as Claim[]);
      })
      .catch((err) => {
        if (cancelled) return;
        const local = listLocalDockets().filter((c) => (c.poster || "").toLowerCase() === address || !c.poster);
        setClaims(local as Claim[]);
        setError(err instanceof Error ? err.message : String(err));
      });
    const off = listenLocalDockets(() => {
      const local = listLocalDockets().filter((c) => (c.poster || "").toLowerCase() === address || !c.poster);
      setClaims((prev) => mergeDockets((prev ?? []) as ClaimSummary[], local) as Claim[]);
    });
    return () => {
      cancelled = true;
      off();
      setClaims(null);
      setError(null);
    };
  }, [wallet.status, wallet.address]);

  return (
    <AppShell activeTop="My Claims" activeSide="Claims">
      <div className="px-4 md:px-gutter max-w-7xl mx-auto pb-32">
        <section className="py-12 border-b-2 border-outline-variant mb-12 relative">
          <div className="absolute inset-0 bg-gradient-to-r from-primary-container/10 to-transparent pointer-events-none"></div>
          <h1 className="font-display-hero text-display-hero-mobile md:text-display-hero uppercase tracking-tighter mb-4">MY CLAIMS</h1>
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex items-center gap-2 bg-surface-container-high px-4 py-2 rounded-full border border-secondary-fixed glow-border-active">
              <span className="w-2 h-2 rounded-full bg-secondary-fixed animate-pulse"></span>
              <span className="font-label-mono-sm text-label-mono-sm text-secondary-fixed uppercase">Live Data via Surf</span>
            </div>
            <p className="font-body-lg text-body-lg text-on-surface-variant max-w-2xl">
              Claims posted by your connected wallet, read directly from the deployed contract.
            </p>
          </div>
        </section>

        {wallet.status !== "connected" && (
          <div className="glass-panel rounded-2xl p-12 text-center border border-white/5">
            <p className="font-body-lg text-body-lg text-on-surface-variant">
              Connect your wallet to see the claims you&apos;ve posted.
            </p>
          </div>
        )}

        {wallet.status === "connected" && error && (
          <div className="glass-panel rounded-2xl p-12 text-center border border-dispute-red/30">
            <p className="font-body-lg text-body-lg text-dispute-red">{error}</p>
          </div>
        )}

        {wallet.status === "connected" && !error && claims === null && (
          <p className="font-body-md text-body-md text-on-surface-variant">Loading...</p>
        )}

        {wallet.status === "connected" && claims !== null && claims.length === 0 && (
          <div className="glass-panel rounded-2xl p-12 text-center border border-white/5">
            <p className="font-body-lg text-body-lg text-on-surface-variant mb-4">
              This wallet hasn&apos;t posted any claims yet.
            </p>
            <Link
              href="/post-a-claim"
              className="inline-block bg-primary text-on-primary font-label-mono-bold text-label-mono-bold px-6 py-3 rounded-full uppercase"
            >
              Post a Claim
            </Link>
          </div>
        )}

        {wallet.status === "connected" && claims !== null && claims.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 auto-rows-min">
            {claims.map((claim) => (
              <Link
                key={claimRowKey(claim)}
                href={caseHref(claim)}
                className="cyber-card rounded-xl p-6 flex flex-col justify-between min-h-[200px] hover:border-primary-container transition-colors"
              >
                <div className="flex justify-between items-start mb-4">
                  <span className="inline-block bg-primary-container/20 text-primary border border-primary-container/50 px-3 py-1 rounded-full font-label-mono-sm text-label-mono-sm uppercase tracking-widest">
                    {isLegacyClaim(claim) ? "legacy" : claim.state}
                  </span>
                </div>
                <div className="flex items-center gap-3 mb-2">
                  <AssetPairMark a={claim.asset} b={claim.asset_b} size={32} />
                  <h3 className="font-display-md text-display-md text-xl mb-0">CLAIM #{claim.claim_id}</h3>
                </div>
                <p className="font-label-mono-sm text-label-mono-sm text-on-surface-variant mb-4">
                  {claimTitle(claim)}
                </p>
                <div className="mt-auto flex justify-between font-label-mono-sm text-label-mono-sm">
                  <span className="text-secondary-fixed">F: {claim.stake_for_total} GEN</span>
                  <span className="text-dispute-red">A: {claim.stake_against_total} GEN</span>
                </div>
                {claim.consensus_result && (
                  <div className="mt-2 font-label-mono-sm text-label-mono-sm text-on-surface-variant">
                    Verdict: {claim.consensus_result}
                  </div>
                )}
              </Link>
            ))}
          </div>
        )}
      </div>
    </AppShell>
  );
}
