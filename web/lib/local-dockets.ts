import { isOnChainClaimId, isPendingClaimId, type ClaimSummary } from "@/lib/genlayer/claim-display";
import { claimRowKey } from "@/lib/legacy-claim-ids";

const KEY = "ac-local-dockets-v1";

function read(): ClaimSummary[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    const parsed = raw ? (JSON.parse(raw) as ClaimSummary[]) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function write(claims: ClaimSummary[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(claims.slice(0, 40)));
    window.dispatchEvent(new Event("ac-local-dockets"));
  } catch {
    /* quota */
  }
}

export function listLocalDockets(): ClaimSummary[] {
  return read();
}

export function saveLocalDocket(claim: ClaimSummary) {
  if (!isOnChainClaimId(claim.claim_id)) return;
  const next = [claim, ...read().filter((c) => claimRowKey(c) !== claimRowKey(claim))];
  write(next);
  void fetch("/api/claims/remember", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ claim }),
  }).catch(() => {
    /* server cache is best-effort */
  });
}

export function mergeDockets(remote: ClaimSummary[], local: ClaimSummary[]): ClaimSummary[] {
  const seen = new Set(remote.map((c) => claimRowKey(c)));
  const extras = local.filter((c) => !seen.has(claimRowKey(c)));
  const live = extras.filter((c) => isOnChainClaimId(c.claim_id));
  const pending = extras.filter((c) => isPendingClaimId(c.claim_id));
  // Root cause of ID PENDING sitting at the top: local extras were prepended.
  // On-chain remote + local live first; placeholder ids always last.
  return [...remote, ...live, ...pending];
}

export function sortMarkets<T extends { claim_id: string; created_at?: string; deadline?: string; state?: string }>(
  claims: T[]
): T[] {
  const rank = (c: T) => (isPendingClaimId(c.claim_id) ? 1 : 0);
  const recency = (c: T) => {
    const created = c.created_at ? Date.parse(c.created_at) : Number.NaN;
    if (Number.isFinite(created)) return created;
    const deadline = c.deadline ? Date.parse(c.deadline) : Number.NaN;
    return Number.isFinite(deadline) ? deadline : 0;
  };
  return [...claims].sort((a, b) => {
    const ra = rank(a);
    const rb = rank(b);
    if (ra !== rb) return ra - rb;
    return recency(b) - recency(a);
  });
}

export function listenLocalDockets(fn: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  window.addEventListener("ac-local-dockets", fn);
  window.addEventListener("storage", fn);
  return () => {
    window.removeEventListener("ac-local-dockets", fn);
    window.removeEventListener("storage", fn);
  };
}
