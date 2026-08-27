"use client";

import { useState } from "react";
import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { useAppState } from "@/lib/store";
import { createClaim } from "@/lib/genlayer/actions";
import { PendingTransferError, UnconfirmedSubmissionError } from "@/lib/genlayer/errors";
import { TREASURY_ADDRESS } from "@/lib/genlayer/treasury";
import {
  isOnChainClaimId,
  MIN_DEADLINE_MS,
  toDatetimeLocalValue,
  type ClaimSummary,
} from "@/lib/genlayer/claim-display";
import { saveLocalDocket } from "@/lib/local-dockets";
import { writeErrorMessage } from "@/lib/use-merged-claims";
import { emitPulse, hrefForKind, tabForKind } from "@/lib/market-pulse";
import { AssetPicker } from "@/components/AssetPicker";
import { CheckMark } from "@/components/CheckMark";
import { FUNDAMENTALS_PROTOCOLS } from "@/lib/markets/catalog";
import { AssetMark, AssetPairMark } from "@/components/AssetMark";

type ClaimTypeKey = "PRICE_THRESHOLD" | "RELATIVE_PERFORMANCE" | "FUNDAMENTALS_THRESHOLD";

const CLAIM_TYPES: {
  key: ClaimTypeKey;
  icon: string;
  title: string;
  description: string;
  example: string;
  logos: string[];
}[] = [
  {
    key: "PRICE_THRESHOLD",
    icon: "trending_up",
    title: "PRICE THRESHOLD",
    description: "One coin vs a dollar price. Example: ETH above 3000 by Friday.",
    example: "ETH / BTC / SOL vs USD",
    logos: ["ETH/USD", "BTC/USD", "SOL/USD"],
  },
  {
    key: "RELATIVE_PERFORMANCE",
    icon: "compare_arrows",
    title: "RELATIVE PERFORMANCE",
    description: "Coin A beats coin B by the deadline. Example: SOL outperforms ETH.",
    example: "SOL vs ETH",
    logos: ["SOL/USD", "ETH/USD"],
  },
  {
    key: "FUNDAMENTALS_THRESHOLD",
    icon: "account_balance",
    title: "FUNDAMENTALS THRESHOLD",
    description: "A protocol metric crosses a target. TVL, MVRV, NUPL, or SOPR.",
    example: "Uniswap TVL or BTC MVRV",
    logos: ["UNI/USD", "AAVE/USD", "BTC/USD"],
  },
];

const FUNDAMENTALS_METRICS = ["TVL", "MVRV", "NUPL", "SOPR"];
const ONCHAIN_METRICS = ["MVRV", "NUPL", "SOPR"];
const STAKE_CHIPS = [
  { label: "Skip", value: "0" },
  { label: "1 GEN", value: "1" },
  { label: "5 GEN", value: "5" },
  { label: "10 GEN", value: "10" },
];

const inputClass =
  "w-full bg-surface-container border border-white/10 px-4 py-4 text-on-surface font-mono text-base focus:border-secondary-fixed focus:ring-0 disabled:opacity-60";

function StepBlock({
  n,
  title,
  hint,
  delay,
  wide,
  children,
}: {
  n: string;
  title: string;
  hint: string;
  delay?: string;
  wide?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section className={`form-rise ${delay ?? ""} ${wide ? "lg:col-span-2" : ""} flex flex-col gap-3 border border-white/10 bg-surface-container-low/40 p-4 overflow-visible`}>
      <div>
        <div className="font-mono text-xs uppercase tracking-wider text-secondary-fixed mb-1">
          {n}
        </div>
        <h3 className="font-display text-xl md:text-2xl uppercase text-on-surface leading-none">{title}</h3>
        <p className="mt-2 text-sm text-on-surface-variant max-w-xl">{hint}</p>
      </div>
      {children}
    </section>
  );
}

