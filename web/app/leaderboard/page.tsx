import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { getLeaderboard } from "@/lib/genlayer/leaderboard";
import { AddressMark, shortenAddress } from "@/components/AddressMark";
import { RankYou } from "@/components/RankYou";

export default async function LeaderboardPage() {
  let entries: Awaited<ReturnType<typeof getLeaderboard>> = [];
  try {
    entries = await getLeaderboard();
  } catch {
    entries = [];
  }
  const rows = entries.map((e, i) => ({
    rank: String(i + 1).padStart(2, "0"),
    initial: e.address.slice(2, 3).toUpperCase(),
    name: shortenAddress(e.address),
    address: e.address,
    winRate: `${e.winRatePct}%`,
    claims: String(e.totalResolved),
    repScore: `${e.winCount}W / ${e.lossCount}L`,
    repPct: `${e.winRatePct}%`,
    featured: i === 0,
  }));

  return (
    <AppShell activeTop="Rankings" activeSide="Rankings">
      <div className="w-full max-w-6xl mx-auto px-4 md:px-8 py-10 flex flex-col gap-10">
        <section className="flex flex-col md:flex-row justify-between items-end border-b border-white/10 pb-8 gap-8">
          <div className="flex flex-col gap-3">
            <h1 className="font-display text-5xl md:text-7xl text-on-surface uppercase m-0 leading-none tracking-tight">
              Rankings
            </h1>
            <p className="font-mono text-[11px] text-on-surface-variant uppercase tracking-widest">
              On-chain win rate across resolved claims
            </p>
          </div>
          <div className="text-right">
            <div className="font-display text-4xl text-secondary-fixed">{entries.length}</div>
            <div className="font-mono text-[10px] text-on-surface-variant uppercase tracking-widest">
              Ranked claimants
            </div>
          </div>
        </section>

        <RankYou />
        <section className="flex flex-col w-full gap-3">
          <div className="grid-cols-12 gap-4 px-4 py-2 border-b border-white/10 font-mono text-[10px] text-on-surface-variant uppercase tracking-widest hidden md:grid">
            <div className="col-span-1">Rank</div>
            <div className="col-span-4">Claimant</div>
            <div className="col-span-2 text-right">Win rate</div>
            <div className="col-span-2 text-right">Resolved</div>
            <div className="col-span-3">Record</div>
          </div>
          {rows.length === 0 && (
            <p className="font-mono text-sm text-on-surface-variant py-12 text-center">
              Rankings appear once at least one claim reaches a real verdict.
            </p>
          )}
          {rows.map((row) => (
            <div
              key={row.rank}
              data-rank-address={row.address.toLowerCase()}
              className="rank-row pressable grid grid-cols-1 md:grid-cols-12 gap-4 items-center p-5 border border-white/10 bg-surface-container-lowest hover:border-secondary-fixed/40 transition-colors"
            >
              <div className={`col-span-1 font-display text-3xl ${row.featured ? "text-secondary-fixed" : "text-on-surface-variant"}`}>
                {row.rank}
              </div>
              <div className="col-span-4 flex items-center gap-4">
                <AddressMark address={row.address} size={40} />
                <div className="flex flex-col">
                  <span className="font-mono text-sm text-on-surface">{row.name}</span>
                  <Link
                    href={`/alpha-passport?address=${row.address}`}
                    className="font-mono text-[11px] text-on-surface-variant hover:text-secondary-fixed"
                  >
                    View passport
                  </Link>
                </div>
              </div>
              <div className="col-span-2 md:text-right font-display text-3xl text-on-surface">{row.winRate}</div>
              <div className="col-span-2 md:text-right font-display text-3xl text-on-surface">{row.claims}</div>
              <div className="col-span-3 flex flex-col gap-2">
                <div className="flex justify-between font-mono text-[10px] text-on-surface-variant uppercase">
                  <span>Record</span>
                  <span className={row.featured ? "text-secondary-fixed" : "text-on-surface"}>{row.repScore}</span>
                </div>
                <div className="w-full h-1.5 bg-surface-container-highest overflow-hidden">
                  <div
                    className={row.featured ? "h-full bg-secondary-fixed" : "h-full bg-primary"}
                    style={{ width: row.repPct }}
                  />
                </div>
              </div>
            </div>
          ))}
        </section>
      </div>
    </AppShell>
  );
}
