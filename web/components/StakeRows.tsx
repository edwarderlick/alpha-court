import Link from "next/link";
import { AssetPairMark } from "./AssetMark";
import { stakeOutcomeCopy, type StakeViewRow } from "@/lib/stakes-view";
import { caseHref, claimRowKey, isLegacyClaim } from "@/lib/legacy-claim-ids";

export function StakeRows({
  rows,
  compact = false,
}: {
  rows: StakeViewRow[];
  compact?: boolean;
}) {
  return (
    <div className="flex flex-col gap-3">
      {rows.map((row) => {
        const copy = stakeOutcomeCopy(row);
        const won = row.outcome === "won";
        const lost = row.outcome === "lost";
        return (
          <Link
            key={`${claimRowKey(row)}:${row.side}`}
            href={caseHref(row)}
            className={`pressable relative overflow-hidden border p-4 md:p-5 pr-16 flex flex-col md:flex-row md:items-center gap-3 md:gap-4 transition-colors ${
              won
                ? "border-secondary-fixed/50 bg-secondary-fixed/10"
                : lost
                  ? "border-white/10 bg-surface-container-lowest"
                  : "border-white/10 bg-surface-container-lowest hover:border-white/25"
            }`}
          >
            {won ? <span className="court-stamp court-stamp-won" aria-hidden /> : null}
            {lost ? <span className="court-stamp court-stamp-lost" aria-hidden /> : null}
            <div className="flex items-center gap-3 min-w-0 md:w-1/3">
              <AssetPairMark a={row.asset} b={row.asset_b} size={compact ? 28 : 32} />
              <div className="min-w-0">
                <div className="font-mono text-[11px] uppercase tracking-widest text-on-surface-variant">
                  Claim #{row.claim_id}
                  {isLegacyClaim(row) ? " · legacy" : ""}
                </div>
                <div className={`font-display uppercase truncate ${compact ? "text-lg" : "text-xl"}`}>
                  {row.title}
                </div>
              </div>
            </div>
            <div className="font-mono text-sm uppercase tracking-wide md:w-1/6">
              <span className={row.side === "for" ? "text-secondary-fixed" : "text-dispute-red"}>
                {row.side} {row.amount} GEN
              </span>
            </div>
            <div className={`font-mono text-sm uppercase tracking-wide md:flex-1 ${copy.tone}`}>
              <div className="font-bold">{copy.label}</div>
              <div className="normal-case tracking-normal text-xs mt-1 break-all">{copy.detail}</div>
            </div>
          </Link>
        );
      })}
    </div>
  );
}
