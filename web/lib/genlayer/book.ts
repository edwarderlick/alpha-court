import "server-only";
import { mkdirSync, readFileSync, statSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { isOnChainClaimId, type ClaimSummary } from "./claim-display";
import { currentCourtAddress, originOf } from "../legacy-claim-ids";

/**
 * App-side source of truth for "what claims exist."
 * The contract is the ledger. This book is what every page reads.
 * Chain refresh is optional and only runs when studio-gate allows it.
 */

type BookFile = {
  refreshedAt: number;
  claims: ClaimSummary[];
};

const FILE = join(process.cwd(), ".data", "claims-book.json");
const FRESH_MS = 5 * 60 * 1000;

let mem: BookFile | null = null;
let memMtime = 0;

function empty(): BookFile {
  return { refreshedAt: 0, claims: [] };
}

function load(): BookFile {
  try {
    const mtime = statSync(FILE).mtimeMs;
    if (mem && mtime === memMtime) return mem;
    const parsed = JSON.parse(readFileSync(FILE, "utf8")) as BookFile;
    mem = {
      refreshedAt: typeof parsed.refreshedAt === "number" ? parsed.refreshedAt : 0,
      claims: Array.isArray(parsed.claims)
        ? parsed.claims.filter((c) => isOnChainClaimId(c.claim_id))
        : [],
    };
    memMtime = mtime;
    return mem;
  } catch {
    if (mem) return mem;
    mem = empty();
    return mem;
  }
}

function persist() {
  const data = load();
  mkdirSync(dirname(FILE), { recursive: true });
  writeFileSync(FILE, JSON.stringify(data, null, 2));
  try {
    memMtime = statSync(FILE).mtimeMs;
  } catch {
    /* ignore */
  }
}

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

export function bookAll(): ClaimSummary[] {
  return load().claims.map(withOrigin);
}

export function bookGet(id: string, opts?: { origin?: string | null; preferLegacy?: boolean }): ClaimSummary | null {
  const rows = load().claims.map(withOrigin).filter((c) => c.claim_id === id);
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

export function bookUpsert(claim: ClaimSummary) {
  if (!isOnChainClaimId(claim.claim_id)) return;
  const data = load();
  const next = withOrigin(claim);
  const key = rowKey(next);
  data.claims = [next, ...data.claims.filter((c) => rowKey(c) !== key)];
  mem = data;
  persist();
}

export function bookReplace(claims: ClaimSummary[]) {
  mem = { refreshedAt: Date.now(), claims: claims.map(withOrigin) };
  persist();
}

export function bookIsFresh(): boolean {
  const data = load();
  return data.refreshedAt > 0 && Date.now() - data.refreshedAt < FRESH_MS;
}

export function bookMeta() {
  const data = load();
  return { count: data.claims.length, refreshedAt: data.refreshedAt, fresh: bookIsFresh() };
}
