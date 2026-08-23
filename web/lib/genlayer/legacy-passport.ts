import "server-only";
import { bookAll } from "./book";
import type { OnChainPassport } from "./passport";
import { claimRowKey, isLegacyClaim } from "../legacy-claim-ids";

/** Claimant stats from the retired courts, merged so Passport still shows real history. */
export async function legacyPassportFromBook(address: string): Promise<OnChainPassport> {
  const addr = address.toLowerCase();
  const claims = (await bookAll()).filter(
    (c) => isLegacyClaim(c) && c.poster && c.poster.toLowerCase() === addr
  );
  // origin::id, not bare claim_id -- two retired courts (and the live one)
  // can and do reuse the same numeric ids. A bare id here would let
  // mergePassports' Set-based dedup below silently collapse two genuinely
  // different claims into one, dropping a real history entry.
  const history = claims.map((c) => claimRowKey(c));
  const resolved = claims.filter((c) => c.state === "RESOLVED" || c.state === "REFUNDED");
  let win_count = 0;
  let loss_count = 0;
  const category_breakdown: OnChainPassport["category_breakdown"] = {};
  for (const c of resolved) {
    const type = c.claim_type || "PRICE_THRESHOLD";
    if (!category_breakdown[type]) category_breakdown[type] = { win_count: 0, loss_count: 0 };
    if (c.consensus_result === "HELD") {
      win_count += 1;
      category_breakdown[type].win_count += 1;
    } else if (c.consensus_result === "BROKEN") {
      loss_count += 1;
      category_breakdown[type].loss_count += 1;
    }
  }
  return {
    address,
    win_count,
    loss_count,
    category_breakdown,
    claim_history: history,
  };
}

export async function mergePassports(address: string, live: OnChainPassport | null): Promise<OnChainPassport> {
  const legacy = await legacyPassportFromBook(address);
  if (!live) return legacy;
  const category_breakdown = { ...legacy.category_breakdown };
  for (const [type, stats] of Object.entries(live.category_breakdown || {})) {
    const cur = category_breakdown[type] || { win_count: 0, loss_count: 0 };
    category_breakdown[type] = {
      win_count: cur.win_count + (stats.win_count || 0),
      loss_count: cur.loss_count + (stats.loss_count || 0),
    };
  }
  const history = [...new Set([...legacy.claim_history, ...live.claim_history])];
  return {
    address: live.address || address,
    win_count: live.win_count + legacy.win_count,
    loss_count: live.loss_count + legacy.loss_count,
    category_breakdown,
    claim_history: history,
  };
}
