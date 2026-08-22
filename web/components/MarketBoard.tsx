"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { claimTitle, isOnChainClaimId, isPendingClaimId, stakingWindowOpen, type ClaimSummary } from "@/lib/genlayer/claim-display";
import { useMergedClaims } from "@/lib/use-merged-claims";
import { sortMarkets } from "@/lib/local-dockets";
import { caseHref, claimRowKey } from "@/lib/legacy-claim-ids";
import { ClaimStatusLive } from "./ClaimStatusLive";
import { OddsBar } from "./OddsBar";
import { AssetPairMark } from "./AssetMark";
import { CourtBanner } from "./CourtBanner";

const FILTERS = ["ALL", "OPEN", "EVIDENCE_LOCKED", "RESOLVED", "CONTESTED"] as const;
const TYPES = ["ALL", "PRICE_THRESHOLD", "RELATIVE_PERFORMANCE", "FUNDAMENTALS_THRESHOLD"] as const;

function typeLabel(type: string): string {
  if (type === "PRICE_THRESHOLD") return "Price";
  if (type === "RELATIVE_PERFORMANCE") return "Relative";
  if (type === "FUNDAMENTALS_THRESHOLD") return "Fundamentals";
  return type.replace(/_/g, " ");
}

export function MarketBoard({ claims }: { claims: ClaimSummary[] }) {
  const [remote, setRemote] = useState(claims);
  const merged = useMergedClaims(remote);

  useEffect(() => {
    let cancelled = false;
    const tick = () => {
      fetch("/api/claims", { cache: "no-store" })
        .then((res) => res.json())
        .then((data) => {
          if (cancelled || !Array.isArray(data.claims)) return;
          setRemote(data.claims);
        })
        .catch(() => {
          /* keep server snapshot */
        });
    };
    tick();
    const id = window.setInterval(tick, 8000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);
  const [stateFilter, setStateFilter] = useState<(typeof FILTERS)[number]>("ALL");
  const [typeFilter, setTypeFilter] = useState<(typeof TYPES)[number]>("ALL");
  const [query, setQuery] = useState("");

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = merged.filter((c) => {
      if (stateFilter !== "ALL" && c.state !== stateFilter) return false;
      if (typeFilter !== "ALL" && c.claim_type !== typeFilter) return false;
      if (!q) return true;
      return (
        claimTitle(c).toLowerCase().includes(q) ||
        c.asset.toLowerCase().includes(q) ||
        c.claim_id.includes(q) ||
        c.state.toLowerCase().includes(q)
      );
    });
    return sortMarkets(filtered);
  }, [merged, stateFilter, typeFilter, query]);

  const openCount = merged.filter((c) => stakingWindowOpen(c.state, c.deadline)).length;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <p className="font-mono text-[11px] uppercase tracking-widest text-on-surface-variant">
          {merged.length} dockets · {openCount} open
          {merged.length > claims.length ? " · includes claims saved on this browser" : ""}
        </p>
        <CourtBanner />
      </div>
      <div className="flex flex-col lg:flex-row gap-3 lg:items-center">
        <input
          value={query}
          suppressHydrationWarning
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search markets, assets, claim id"
          className="flex-1 bg-surface-container-lowest border border-white/10 px-4 py-3 font-mono text-sm text-on-surface focus:border-secondary-fixed focus:ring-0"
        />
        <div className="flex flex-wrap gap-2">
          {FILTERS.map((f) => (
            <button
              key={f}
              type="button"
              suppressHydrationWarning
              onClick={() => setStateFilter(f)}
              className={`px-3 py-2 font-mono text-[10px] uppercase tracking-widest border transition-colors ${
                stateFilter === f
                  ? "border-secondary-fixed text-secondary-fixed bg-secondary-fixed/10"
                  : "border-white/10 text-on-surface-variant hover:border-white/30"
              }`}
            >
              {f === "ALL" ? "All" : f.replace(/_/g, " ")}
            </button>
          ))}
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        {TYPES.map((t) => (
          <button
            key={t}
            type="button"
            suppressHydrationWarning
            onClick={() => setTypeFilter(t)}
            className={`px-3 py-1.5 font-mono text-[10px] uppercase tracking-widest ${
              typeFilter === t ? "bg-primary text-on-primary" : "bg-surface-container text-on-surface-variant"
            }`}
          >
            {t === "ALL" ? "All types" : typeLabel(t)}
          </button>
        ))}
      </div>

      {shown.length === 0 && (
        <div className="border border-white/10 bg-surface-container-lowest p-12 text-center">
          <p className="font-body-md text-on-surface-variant">
            {merged.length === 0
              ? "Studio cannot list the chain book right now. A claim you just filed still exists on-chain. File again only if MetaMask does not show Sent GEN. New claims from this browser appear here even while Studio is capped."
              : "No markets match that filter."}
          </p>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {shown.map((claim, i) => {
          const onChain = isOnChainClaimId(claim.claim_id);
          const pending = isPendingClaimId(claim.claim_id);
          const opacity = pending ? "opacity-70" : "";
          const className = `pressable form-rise group border border-white/10 bg-surface-container-lowest p-5 flex flex-col gap-4 hover:border-secondary-fixed/50 transition-colors duration-300 ${opacity}`;
          const style = { animationDelay: `${Math.min(i, 8) * 40}ms` as const };
          const body = (
            <>
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <AssetPairMark a={claim.asset} b={claim.asset_b} size={36} />
                <div className="flex flex-col gap-1 min-w-0">
                  <span className="font-mono text-[10px] uppercase tracking-widest text-on-surface-variant">
                    #{claim.claim_id} · {typeLabel(claim.claim_type)}
                  </span>
                  <h3 className="font-display-md text-xl text-on-surface leading-none group-hover:text-secondary-fixed transition-colors truncate">
                    {claimTitle(claim)}
                  </h3>
                </div>
              </div>
              {!onChain ? (
                <span className="shrink-0 font-mono text-[10px] uppercase tracking-widest px-2 py-1 border border-arbitration-orange text-arbitration-orange">
                  ID PENDING
                </span>
              ) : (
                <ClaimStatusLive
                  state={claim.state}
                  deadline={claim.deadline}
                  consensus={claim.consensus_result}
                  claimId={claim.claim_id}
                  originContract={claim.origin_contract}
                  createdAt={claim.created_at}
                  compact
                />
              )}
            </div>

            <OddsBar
              forTotal={parseFloat(claim.stake_for_total) || 0}
              againstTotal={parseFloat(claim.stake_against_total) || 0}
            />

            {claim.consensus_result && (
              <div className="font-mono text-[11px] uppercase tracking-widest text-on-surface-variant">
                Verdict {claim.consensus_result}
              </div>
            )}
            {!onChain && (
              <p className="font-mono text-[10px] text-arbitration-orange uppercase">
                Not stakable until the real claim id is known
              </p>
            )}
            </>
          );
          if (onChain) {
            return (
              <Link
                key={claimRowKey(claim)}
                href={caseHref(claim)}
                className={className}
                style={style}
              >
                {body}
              </Link>
            );
          }
          return (
            <div key={claimRowKey(claim)} className={className} style={style}>
              {body}
            </div>
          );
        })}
      </div>
    </div>
  );
}
