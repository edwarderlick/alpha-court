import "server-only";
import { isOnChainClaimId, type ClaimSummary } from "./claim-display";
import { currentCourtAddress, originOf } from "../legacy-claim-ids";
import { hashLoad, hashReplace, hashSet, metaGet, metaSet, parseField } from "../persist";

/**
 * App-side source of truth for "what claims exist."
 * The contract is the ledger. This book is what every page reads.
 * Chain refresh is optional and only runs when studio-gate allows it.
 */

const FRESH_MS = 5 * 60 * 1000;

function withOrigin(claim: ClaimSummary): ClaimSummary {
  return {
    ...claim,
    origin_contract: claim.origin_contract || originOf(claim),
  };
}

function rowKey(claim: ClaimSummary): string {
  const stamped = withOrigin(claim);
  return `${(stamped.origin_contract || "").toLowerCase()}::${stamped.claim_id}`;
}

async function loadClaims(): Promise<ClaimSummary[]> {
  const fields = await hashLoad("claims");
  const claims: ClaimSummary[] = [];
  for (const raw of Object.values(fields)) {
    const claim = parseField<ClaimSummary | null>(raw, null);
    if (claim && isOnChainClaimId(claim.claim_id)) claims.push(withOrigin(claim));
  }
  return claims;
}

export async function bookAll(): Promise<ClaimSummary[]> {
  return loadClaims();
}

export async function bookGet(
  id: string,
  opts?: { origin?: string | null; preferLegacy?: boolean }
): Promise<ClaimSummary | null> {
  const rows = (await loadClaims()).filter((c) => c.claim_id === id);
  if (rows.length === 0) return null;
  if (opts?.origin) {
    const match = rows.find((c) => (c.origin_contract || "").toLowerCase() === opts.origin!.toLowerCase());
    if (match) return match;
  }
  const current = currentCourtAddress();
  const live = rows.find((c) => (c.origin_contract || "").toLowerCase() === current);
  if (opts?.preferLegacy) {
    return rows.find((c) => (c.origin_contract || "").toLowerCase() !== current) ?? live ?? rows[0];
  }
  return live ?? rows[0];
}

export async function bookUpsert(claim: ClaimSummary): Promise<void> {
  if (!isOnChainClaimId(claim.claim_id)) return;
  const next = withOrigin(claim);
  await hashSet("claims", rowKey(next), next);
}

export async function bookReplace(claims: ClaimSummary[]): Promise<void> {
  const fields: Record<string, ClaimSummary> = {};
  for (const claim of claims) {
    if (!isOnChainClaimId(claim.claim_id)) continue;
    const next = withOrigin(claim);
    fields[rowKey(next)] = next;
  }
  await hashReplace("claims", fields);
  await metaSet(Date.now());
}

export async function bookIsFresh(): Promise<boolean> {
  const meta = await metaGet();
  return meta.refreshedAt > 0 && Date.now() - meta.refreshedAt < FRESH_MS;
}

export async function bookMeta() {
  const [claims, meta, fresh] = await Promise.all([loadClaims(), metaGet(), bookIsFresh()]);
  return { count: claims.length, refreshedAt: meta.refreshedAt, fresh };
}
