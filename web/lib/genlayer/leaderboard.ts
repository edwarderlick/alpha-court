import "server-only";
import { getAllClaimsSafe } from "./claims";

export type LeaderboardEntry = {
  address: string;
  winCount: number;
  lossCount: number;
  totalResolved: number;
  winRatePct: number;
};

/**
 * Rank posters from the claim snapshot only. Do not call get_passport
 * per address -- that is one Studio read per wallet and is what blew
 * the 500/hour cap (and the Next overlay) on /leaderboard.
 *
 * HELD = poster was right (win). BROKEN = poster was wrong (loss).
 * Only RESOLVED / CONTESTED claims count.
 */
export async function getLeaderboard(): Promise<LeaderboardEntry[]> {
  const claims = await getAllClaimsSafe();
  const byAddress = new Map<string, { winCount: number; lossCount: number }>();

  for (const claim of claims) {
    if (claim.state !== "RESOLVED" && claim.state !== "CONTESTED") continue;
    const address = (claim.poster || "").toLowerCase();
    if (!address) continue;
    const row = byAddress.get(address) ?? { winCount: 0, lossCount: 0 };
    const verdict = (claim.consensus_result || "").toUpperCase();
    if (verdict === "HELD") row.winCount += 1;
    else if (verdict === "BROKEN") row.lossCount += 1;
    byAddress.set(address, row);
  }

  return Array.from(byAddress.entries())
    .map(([address, row]) => {
      const totalResolved = row.winCount + row.lossCount;
      return {
        address,
        winCount: row.winCount,
        lossCount: row.lossCount,
        totalResolved,
        winRatePct: totalResolved > 0 ? Math.round((row.winCount / totalResolved) * 100) : 0,
      };
    })
    .filter((e) => e.totalResolved > 0)
    .sort((a, b) => b.winRatePct - a.winRatePct || b.totalResolved - a.totalResolved);
}