function StepOne({ onContinue }: { onContinue: (type: ClaimTypeKey) => void }) {
  return (
    <AppShell activeTop="Markets" activeSide="Markets">
      <div className="px-5 md:px-10 py-10 flex flex-col">
        <div className="w-full max-w-5xl mx-auto mb-10">
          <div className="flex justify-between items-end mb-3">
            <span className="font-mono text-sm font-bold text-secondary-fixed uppercase tracking-wide">Step 1 of 2</span>
            <span className="font-mono text-sm text-on-surface-variant">Pick how the claim is judged</span>
          </div>
          <div className="h-2 w-full bg-surface-container-highest overflow-hidden">
            <div className="h-full bg-secondary-fixed w-1/2" />
          </div>
        </div>
        <div className="w-full max-w-5xl mx-auto">
          <h2 className="font-display text-4xl md:text-6xl mb-8 tracking-tight uppercase">What are you claiming?</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {CLAIM_TYPES.map((type, i) => (
              <button
                key={type.key}
                onClick={() => onContinue(type.key)}
                className={`form-rise form-rise-${i + 2} bg-surface-container-low border border-white/10 p-6 text-left transition-all duration-200 group h-full flex flex-col hover:border-secondary-fixed hover:bg-surface-container active:scale-[0.99]`}
              >
                <div className="flex items-center gap-2 mb-5">
                  {type.logos.map((sym) => (
                    <AssetMark key={sym} symbol={sym} size={36} />
                  ))}
                </div>
                <h3 className="font-display text-2xl md:text-3xl mb-3 text-on-surface group-hover:text-secondary-fixed transition-colors leading-none">
                  {type.title}
                </h3>
                <p className="text-sm md:text-base text-on-surface-variant">{type.description}</p>
                <p className="mt-4 font-mono text-[11px] uppercase tracking-wide text-secondary-fixed">{type.example}</p>
              </button>
            ))}
          </div>
        </div>
      </div>
    </AppShell>
  );
}

