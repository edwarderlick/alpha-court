import "server-only";
import { readClaimRaw } from "./client";

/**
 * Real, fresh contract reads for the keeper's payout decisions --
 * deliberately never the Redis stake cache (lib/genlayer/stakes.ts).
 * That cache exists for UI display speed and rate-limit mitigation; it's
 * mutable and unauthenticated, so it must never be the final authority
 * for a financial operation (steward review finding). get_stakers_for_claim
 * is a real on-chain enumeration added specifically to close this gap --
 * get_stake alone requires already knowing which address to ask about,
 * and the cache was the only prior source of that address list.
 */

export type OnChainStaker = {
  address: string;
  side: "for" | "against";
  amountAtto: string;
};

function toAtto(raw: unknown): string {
  if (typeof raw === "bigint") return raw.toString();
  if (typeof raw === "number" && Number.isFinite(raw)) return BigInt(Math.trunc(raw)).toString();
  if (typeof raw === "string" && raw.trim() !== "") return BigInt(raw.trim()).toString();
  return "0";
}

/** Real, uncached contract read -- every call goes straight to Studio. */
export async function stakersFromChain(claimId: string): Promise<OnChainStaker[]> {
  const raw = (await readClaimRaw("get_stakers_for_claim", [claimId], { bypass: true })) as unknown;
  if (!Array.isArray(raw)) return [];
  const out: OnChainStaker[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const row = entry as { address?: unknown; side?: unknown; amount_atto?: unknown };
    const address = typeof row.address === "string" ? row.address.toLowerCase() : "";
    const side = row.side === "for" || row.side === "against" ? row.side : null;
    if (!address || !side) continue;
    const amountAtto = toAtto(row.amount_atto);
    if (amountAtto === "0") continue;
    out.push({ address, side, amountAtto });
  }
  return out;
}
