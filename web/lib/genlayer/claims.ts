import "server-only";
import { readClaim } from "./client";
import { bookAll, bookReplace } from "./book";
import { studioCanRead, studioNoteError } from "./studio-gate";
import { mapPool } from "./pool";
import type { ClaimSummary } from "./claim-display";

export type { ClaimSummary };

/**
 * Pre-launch audit: factored out of browse-cases/page.tsx so
 * activity/page.tsx and leaderboard/page.tsx (both previously 100% mock,
 * see this project's README) can reuse the exact same real read instead
 * of each inventing its own. Newest first, matching browse-cases' own
 * existing order.
 */
export async function getAllClaims(): Promise<ClaimSummary[]> {
  const book = bookAll();
  // A full list_claims + get_claim-per-id refresh is tens of Studio reads.
  // The book is upserted by the keeper and by one-id polls; serve it.
  if (book.length > 0) return book;
  if (!studioCanRead()) return book;
  try {
    const ids = (await readClaim("list_claims")) as string[];
    const claims = await mapPool(ids, 2, (id) => readClaim("get_claim", [id]) as Promise<ClaimSummary>);
    const newestFirst = claims.reverse();
    bookReplace(newestFirst);
    return newestFirst;
  } catch (err) {
    studioNoteError(err, "read");
    if (book.length > 0) return book;
    throw err;
  }
}

export async function getAllClaimsSafe(): Promise<ClaimSummary[]> {
  try {
    return await getAllClaims();
  } catch {
    return bookAll();
  }
}

export type LandingSummary = {
  total: number;
  open: number;
  locked: number;
  settled: number;
  genInPlay: number;
  nextDeadline: ClaimSummary | null;
  featured: ClaimSummary[];
  types: { price: number; relative: number; fundamentals: number };
};

export async function getLandingBundle(): Promise<{ claims: ClaimSummary[]; total: number }> {
  try {
    const claims = await getAllClaimsSafe();
    return { claims, total: claims.length };
  } catch {
    const stale = bookAll();
    return { claims: stale, total: stale.length };
  }
}

export function summarizeLanding(claims: ClaimSummary[]): LandingSummary {
  const open = claims.filter((c) => c.state === "OPEN");
  const locked = claims.filter((c) => c.state === "EVIDENCE_LOCKED");
  const settled = claims.filter((c) => c.state === "RESOLVED" || c.state === "CONTESTED");
  const genInPlay = claims.reduce((sum, c) => {
    return sum + (parseFloat(c.stake_for_total) || 0) + (parseFloat(c.stake_against_total) || 0);
  }, 0);
  const upcoming = open
    .map((c) => ({ c, t: new Date(c.deadline).getTime() }))
    .filter((x) => Number.isFinite(x.t) && x.t > Date.now())
    .sort((a, b) => a.t - b.t);
  return {
    total: claims.length,
    open: open.length,
    locked: locked.length,
    settled: settled.length,
    genInPlay,
    nextDeadline: upcoming[0]?.c ?? null,
    featured: claims.slice(0, 4),
    types: {
      price: claims.filter((c) => c.claim_type === "PRICE_THRESHOLD").length,
      relative: claims.filter((c) => c.claim_type === "RELATIVE_PERFORMANCE").length,
      fundamentals: claims.filter((c) => c.claim_type === "FUNDAMENTALS_THRESHOLD").length,
    },
  };
}
