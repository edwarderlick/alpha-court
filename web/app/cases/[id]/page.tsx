import Link from "next/link";
import { AppShell } from "@/components/AppShell";

import { AppealPanel } from "@/components/AppealPanel";
import { LifecyclePanel } from "@/components/LifecyclePanel";
import { ClaimStatusLive } from "@/components/ClaimStatusLive";
import { LiveStakePanel } from "@/components/LiveStakePanel";
import { Countdown } from "@/components/Countdown";

import { readOneClaim } from "@/lib/genlayer/client";
import { findCachedClaim, getCachedClaims, rememberClaim } from "@/lib/genlayer/claims-cache";
import { isAnyRateLimit, isUnknownClaimMessage, rpcBlocked } from "@/lib/genlayer/rpc-guard";
import type { ClaimSummary } from "@/lib/genlayer/claim-display";
import {
  claimTitle,
  formatDeadline,
  formatMark,
  isOnChainClaimId,
} from "@/lib/genlayer/claim-display";
import { AssetPairMark } from "@/components/AssetMark";
import { VerdictCard } from "@/components/VerdictCard";
import { StakersList } from "@/components/StakersList";
import { AddressMark } from "@/components/AddressMark";
import { isLegacyClaim } from "@/lib/legacy-claim-ids";
import { CourtBanner } from "@/components/CourtBanner";

type Claim = {
  claim_id: string;
  claim_type: "PRICE_THRESHOLD" | "RELATIVE_PERFORMANCE" | "FUNDAMENTALS_THRESHOLD";
  asset: string;
  asset_b: string | null;
  metric: string | null;
  threshold: string | null;
  direction: string;
  deadline: string;
  poster: string;
  created_at: string;
  posting_price: string | null;
  deadline_price: string | null;
  posting_price_b: string | null;
  deadline_price_b: string | null;
  state: string;
  verdict_text: string;
  consensus_result: string;
  stake_for_total: string;
  stake_against_total: string;
  appeal_bond: string | null;
  contested_at: string;
  appeal_outcome: string;
  second_verdict_text: string;
  origin_contract?: string;
};

/**
 * Build Prompt 10: claim-type-adaptive evidence rendering. Price Threshold
 * and Fundamentals Threshold share a shape (single value crossing a
 * threshold -- Fundamentals just labels it with `metric` instead of a bare
 * asset); Relative Performance is genuinely different (two assets, two
 * price pairs, no threshold/direction at all) and gets its own block
 * rather than being squeezed into the same template.
 */
function PriceCell({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="min-w-0 border border-white/10 bg-surface-container-lowest p-4">
      <div className="font-mono text-[11px] uppercase tracking-wide text-on-surface-variant mb-2">{label}</div>
      <div className={`font-mono text-xl md:text-2xl leading-tight break-all ${tone ?? "text-on-surface"}`}>{value}</div>
    </div>
  );
}

function EvidenceSection({ claim }: { claim: Claim }) {
  if (claim.claim_type === "RELATIVE_PERFORMANCE") {
    return (
      <div className="w-full grid grid-cols-1 sm:grid-cols-2 gap-3">
        <PriceCell
          label={`${claim.asset} posting / deadline`}
          value={`${formatMark(claim.posting_price)} → ${formatMark(claim.deadline_price)}`}
        />
        <PriceCell
          label={`${claim.asset_b} posting / deadline`}
          value={`${formatMark(claim.posting_price_b)} → ${formatMark(claim.deadline_price_b)}`}
          tone="text-secondary-fixed"
        />
      </div>
    );
  }

  const label = claim.claim_type === "FUNDAMENTALS_THRESHOLD" ? claim.metric : "PRICE";
  return (
    <div className="w-full grid grid-cols-1 sm:grid-cols-3 gap-3">
      <PriceCell
        label={`Claimed (${label})`}
        value={`${claim.direction} ${formatMark(claim.threshold)}`}
        tone="text-dispute-red"
      />
      <PriceCell label="Posting-time" value={formatMark(claim.posting_price)} />
      <PriceCell label="Deadline-time" value={formatMark(claim.deadline_price)} tone="text-secondary-fixed" />
    </div>
  );
}

