/**
 * The only Studio budget in the app. Reads and writes are separate
 * windows because Studio rate-limits gen_call and eth_sendRawTransaction
 * independently. A successful single get_claim must NEVER clear the
 * write window (that is how keeper + pages reopened the flood).
 */

const HOURLY = /500 requests per hour|requests per hour/i;
const ANY_LIMIT = /rate limit exceeded|request is being rate limited|sendRawTransaction/i;

let readBlockedUntil = 0;
let writeBlockedUntil = 0;
let lastReadError = "";
let lastWriteError = "";

/** Per-claim floor so keeper + open tabs cannot each assume the full 30/min. */
const CLAIM_CHAIN_GAP_MS = 20_000;
const lastClaimChainRead = new Map<string, number>();

function msg(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  const cause = err instanceof Error && err.cause instanceof Error ? err.cause.message : "";
  return `${message} ${cause}`;
}

export function studioCanRead(): boolean {
  return Date.now() >= readBlockedUntil;
}

export function studioCanWrite(): boolean {
  return Date.now() >= writeBlockedUntil;
}

export function studioNoteError(err: unknown, kind: "read" | "write") {
  const text = msg(err);
  const hourly = HOURLY.test(text);
  const limited = hourly || ANY_LIMIT.test(text);
  if (!limited) return;
  const extra = hourly ? 12 * 60 * 1000 : 90 * 1000;
  if (kind === "read") {
    lastReadError = text.trim();
    if (Date.now() >= readBlockedUntil) readBlockedUntil = Date.now() + extra;
  } else {
    lastWriteError = text.trim();
    if (Date.now() >= writeBlockedUntil) writeBlockedUntil = Date.now() + extra;
  }
}

export function studioStatus() {
  return {
    canRead: studioCanRead(),
    canWrite: studioCanWrite(),
    readBlockedForMs: Math.max(0, readBlockedUntil - Date.now()),
    writeBlockedForMs: Math.max(0, writeBlockedUntil - Date.now()),
    lastReadError,
    lastWriteError,
  };
}

export function claimChainReadAllowed(claimId: string, force = false): boolean {
  if (!studioCanRead()) return false;
  if (force) return true;
  const last = lastClaimChainRead.get(claimId) ?? 0;
  return Date.now() - last >= CLAIM_CHAIN_GAP_MS;
}

export function noteClaimChainRead(claimId: string): void {
  lastClaimChainRead.set(claimId, Date.now());
}

export function isHourlyRateLimit(err: unknown): boolean {
  return HOURLY.test(msg(err));
}

export function isAnyRateLimit(err: unknown): boolean {
  return ANY_LIMIT.test(msg(err)) || isHourlyRateLimit(err);
}

export function rpcBlocked(): boolean {
  return !studioCanRead();
}

export function rpcBlockedForMs(): number {
  return Math.max(0, readBlockedUntil - Date.now());
}

export function noteRpcFailure(err: unknown) {
  studioNoteError(err, "read");
}

/** Kept so old call sites compile. Must stay a no-op. */
export function clearRpcBlock() {
  /* never auto-clear: one good read used to unlock the keeper flood */
}
