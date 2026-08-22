import type { ClaimSummary } from "./claim-display";
import { bookAll, bookGet, bookReplace, bookUpsert } from "./book";

/** Compatibility wrappers. The book is the only store. */

export function getCachedClaims(): ClaimSummary[] | null {
  const rows = bookAll();
  return rows.length > 0 ? rows : null;
}

export function getStaleClaims(): ClaimSummary[] | null {
  const rows = bookAll();
  return rows.length > 0 ? rows : null;
}

export function setCachedClaims(claims: ClaimSummary[]) {
  bookReplace(claims);
}

export function bustClaimsCache() {
  // Intentionally empty. Wiping or expiring the book after a write
  // is what made Markets go blank while the claim was already on-chain.
}

export function rememberClaim(claim: ClaimSummary) {
  bookUpsert(claim);
}

export function findCachedClaim(id: string, opts?: { preferLegacy?: boolean }): ClaimSummary | null {
  return bookGet(id, opts);
}
