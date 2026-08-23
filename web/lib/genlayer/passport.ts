import "server-only";
import { readClaimRaw } from "./client";
import { studioCanRead, studioNoteError } from "./studio-gate";
import { currentCourtAddress } from "../legacy-claim-ids";
import { hashLoad, hashSet, parseField } from "../persist";

export type OnChainPassport = {
  address: string;
  win_count: number;
  loss_count: number;
  category_breakdown: Record<string, { win_count: number; loss_count: number }>;
  claim_history: string[];
};

type CacheFile = {
  byAddress: Record<string, { at: number; passport: OnChainPassport }>;
};

const FRESH_MS = 10 * 60 * 1000;

async function load(): Promise<CacheFile> {
  const fields = await hashLoad("passports");
  const byAddress: CacheFile["byAddress"] = {};
  for (const [k, raw] of Object.entries(fields)) {
    const row = parseField<CacheFile["byAddress"][string] | null>(raw, null);
    if (row) byAddress[k] = row;
  }
  return { byAddress };
}

function asPassport(raw: unknown, fallbackAddress: string): OnChainPassport | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Partial<OnChainPassport>;
  const address = typeof row.address === "string" && row.address ? row.address : fallbackAddress;
  return {
    address,
    win_count: Number(row.win_count) || 0,
    loss_count: Number(row.loss_count) || 0,
    category_breakdown:
      row.category_breakdown && typeof row.category_breakdown === "object" ? row.category_breakdown : {},
    claim_history: Array.isArray(row.claim_history) ? row.claim_history.map(String) : [],
  };
}

/**
 * Book-style cache for get_passport. Live Studio read only on miss/stale
 * and only if the gate allows it. Keyed by origin::address, not bare
 * address -- a bare-address key would serve one contract's cached
 * win_count/claim_history as if it were another's after a redeploy, within
 * the FRESH_MS window (the same class of cross-court collision this
 * session's payout-key fix closed elsewhere).
 */
export async function getPassportCached(address: string): Promise<OnChainPassport | null> {
  const addr = address.trim();
  if (!addr.startsWith("0x") || addr.length < 10) return null;
  const key = `${currentCourtAddress()}::${addr.toLowerCase()}`;
  const data = await load();
  const cached = data.byAddress[key];
  const fresh = cached && Date.now() - cached.at < FRESH_MS;
  if (fresh) return cached.passport;
  if (!studioCanRead()) return cached?.passport ?? null;
  try {
    const raw = await readClaimRaw("get_passport", [addr]);
    const passport = asPassport(raw, addr);
    if (passport) {
      const row = { at: Date.now(), passport };
      data.byAddress[key] = row;
      await hashSet("passports", key, row);
    }
    return passport ?? cached?.passport ?? null;
  } catch (err) {
    studioNoteError(err, "read");
    return cached?.passport ?? null;
  }
}
