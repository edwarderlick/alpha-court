import type { ClaimSummary } from "./claim-display";
import { bookAll, bookGet, bookReplace, bookUpsert } from "./book";

/** Compatibility wrappers. The book is the only store. */

export async function getCachedClaims(): Promise<ClaimSummary[] | null> {
  const rows = await bookAll();
  return rows.length > 0 ? rows : null;
}

export async function getStaleClaims(): Promise<ClaimSummary[] | null> {
  const rows = await bookAll();
  return rows.length > 0 ? rows : null;
}

export async function setCachedClaims(claims: ClaimSummary[]) {
  await bookReplace(claims);
}

export function bustClaimsCache() {
  // Intentionally empty. Wiping or expiring the book after a write
  // is what made Markets go blank while the claim was already on-chain.
}

export async function rememberClaim(claim: ClaimSummary) {
  await bookUpsert(claim);
}

export async function findCachedClaim(
  id: string,
  opts?: { preferLegacy?: boolean; origin?: string | null }
): Promise<ClaimSummary | null> {
  return bookGet(id, opts);
}
