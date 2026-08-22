import Link from "next/link";
import { Suspense } from "react";
import { AppShell } from "@/components/AppShell";
import { PassportAddressGate } from "@/components/PassportAddressGate";
import { AddressMark } from "@/components/AddressMark";
import { StakeRows } from "@/components/StakeRows";
import { getPassportCached, type OnChainPassport } from "@/lib/genlayer/passport";
import { mergePassports } from "@/lib/genlayer/legacy-passport";
import { stakeRecordFromCache, stakeRowsFromCache } from "@/lib/genlayer/stakes";
import { caseHref, claimRowKey, isLegacyClaim } from "@/lib/legacy-claim-ids";
import { CourtBanner } from "@/components/CourtBanner";
import { bookAll } from "@/lib/genlayer/book";

type Passport = OnChainPassport;

// Converted from alpha_passport_pro_theme/code.html. The source export
// only had a static address header + a hardcoded "TITAN" label -- no
// win/loss stats, category breakdown, or claim history existed anywhere in
// it. Build Prompt 9 wired real get_passport; a later pass had defaulted
// the lookup to a hardcoded deploy-account address so the page always
// showed *someone's* record. That looked like "your" passport. No default
// now -- connect a wallet (PassportAddressGate fills ?address=) or look
// one up.
export default async function AlphaPassportPage({
  searchParams,
}: {
  searchParams: Promise<{ address?: string }>;
}) {
  const { address } = await searchParams;
  const targetAddress = address?.trim() || "";
  let livePassport: Passport | null = null;
  if (targetAddress) {
    try {
      livePassport = await getPassportCached(targetAddress);
    } catch {
      livePassport = null;
    }
  }
  const passport: Passport | null = targetAddress
    ? mergePassports(targetAddress, livePassport)
    : null;
  const stakeRows = targetAddress ? stakeRowsFromCache(targetAddress) : [];
  const stakeRecord = targetAddress ? stakeRecordFromCache(targetAddress) : null;

  const total = passport ? passport.win_count + passport.loss_count : 0;
  const winRate = passport && total > 0 ? Math.round((passport.win_count / total) * 100) : null;

  return (
    <AppShell activeTop="Passport" activeSide="Passport">
      <Suspense fallback={null}>
        <PassportAddressGate />
      </Suspense>
      <div className="fixed inset-0 pointer-events-none z-[-1] opacity-30">
        <div className="absolute inset-0 bg-gradient-to-br from-primary-container/10 via-transparent to-transparent"></div>
      </div>
      <div className="mb-12 border-b border-white/10 pb-12 flex flex-col md:flex-row justify-between items-start md:items-end gap-6 relative px-margin-safe lg:px-section-padding">
        <div>
          <form className="flex items-center gap-3 mb-4" action="/alpha-passport">
            <input
              name="address"
              defaultValue={targetAddress}
              className="bg-surface-container border border-white/10 rounded-lg px-4 py-2 text-on-surface font-label-mono-sm text-label-mono-sm w-[380px]"
              placeholder="0x... look up any address"
            />
            <button
              type="submit"
              className="bg-secondary-fixed text-on-secondary-fixed px-4 py-2 rounded-lg font-label-mono-bold text-label-mono-sm uppercase"
            >
              Look up
            </button>
          </form>
          <div className="flex items-center gap-4 flex-wrap">
            {targetAddress ? <AddressMark address={targetAddress} size={72} /> : passport?.address ? <AddressMark address={passport.address} size={72} /> : null}
            <h1
              className="font-display-lg text-[clamp(3rem,6vw,7rem)] leading-none text-white uppercase tracking-tighter drop-shadow-2xl break-all"
            >
              {passport?.address || targetAddress || "ALPHA PASSPORT"}
            </h1>
          </div>
          <div className="flex items-center gap-4 mt-6">
            <span className="text-white font-label-mono-sm text-label-mono-sm flex items-center gap-2 uppercase tracking-widest">
              <span className="material-symbols-outlined text-secondary-fixed animate-pulse" style={{ fontSize: "14px" }}>circle</span>
              Real on-chain record · live court plus retired-court history
            </span>
          </div>
        </div>
        <div className="text-right">
          <div className="font-label-mono-bold text-label-mono-bold text-white/50 mb-2 uppercase tracking-widest">WIN RATE</div>
          <div className="font-display-md text-6xl text-primary-container tracking-tighter drop-shadow-[0_0_15px_rgba(189,0,255,0.5)]">
            {!passport || winRate === null ? "N/A" : `${winRate}%`}
          </div>
        </div>
      </div>

      {!targetAddress && (
        <div className="px-margin-safe lg:px-section-padding pb-24">
          <div className="bg-surface-container-lowest border border-white/10 p-12 rounded-xl text-center">
            <p className="font-body-lg text-body-lg text-on-surface-variant">
              Connect your wallet or look up an address to see a real on-chain passport.
            </p>
          </div>
        </div>
      )}

      {targetAddress && passport && (
      <>
      <div className="px-margin-safe lg:px-section-padding mb-4 flex items-center gap-3">
        <img src="/cast/judge.jpg" alt="" className="h-12 w-auto hidden sm:block" />
        <h2 className="font-display text-2xl md:text-4xl uppercase tracking-tight">Claimant record</h2>
        <CourtBanner />
      </div>
      <div className="px-margin-safe lg:px-section-padding grid grid-cols-1 md:grid-cols-3 gap-6 mb-12">
        <div className="bg-surface-container-lowest border border-white/10 p-6 rounded-xl">
          <div className="font-label-mono-sm text-label-mono-sm text-on-surface-variant uppercase mb-2">Wins</div>
          <div className="font-display-lg text-display-lg text-secondary-fixed">{passport.win_count}</div>
        </div>
        <div className="bg-surface-container-lowest border border-white/10 p-6 rounded-xl">
          <div className="font-label-mono-sm text-label-mono-sm text-on-surface-variant uppercase mb-2">Losses</div>
          <div className="font-display-lg text-display-lg text-dispute-red">{passport.loss_count}</div>
        </div>
        <div className="bg-surface-container-lowest border border-white/10 p-6 rounded-xl">
          <div className="font-label-mono-sm text-label-mono-sm text-on-surface-variant uppercase mb-2">Total claims resolved</div>
          <div className="font-display-lg text-display-lg text-on-surface">{total}</div>
        </div>
      </div>

      <div className="px-margin-safe lg:px-section-padding grid grid-cols-1 md:grid-cols-2 gap-6 mb-12">
        <div className="bg-surface-container-lowest border border-white/10 p-6 rounded-xl">
          <div className="font-label-mono-bold text-label-mono-bold text-on-surface uppercase mb-4">Category breakdown</div>
          {Object.keys(passport.category_breakdown).length === 0 && (
            <p className="font-body-md text-body-md text-on-surface-variant">No resolved claims yet.</p>
          )}
          {Object.entries(passport.category_breakdown).map(([type, stats]) => (
            <div key={type} className="flex justify-between font-label-mono-sm text-label-mono-sm py-2 border-b border-white/5">
              <span>{type.replace(/_/g, " ")}</span>
              <span>
                <span className="text-secondary-fixed">{stats.win_count}W</span> / <span className="text-dispute-red">{stats.loss_count}L</span>
              </span>
            </div>
          ))}
        </div>
        <div className="bg-surface-container-lowest border border-white/10 p-6 rounded-xl">
          <div className="font-label-mono-bold text-label-mono-bold text-on-surface uppercase mb-4">Claim history</div>
          {(() => {
            const posted = bookAll().filter(
              (c) => (c.poster || "").toLowerCase() === targetAddress.toLowerCase()
            );
            if (posted.length === 0 && passport.claim_history.length === 0) {
              return <p className="font-body-md text-body-md text-on-surface-variant">No claims yet.</p>;
            }
            return posted.map((row) => (
              <Link
                key={claimRowKey(row)}
                href={caseHref(row)}
                className="block font-label-mono-sm text-label-mono-sm text-primary hover:underline py-1"
              >
                Claim #{row.claim_id}
                {isLegacyClaim(row) ? " · legacy" : ""}
                {row.asset ? ` · ${row.asset}${row.asset_b ? ` vs ${row.asset_b}` : ""}` : ""}
              </Link>
            ));
          })()}
        </div>
      </div>

      <div className="px-margin-safe lg:px-section-padding mb-4 flex items-center gap-3">
        <img src="/cast/challenger.jpg" alt="" className="h-12 w-auto hidden sm:block" />
        <div>
          <h2 className="font-display text-2xl md:text-4xl uppercase tracking-tight">Staking record</h2>
          <p className="font-mono text-[11px] uppercase tracking-widest text-on-surface-variant mt-1">
            Same receipt-based stakes as My Stakes
          </p>
        </div>
      </div>
      <div className="px-margin-safe lg:px-section-padding grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        <div className="bg-surface-container-lowest border border-white/10 p-6 rounded-xl">
          <div className="font-label-mono-sm text-label-mono-sm text-on-surface-variant uppercase mb-2">Stake wins</div>
          <div className="font-display-lg text-display-lg text-secondary-fixed">{stakeRecord?.wins ?? 0}</div>
        </div>
        <div className="bg-surface-container-lowest border border-white/10 p-6 rounded-xl">
          <div className="font-label-mono-sm text-label-mono-sm text-on-surface-variant uppercase mb-2">Stake losses</div>
          <div className="font-display-lg text-display-lg text-dispute-red">{stakeRecord?.losses ?? 0}</div>
        </div>
        <div className="bg-surface-container-lowest border border-white/10 p-6 rounded-xl">
          <div className="font-label-mono-sm text-label-mono-sm text-on-surface-variant uppercase mb-2">Open stakes</div>
          <div className="font-display-lg text-display-lg text-on-surface">{stakeRecord?.pending ?? 0}</div>
        </div>
      </div>
      <div className="px-margin-safe lg:px-section-padding pb-24">
        {stakeRows.length === 0 ? (
          <div className="bg-surface-container-lowest border border-white/10 p-8 rounded-xl">
            <p className="font-body-md text-body-md text-on-surface-variant">
              This wallet has no indexed staking history yet.
            </p>
          </div>
        ) : (
          <StakeRows rows={stakeRows} />
        )}
      </div>
      </>
      )}
    </AppShell>
  );
}