function StepTwo({ claimType, onBack }: { claimType: ClaimTypeKey; onBack: () => void }) {
  const { wallet } = useAppState();
  const [asset, setAsset] = useState("ETH/USD");
  const [assetA, setAssetA] = useState("ETH/USD");
  const [assetB, setAssetB] = useState("BTC/USD");
  const [thresholdPrice, setThresholdPrice] = useState("3000");
  const [metric, setMetric] = useState("TVL");
  const [metricAsset, setMetricAsset] = useState("uniswap");
  const [direction, setDirection] = useState<"above" | "below">("above");
  const [deadline, setDeadline] = useState(() => toDatetimeLocalValue(new Date(Date.now() + 10 * 60 * 1000)));
  const [deadlinePreset, setDeadlinePreset] = useState<"5 min" | "10 min" | "1 hour" | "1 day" | "custom">("10 min");
  const [postingStake, setPostingStake] = useState("0");
  const [status, setStatus] = useState<
    | { kind: "idle" }
    | { kind: "pending" }
    | { kind: "done"; txHash: string; claimId?: string }
    | { kind: "error"; message: string }
    | { kind: "unconfirmed"; txHash: string }
    | { kind: "waiting_transfer"; txHash: string }
  >({ kind: "idle" });

  const isOnchainMetric = ONCHAIN_METRICS.includes(metric);
  const locked = status.kind === "pending" || status.kind === "unconfirmed" || status.kind === "done";

  function setDeadlineIn(ms: number, label: typeof deadlinePreset) {
    setDeadlinePreset(label);
    setDeadline(toDatetimeLocalValue(new Date(Date.now() + ms)));
  }

  function preview(): string {
    const when = new Date(deadline);
    const whenLabel = Number.isNaN(when.getTime())
      ? "the deadline"
      : when.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
    if (claimType === "RELATIVE_PERFORMANCE") {
      return `${assetA.split("/")[0]} will outperform ${assetB.split("/")[0]} by ${whenLabel}.`;
    }
    if (claimType === "FUNDAMENTALS_THRESHOLD") {
      const subject = isOnchainMetric ? `BTC ${metric}` : `${metricAsset} ${metric}`;
      return `${subject} will be ${direction} ${thresholdPrice} by ${whenLabel}.`;
    }
    return `${asset.split("/")[0]} will be ${direction} ${thresholdPrice} by ${whenLabel}.`;
  }

  async function submit() {
    let deadlineDate = new Date(deadline);
    if (Number.isNaN(deadlineDate.getTime())) {
      setStatus({ kind: "error", message: "Deadline is not a valid date" });
      return;
    }
    const presetMs: Record<string, number> = {
      "5 min": 5 * 60 * 1000,
      "10 min": 10 * 60 * 1000,
      "1 hour": 60 * 60 * 1000,
      "1 day": 24 * 60 * 60 * 1000,
    };
    if (deadlinePreset !== "custom" && presetMs[deadlinePreset]) {
      deadlineDate = new Date(Date.now() + presetMs[deadlinePreset]);
      setDeadline(toDatetimeLocalValue(deadlineDate));
    }
    if (deadlineDate.getTime() < Date.now() + MIN_DEADLINE_MS - 1000) {
      setStatus({
        kind: "error",
        message:
          "Deadline must be at least 5 minutes from now. Creating the claim takes a bit, and the keeper only checks once a minute.",
      });
      return;
    }
    const postingStakeGen = parseFloat(postingStake) || 0;
    if (postingStakeGen !== 0 && (postingStakeGen < 1 || postingStakeGen > 10)) {
      setStatus({ kind: "error", message: "Posting stake must be 0 or between 1 and 10 GEN" });
      return;
    }
    if (claimType === "RELATIVE_PERFORMANCE" && assetA.trim() === assetB.trim()) {
      setStatus({ kind: "error", message: "Asset A and Asset B must be different" });
      return;
    }
    if (claimType !== "RELATIVE_PERFORMANCE") {
      const thresholdNum = parseFloat(thresholdPrice);
      if (!Number.isFinite(thresholdNum)) {
        setStatus({ kind: "error", message: "Threshold must be a number" });
        return;
      }
    }

    const existing = status.kind === "waiting_transfer" ? status.txHash : undefined;
    setStatus({ kind: "pending" });
    const deadlineIso = deadlineDate.toISOString();
    const draft = (claimId: string): ClaimSummary => ({
      claim_id: claimId,
      claim_type: claimType,
      asset: claimType === "RELATIVE_PERFORMANCE" ? assetA : claimType === "FUNDAMENTALS_THRESHOLD" ? (isOnchainMetric ? "BTC" : metricAsset) : asset,
      asset_b: claimType === "RELATIVE_PERFORMANCE" ? assetB : null,
      metric: claimType === "FUNDAMENTALS_THRESHOLD" ? metric : null,
      direction: claimType === "RELATIVE_PERFORMANCE" ? "" : direction,
      threshold: claimType === "RELATIVE_PERFORMANCE" ? "" : thresholdPrice,
      state: "OPEN",
      consensus_result: "",
      verdict_text: "",
      stake_for_total: postingStakeGen > 0 ? String(postingStakeGen) : "0",
      stake_against_total: "0",
      deadline: deadlineIso,
      created_at: new Date().toISOString(),
      poster: wallet.address ?? "",
    });
    try {
      const result =
        claimType === "RELATIVE_PERFORMANCE"
          ? await createClaim(wallet, { claimType, assetA, assetB, deadline: deadlineIso, postingStakeGen }, existing)
          : claimType === "FUNDAMENTALS_THRESHOLD"
            ? await createClaim(wallet, {
                claimType,
                asset: isOnchainMetric ? "BTC" : metricAsset,
                metric,
                thresholdValue: thresholdPrice,
                direction,
                deadline: deadlineIso,
                postingStakeGen,
              }, existing)
            : await createClaim(wallet, {
                claimType,
                asset,
                thresholdPrice,
                direction,
                deadline: deadlineIso,
                postingStakeGen,
              }, existing);
      let claimId = typeof result.claimId === "string" ? result.claimId : "";
      if (!isOnChainClaimId(claimId)) {
        try {
          const resolved = await fetch("/api/claims/resolve-new", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ poster: wallet.address || "" }),
          });
          const data = await resolved.json();
          if (isOnChainClaimId(data?.claim?.claim_id)) {
            claimId = data.claim.claim_id as string;
            saveLocalDocket(data.claim as ClaimSummary);
          }
        } catch {
          /* never invent a pending-* id */
        }
      }
      if (isOnChainClaimId(claimId)) {
        saveLocalDocket(draft(claimId));
        if (postingStakeGen > 0 && wallet.address) {
          void fetch("/api/stakes/remember", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              address: wallet.address,
              claimId,
              side: "for",
              amountGen: postingStakeGen,
            }),
          });
        }
      }
      setStatus({ kind: "done", txHash: result.txHash, claimId: claimId || result.txHash });
      emitPulse({
        kind: "created",
        claimId: claimId || "",
        title: preview(),
        href: hrefForKind("created", claimId),
        tab: tabForKind("created"),
      });
    } catch (err) {
      if (err instanceof PendingTransferError) {
        setStatus({ kind: "waiting_transfer", txHash: err.txHash });
        return;
      }
      if (err instanceof UnconfirmedSubmissionError) {
        setStatus({ kind: "unconfirmed", txHash: err.txHash });
        return;
      }
      setStatus({ kind: "error", message: writeErrorMessage(err) });
    }
  }

  return (
    <AppShell activeTop="Markets" activeSide="Markets">
      <div className="px-5 md:px-8 py-5 w-full">
        <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4 mb-5">
          <div className="min-w-0">
            <div className="flex items-center gap-4 mb-2">
              <span className="font-mono text-sm font-bold text-secondary-fixed uppercase tracking-wide">Step 2 of 2</span>
              <button type="button" onClick={onBack} className="font-mono text-sm text-on-surface-variant hover:text-on-surface">
                Change type
              </button>
            </div>
            <h1 className="font-display text-4xl md:text-5xl uppercase tracking-tight leading-none">Fill the claim</h1>
          </div>
          <div className="flex-1 h-2 bg-surface-container-highest overflow-hidden max-w-md">
            <div className="h-full bg-secondary-fixed w-full" />
          </div>
        </div>

        <div className="form-rise mb-4 border border-secondary-fixed/30 bg-secondary-fixed/5 px-5 py-3 flex items-center gap-4">
          {claimType === "RELATIVE_PERFORMANCE" ? (
            <AssetPairMark a={assetA} b={assetB} size={40} />
          ) : claimType === "FUNDAMENTALS_THRESHOLD" ? (
            <AssetMark symbol={isOnchainMetric ? "BTC/USD" : metricAsset} size={40} />
          ) : (
            <AssetMark symbol={asset} size={40} />
          )}
          <div className="min-w-0">
            <div className="font-mono text-xs uppercase tracking-wider text-secondary-fixed">You are claiming</div>
            <p className="font-display text-xl md:text-2xl uppercase leading-tight text-on-surface">{preview()}</p>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {claimType === "PRICE_THRESHOLD" && (
            <StepBlock n="01" title="The pair" hint="Tap a ticker. Check this mark is optional and costs one Surf credit.">
              <AssetPicker label="Market pair" value={asset} onChange={setAsset} disabled={locked} />
              <CheckMark asset={asset} onValue={(n) => setThresholdPrice(String(n))} />
            </StepBlock>
          )}

          {claimType === "RELATIVE_PERFORMANCE" && (
            <StepBlock n="01" title="The two assets" hint="A must beat B. Checking a mark is optional." wide>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="flex flex-col gap-2">
                  <AssetPicker label="Asset A (wins)" value={assetA} onChange={setAssetA} disabled={locked} exclude={assetB} />
                  <CheckMark asset={assetA} />
                </div>
                <div className="flex flex-col gap-2">
                  <AssetPicker label="Asset B (loses)" value={assetB} onChange={setAssetB} disabled={locked} exclude={assetA} />
                  <CheckMark asset={assetB} />
                </div>
              </div>
            </StepBlock>
          )}

          {claimType === "FUNDAMENTALS_THRESHOLD" && (
            <StepBlock n="01" title="The metric" hint="MVRV, NUPL and SOPR are BTC only. TVL takes a protocol.">
              <div className="grid grid-cols-2 gap-3">
                <label className="flex flex-col gap-2">
                  <span className="font-mono text-xs uppercase tracking-wider text-on-surface-variant">Metric</span>
                  <select value={metric} disabled={locked} onChange={(e) => setMetric(e.target.value)} className={inputClass}>
                    {FUNDAMENTALS_METRICS.map((m) => (
                      <option key={m} value={m}>{m}</option>
                    ))}
                  </select>
                </label>
                <label className="flex flex-col gap-2">
                  <span className="font-mono text-xs uppercase tracking-wider text-on-surface-variant">
                    {isOnchainMetric ? "Asset (BTC)" : "Protocol"}
                  </span>
                  {isOnchainMetric ? (
                    <div className="flex items-center gap-3 px-4 py-3 bg-surface-container border border-white/10">
                      <AssetMark symbol="BTC/USD" size={28} />
                      <span className="font-mono text-base">BTC</span>
                    </div>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {FUNDAMENTALS_PROTOCOLS.map((p) => (
                        <button
                          key={p.id}
                          type="button"
                          disabled={locked}
                          onClick={() => setMetricAsset(p.id)}
                          className={`inline-flex items-center gap-2 px-3 py-2 font-mono text-sm font-bold uppercase ${
                            metricAsset === p.id
                              ? "bg-secondary-fixed text-on-secondary-fixed"
                              : "bg-surface-container text-on-surface-variant border border-white/10"
                          }`}
                        >
                          <AssetMark symbol={p.id} size={22} />
                          {p.name}
                        </button>
                      ))}
                    </div>
                  )}
                </label>
              </div>
              <CheckMark
                asset={isOnchainMetric ? "BTC" : metricAsset}
                metric={metric}
                onValue={(n) => setThresholdPrice(String(n))}
              />
            </StepBlock>
          )}

          {claimType !== "RELATIVE_PERFORMANCE" && (
            <StepBlock n="02" title="The target" hint="What must be true at the deadline for this claim to hold." delay="form-rise-2">
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={locked}
                  onClick={() => setDirection("above")}
                  className={`flex-1 py-3 font-mono text-sm font-bold uppercase tracking-wide transition-all duration-200 active:scale-[0.98] ${
                    direction === "above" ? "bg-secondary-fixed text-on-secondary-fixed" : "bg-surface-container text-on-surface-variant border border-white/10"
                  }`}
                >
                  Above
                </button>
                <button
                  type="button"
                  disabled={locked}
                  onClick={() => setDirection("below")}
                  className={`flex-1 py-3 font-mono text-sm font-bold uppercase tracking-wide transition-all duration-200 active:scale-[0.98] ${
                    direction === "below" ? "bg-dispute-red text-white" : "bg-surface-container text-on-surface-variant border border-white/10"
                  }`}
                >
                  Below
                </button>
              </div>
              <label className="flex flex-col gap-2">
                <span className="font-mono text-xs uppercase tracking-wider text-on-surface-variant">
                  {claimType === "FUNDAMENTALS_THRESHOLD" ? "Threshold value" : "Threshold price"}
                </span>
                <input value={thresholdPrice} disabled={locked} onChange={(e) => setThresholdPrice(e.target.value)} className={inputClass} />
              </label>
            </StepBlock>
          )}

          <StepBlock n={claimType === "RELATIVE_PERFORMANCE" ? "02" : "03"} title="When it settles" hint="Open for staking until this time. Five minutes is the floor — the keeper checks once a minute." delay="form-rise-3">
            <div className="flex flex-wrap gap-2">
              {(
                [
                  { label: "5 min" as const, ms: 5 * 60 * 1000 },
                  { label: "10 min" as const, ms: 10 * 60 * 1000 },
                  { label: "1 hour" as const, ms: 60 * 60 * 1000 },
                  { label: "1 day" as const, ms: 24 * 60 * 60 * 1000 },
                ] as const
              ).map((p) => (
                <button
                  key={p.label}
                  type="button"
                  disabled={locked}
                  onClick={() => setDeadlineIn(p.ms, p.label)}
                  className={`px-4 py-2 font-mono text-sm font-bold uppercase tracking-wide transition-colors disabled:opacity-50 ${
                    deadlinePreset === p.label
                      ? "bg-secondary-fixed text-on-secondary-fixed"
                      : "border border-white/10 text-on-surface-variant hover:border-secondary-fixed hover:text-secondary-fixed"
                  }`}
                >
                  {p.label}
                </button>
              ))}
              <button
                type="button"
                disabled={locked}
                onClick={() => {
                  setDeadlinePreset("custom");
                  const el = document.getElementById("claim-deadline");
                  if (el instanceof HTMLInputElement) el.showPicker?.() ?? el.focus();
                }}
                className={`px-4 py-2 font-mono text-sm font-bold uppercase tracking-wide transition-colors disabled:opacity-50 ${
                  deadlinePreset === "custom"
                    ? "bg-secondary-fixed text-on-secondary-fixed"
                    : "border border-white/10 text-on-surface-variant hover:border-secondary-fixed hover:text-secondary-fixed"
                }`}
              >
                Custom
              </button>
            </div>
            <label className="flex flex-col gap-2">
              <span className="font-mono text-xs uppercase tracking-wider text-on-surface-variant">
                {deadlinePreset === "custom" ? "Pick any time at least 5 minutes from now" : "Deadline"}
              </span>
              <input
                id="claim-deadline"
                type="datetime-local"
                value={deadline}
                disabled={locked}
                onChange={(e) => {
                  setDeadlinePreset("custom");
                  setDeadline(e.target.value);
                }}
                className={inputClass}
              />
            </label>
          </StepBlock>

          <StepBlock n={claimType === "RELATIVE_PERFORMANCE" ? "03" : "04"} title="Your stake" hint="Optional. Skip is fine. A stake backs FOR (1-10 GEN) sent to the court — verified by hash, paid out by the contract." delay="form-rise-4">
            {parseFloat(postingStake) > 0 && (
              <p className="font-mono text-[11px] text-on-surface-variant break-all mb-2">
                Treasury {TREASURY_ADDRESS}
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              {STAKE_CHIPS.map((chip) => (
                <button
                  key={chip.value}
                  type="button"
                  disabled={locked}
                  onClick={() => setPostingStake(chip.value)}
                  className={`px-5 py-3 font-mono text-sm font-bold uppercase tracking-wide transition-all duration-200 active:scale-[0.98] ${
                    postingStake === chip.value
                      ? "bg-secondary-fixed text-on-secondary-fixed"
                      : "bg-surface-container text-on-surface-variant border border-white/10"
                  }`}
                >
                  {chip.label}
                </button>
              ))}
            </div>
          </StepBlock>
        </div>

        <div className="mt-5 flex flex-col sm:flex-row justify-between items-stretch sm:items-center gap-3">
          <button
            onClick={onBack}
            className="px-6 py-4 border border-white/20 text-on-surface font-mono text-sm font-bold uppercase tracking-wide hover:bg-surface-container-high transition-colors flex items-center justify-center gap-2"
          >
            <span className="material-symbols-outlined text-base">arrow_back</span>
            Back
          </button>
          <button
            onClick={submit}
            disabled={status.kind === "pending" || status.kind === "unconfirmed" || status.kind === "done"}
            className="px-8 py-4 bg-secondary-fixed text-on-secondary-fixed font-mono text-sm font-bold uppercase tracking-wide hover:opacity-90 active:scale-[0.98] transition-all disabled:opacity-50"
          >
            {status.kind === "pending"
              ? wallet.status === "connected"
                ? "Confirm transfer, then register..."
                : "Submitting to Studio..."
              : status.kind === "waiting_transfer"
                ? "Register transfer"
              : status.kind === "done"
                ? "Claim created"
                : "Submit claim"}
          </button>
        </div>
        {status.kind === "pending" && (
          <p className="mt-3 font-mono text-xs text-on-surface-variant">
            Studio confirmation can take a couple of minutes. Stay on this page.
          </p>
        )}

        {status.kind === "done" && (
          <div className="mt-6 bg-secondary-fixed/10 border border-secondary-fixed/40 p-5 font-mono text-sm text-secondary-fixed break-all form-rise">
            Claim created. Tx: {status.txHash}
            <div className="mt-3 flex flex-col gap-2">
              {status.claimId && isOnChainClaimId(status.claimId) && (
                <Link href={`/cases/${status.claimId}`} className="underline">
                  Open claim #{status.claimId}
                </Link>
              )}
              <Link href="/browse-cases" className="underline">
                View on Markets
              </Link>
              <span className="text-on-surface-variant text-xs">
                Studio can take a moment. This is not stuck.
              </span>
            </div>
          </div>
        )}
        {status.kind === "error" && (
          <div className="mt-6 bg-dispute-red/10 border border-dispute-red/40 p-5 font-mono text-sm text-dispute-red break-all">
            {status.message}
          </div>
        )}
        {status.kind === "waiting_transfer" && (
          <div className="mt-6 bg-arbitration-orange/10 border border-arbitration-orange/40 p-5 font-mono text-sm text-arbitration-orange break-all">
            Stake transfer submitted (tx {status.txHash}) but Studio has not finalized it yet.
            Visibility lag — do not send GEN again. Use Register transfer once it appears.
          </div>
        )}
        {status.kind === "unconfirmed" && (
          <div className="mt-6 bg-arbitration-orange/10 border border-arbitration-orange/40 p-5 font-mono text-sm text-arbitration-orange break-all flex flex-col gap-2">
            <span>
              Submitted (tx {status.txHash}) but we could not confirm it. Check Markets before submitting again.
            </span>
            <Link href="/browse-cases" className="underline text-on-surface-variant">
              Open Markets
            </Link>
          </div>
        )}
      </div>
    </AppShell>
  );
}

export default function PostAClaimPage() {
  const [claimType, setClaimType] = useState<ClaimTypeKey | null>(null);

  if (!claimType) return <StepOne onContinue={setClaimType} />;
  return <StepTwo claimType={claimType} onBack={() => setClaimType(null)} />;
}