// Converted from case_detail_pro_theme/code.html, then wired to real,
// claim-type-adaptive get_claim data (Build Prompt 9 wired Price
// Threshold only; Build Prompt 10 extends this to all three shapes plus
// the appeal states).
export default async function CaseDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ legacy?: string; preview?: string; origin?: string }>;
}) {
  const { id } = await params;
  const { legacy, preview, origin: originParam } = await searchParams;
  let claim: Claim;
  const booked = await findCachedClaim(id, { preferLegacy: legacy === "1", origin: originParam });
  const previewing =
    process.env.NODE_ENV !== "production" && preview === "APPEAL_PENDING";

  function notFoundState() {
    return (
      <AppShell activeTop="Markets" activeSide="Markets">
        <div className="px-6 py-16 max-w-xl flex flex-col gap-4">
          <span className="material-symbols-outlined text-6xl text-on-surface-variant">search_off</span>
          <h1 className="font-display text-4xl uppercase">Not found</h1>
          <p className="text-on-surface-variant">
            Claim #{id} does not exist on the deployed contract.
          </p>
          <Link href="/browse-cases" className="text-secondary-fixed font-mono text-sm uppercase underline">
            Browse Dockets
          </Link>
        </div>
      </AppShell>
    );
  }

  function loadError(kind: "studio_unavailable" | "read_failed", detail?: string) {
    return (
      <AppShell activeTop="Markets" activeSide="Markets">
        <div className="px-6 py-16 max-w-xl flex flex-col gap-4">
          <h1 className="font-display text-4xl uppercase">Could not load claim #{id}</h1>
          <p className="text-on-surface-variant">
            {kind === "studio_unavailable"
              ? "Studio is rate-limiting reads right now, so this id could not be checked. It is not confirmed to exist. Retry when Studio is available."
              : "Studio did not return this claim. If you just posted it, refresh. If Studio is capped, wait a few minutes and retry."}
          </p>
          {detail && kind !== "studio_unavailable" ? (
            <p className="font-mono text-xs text-on-surface-variant break-all">{detail}</p>
          ) : null}
          <Link href={`/cases/${id}`} className="text-secondary-fixed font-mono text-sm uppercase underline">
            Retry claim #{id}
          </Link>
          <Link href="/browse-cases" className="text-on-surface-variant font-mono text-sm uppercase underline">
            Back to Markets
          </Link>
        </div>
      </AppShell>
    );
  }

  // Numeric ids try the live contract first, except dockets stamped as
  // belonging to a retired deployment — get_claim on the current court
  // fails those ids and Next's error overlay treated it as an issue.
  // Preview skips the Studio round-trip so copy can be checked when RPC hangs.
  if (previewing && booked) {
    claim = booked as unknown as Claim;
  } else if (isOnChainClaimId(id) && booked && isLegacyClaim(booked)) {
    claim = booked as unknown as Claim;
  } else if (isOnChainClaimId(id)) {
    try {
      claim = (await readOneClaim(id)) as Claim;
      await rememberClaim(claim as unknown as ClaimSummary);
    } catch (err) {
      if (booked) {
        claim = booked as unknown as Claim;
      } else {
        const detail = err instanceof Error ? err.message : String(err);
        const known = ((await getCachedClaims()) ?? []).map((c) => Number(c.claim_id)).filter((n) => Number.isFinite(n));
        const maxKnown = known.length ? Math.max(...known) : 0;
        const n = Number(id);
        const implausible = Number.isInteger(n) && n > maxKnown + 100;
        if (isUnknownClaimMessage(detail) || implausible) return notFoundState();
        if (rpcBlocked() || isAnyRateLimit(err)) return loadError("studio_unavailable");
        return loadError("read_failed", detail);
      }
    }
  } else if (booked) {
    claim = booked as unknown as Claim;
  } else {
    return notFoundState();
  }

  // Dev-only: restage a real docket as APPEAL_PENDING so the case page
  // copy can be checked when studionet has no live appeal in flight.
  if (previewing) {
    claim = {
      ...claim,
      state: "APPEAL_PENDING",
      consensus_result: "",
      appeal_outcome: "",
      second_verdict_text: "",
      appeal_bond: claim.appeal_bond && claim.appeal_bond !== "0" ? claim.appeal_bond : "1.25",
      contested_at: claim.contested_at || claim.created_at,
    };
  }

  return (
    <AppShell activeTop="Markets" activeSide="Markets">
      <div className="max-w-[1200px] mx-auto grid grid-cols-1 lg:grid-cols-12 gap-8 px-4 md:px-8 py-8 relative z-10">
        <div className="lg:col-span-8 flex flex-col gap-8">
          <section className="bg-surface-container-lowest border border-white/10 p-6 md:p-8 relative overflow-hidden">
            <div className="absolute -right-20 -top-20 text-[200px] font-display-hero text-white/5 select-none pointer-events-none">
              #{claim.claim_id}
            </div>
            <div className="flex flex-wrap items-start justify-between gap-4 mb-6 relative z-10">
              <div className="flex gap-2">
                <span className="px-3 py-1 bg-primary/20 border border-primary text-primary font-label-mono-sm text-label-mono-sm rounded-full uppercase tracking-widest">
                  {claim.claim_type.replace(/_/g, " ")}
                </span>
                <span className="px-3 py-1 bg-surface-variant border border-white/10 text-on-surface-variant font-label-mono-sm text-label-mono-sm rounded-full uppercase tracking-widest">
                  CLAIM_ID: #{claim.claim_id}
                </span>
              </div>
              <div className="flex flex-col items-end">
                <div className="font-label-mono-sm text-label-mono-sm text-on-surface-variant uppercase mb-1">DEADLINE</div>
                <div className="font-display-md text-xl md:text-3xl text-secondary-fixed">{formatDeadline(claim.deadline)}</div>
                {claim.state === "OPEN" && (
                  <div className="font-mono text-sm text-dispute-red mt-1">
                    <Countdown targetIso={claim.deadline} />
                  </div>
                )}
              </div>
            </div>
            <div className="flex items-center gap-4 mb-6 relative z-10">
              <AssetPairMark a={claim.asset} b={claim.asset_b} size={48} />
              <h1 className="font-display text-3xl md:text-5xl text-on-surface uppercase leading-tight break-words min-w-0">
                {claimTitle(claim)}
              </h1>
            </div>
            <div className="flex items-center gap-4 border-t border-white/10 pt-6 relative z-10">
              <div className="font-label-mono-bold text-label-mono-bold text-on-surface-variant">CLAIMANT:</div>
              <Link
                href={`/alpha-passport?address=${claim.poster}`}
                className="flex items-center gap-2 text-primary hover:underline break-all"
              >
                <AddressMark address={claim.poster} size={28} />
                <span className="font-label-mono-bold text-label-mono-bold">{claim.poster}</span>
              </Link>
            </div>
          </section>

          <section className="flex flex-col gap-6">
            <div className="flex items-center gap-4 mb-2">
              <span className="material-symbols-outlined text-secondary-fixed">monitoring</span>
              <h2 className="font-display-md text-display-md text-on-surface uppercase">Evidentiary Record</h2>
              <div className="ml-auto font-label-mono-sm text-label-mono-sm text-on-surface-variant uppercase flex items-center gap-2 border border-white/10 px-3 py-1 rounded bg-surface-container-lowest">
                <span className="w-2 h-2 rounded-full bg-secondary-fixed animate-pulse"></span>
                Live data via Surf
              </div>
            </div>
            <EvidenceSection claim={claim} />
            <StakersList claimId={claim.claim_id} legacy={isLegacyClaim(claim)} origin={claim.origin_contract} />
          </section>
        </div>

        <div className="lg:col-span-4 flex flex-col gap-6">
          <div className="lg:sticky lg:top-24 flex flex-col gap-6">
            <LiveStakePanel
              claimId={claim.claim_id}
              state={claim.state}
              deadline={claim.deadline}
              title={claimTitle(claim)}
              forTotal={parseFloat(claim.stake_for_total) || 0}
              againstTotal={parseFloat(claim.stake_against_total) || 0}
              snapshot={claim as unknown as ClaimSummary}
            />
            <div className="bg-surface-container border border-secondary-fixed/50 p-5">
              <div className="font-mono text-[11px] text-on-surface-variant uppercase tracking-wide mb-3">Current status</div>
              <div className="mb-3"><CourtBanner /></div>
              <ClaimStatusLive
                state={claim.state}
                deadline={claim.deadline}
                consensus={claim.consensus_result}
                claimId={claim.claim_id}
                originContract={(claim as ClaimSummary).origin_contract}
                createdAt={claim.created_at}
                live={!previewing}
              />
              {claim.consensus_result && (
                <div className="bg-surface-container-highest p-4 rounded-sm border-l-2 border-secondary-fixed mt-4">
                  <div className="font-label-mono-bold text-label-mono-bold text-on-surface mb-1">
                    CONSENSUS: {claim.consensus_result}
                    {claim.appeal_outcome === "SETTLED" && " (via appeal)"}
                  </div>
                </div>
              )}
            </div>

            {claim.consensus_result && (
              <VerdictCard
                heading={claim.appeal_outcome === "SETTLED" ? "Original Verdict (Round 1)" : "Verdict"}
                claimType={claim.claim_type}
                asset={claim.asset}
                assetB={claim.asset_b}
                metric={claim.metric}
                direction={claim.direction}
                threshold={claim.threshold}
                deadline={claim.deadline}
                deadlinePrice={claim.deadline_price}
                deadlinePriceB={claim.deadline_price_b}
                consensus={claim.consensus_result}
                appealNote={claim.appeal_outcome === "SETTLED" ? "(via appeal)" : undefined}
                reasoning={claim.verdict_text || ""}
              />
            )}

            <LifecyclePanel
              claimId={claim.claim_id}
              state={claim.state}
              deadline={claim.deadline}
              originContract={(claim as ClaimSummary).origin_contract}
              createdAt={claim.created_at}
            />

            <AppealPanel
              claimId={claim.claim_id}
              state={claim.state}
              appealBond={claim.appeal_bond}
              contestedAt={claim.contested_at}
              appealOutcome={claim.appeal_outcome}
              secondVerdictText={claim.second_verdict_text}
              live={!previewing}
            />


          </div>
        </div>
      </div>
      <div className="h-32"></div>
    </AppShell>
  );
}
