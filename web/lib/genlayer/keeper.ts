/**
 * Automatic settlement. The only production path that calls
 * lock_deadline_evidence / resolve_verdict / resolve_appeal.
 * Payouts and refunds are contract emit_transfer; the keeper does not
 * send native GEN for those. It still has to *call* the permissionless
 * settlement methods on a clock.
 * Emergency HTTP is POST /api/keeper/settle with Bearer KEEPER_SECRET
 * (disabled if that env is unset). No user-facing UI calls those writes
 * as the primary path — expire_appeal and resolve_appeal remain
 * permissionless fallbacks.
 */
import "server-only";

import { isOnChainClaimId, type ClaimSummary } from "./claim-display";
import { writeAsKeeper, readClaimRaw } from "./client";
import { studioCanRead, studioCanWrite } from "./studio-gate";
import { storageKind } from "../persist";
import { unsafeSignerWithoutRedis } from "./keeper-safety";
import { bookGet, bookUpsert } from "./book";
import { indexTriggeredTransfers, reclassifyUnverifiedPayouts } from "./payouts";
import { isLegacyClaim } from "../legacy-claim-ids";
import { creditRefundedStakers, creditResolvedWinners } from "./keeper-credits";
import {
  emptyKeeperTickResult,
  runKeeperCycle,
  type KeeperClaim,
  type KeeperTickResult,
} from "./keeper-cycle";

export type { KeeperTickResult };

let running = false;
let timer: ReturnType<typeof setInterval> | null = null;
let lastTick: KeeperTickResult | null = null;

async function refreshBook(id: string, fallbackState: string) {
  try {
    const live = (await readClaimRaw("get_claim", [id], { bypass: true })) as ClaimSummary;
    await bookUpsert(live);
    return live;
  } catch {
    const existing = await bookGet(id);
    if (existing) await bookUpsert({ ...existing, state: fallbackState });
    return existing ? { ...existing, state: fallbackState } : { state: fallbackState };
  }
}

export function keeperEnabled(): boolean {
  return process.env.KEEPER_ENABLED === "true";
}

export function keeperMinClaimId(): number {
  const raw = process.env.KEEPER_MIN_CLAIM_ID;
  const n = raw ? Number(raw) : 0;
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function eligible(claim: KeeperClaim): boolean {
  if (!isOnChainClaimId(claim.claim_id)) return false;
  if (isLegacyClaim(claim)) return false;
  const min = keeperMinClaimId();
  if (!min) return true;
  const id = Number(claim.claim_id);
  return Number.isFinite(id) && id >= min;
}

function toKeeperClaim(c: ClaimSummary): KeeperClaim {
  return {
    claim_id: c.claim_id,
    state: c.state,
    deadline: c.deadline,
    contested_at: c.contested_at,
    origin_contract: c.origin_contract,
    created_at: c.created_at,
  };
}

/**
 * Which claims exist can never depend on the book knowing about them --
 * a lost row, a write-path gap, anything -- would otherwise leave a real
 * claim sitting unexamined forever with no error (round: "claim discovery
 * must not depend on the book knowing a claim exists"). list_claims is a
 * real enumeration straight from contract storage (self.claim_order), so
 * it's the actual source of "which claims exist" for the current court.
 * The book is still used underneath -- but only as a cache for claims it
 * already knows about, never as the reason a claim is skipped entirely.
 */
export async function loadClaims(): Promise<KeeperClaim[]> {
  const { bookAll, bookUpsert } = await import("./book");
  const { currentCourtAddress } = await import("../legacy-claim-ids");
  const book = await bookAll();
  // list_claims only ever returns IDs for the current court -- a book row
  // must be scoped to that same origin to count as "already known," or a
  // stale bare-id row from a retired court (claim IDs restart on every
  // redeploy) masks a real current-court claim with the same number. Same
  // collision class as the payouts/passport bugs fixed earlier this project.
  const current = currentCourtAddress();
  const known = new Set(
    book
      .filter((c) => (c.origin_contract || "").toLowerCase() === current)
      .map((c) => c.claim_id)
  );

  const discovered: KeeperClaim[] = [];
  try {
    const chainIds = (await readClaimRaw("list_claims", [], { bypass: true })) as string[];
    for (const id of chainIds) {
      if (known.has(id)) continue;
      try {
        const live = (await readClaimRaw("get_claim", [id], { bypass: true })) as ClaimSummary;
        discovered.push(toKeeperClaim(live));
        console.log(`[keeper] discovered claim #${id} via chain enumeration (book had no row)`);
        try {
          await bookUpsert(live);
        } catch (err) {
          // Redis down must not drop a real chain claim from the tick.
          console.error(`[keeper] book upsert failed for discovered claim #${id}`, err);
        }
      } catch (err) {
        console.error(`[keeper] failed to fetch newly-discovered claim #${id}`, err);
      }
    }
  } catch (err) {
    console.error("[keeper] chain claim enumeration (list_claims) failed", err);
  }

  return [...book.map(toKeeperClaim), ...discovered];
}

export async function runKeeperTick(): Promise<KeeperTickResult> {
  const result = emptyKeeperTickResult();

  if (!keeperEnabled()) {
    result.skipped.push("keeper disabled");
    lastTick = result;
    return result;
  }

  const unsafeReason = unsafeSignerWithoutRedis(
    Boolean(process.env.ALPHA_COURT_SIGNER_PRIVATE_KEY),
    storageKind()
  );
  if (unsafeReason) {
    console.error(`[keeper] ${unsafeReason}`);
    result.skipped.push(unsafeReason);
    lastTick = result;
    return result;
  }

  if (running) {
    result.skipped.push("previous tick still running");
    lastTick = result;
    return result;
  }

  running = true;
  try {
    if (studioCanRead()) {
      try {
        const flipped = await reclassifyUnverifiedPayouts();
        if (flipped > 0) console.log(`[keeper] reclassified ${flipped} unverified payout rows`);
      } catch (err) {
        console.error("[keeper] payout reclassify failed", err);
      }
    }

    if (!studioCanRead() || !studioCanWrite()) {
      result.skipped.push("studio rate limit cooldown");
      return result;
    }
    const claims = (await loadClaims()).filter(eligible);
    await runKeeperCycle(claims, {
      write: writeAsKeeper,
      refreshBook,
      indexTransfers: indexTriggeredTransfers,
      creditWinners: creditResolvedWinners,
      creditRefunds: creditRefundedStakers,
    }, result);
  } finally {
    running = false;
    lastTick = result;
  }

  console.log("[keeper] tick", JSON.stringify(result));
  return result;
}

export function getLastKeeperTick(): KeeperTickResult | null {
  return lastTick;
}

export function startKeeper(): void {
  if (!keeperEnabled() || timer) return;
  const intervalMs = Number(process.env.KEEPER_INTERVAL_MS) || 60_000;
  console.log(
    `[keeper] started, interval ${intervalMs}ms, min claim id ${keeperMinClaimId() || "none"}`
  );
  const kick = () => {
    runKeeperTick().catch((err) => console.error("[keeper] tick failed", err));
  };
  setTimeout(kick, 15_000);
  timer = setInterval(kick, intervalMs);
}
