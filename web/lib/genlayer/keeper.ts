/**
 * Automatic settlement. The only production path that calls
 * lock_deadline_evidence / resolve_verdict / resolve_appeal.
 * Emergency HTTP is POST /api/keeper/settle with Bearer KEEPER_SECRET
 * (disabled if that env is unset). No user-facing UI calls those writes
 * as the primary path — expire_appeal and resolve_appeal remain
 * permissionless fallbacks.
 */
import "server-only";

import { isOnChainClaimId, type ClaimSummary } from "./claim-display";
import { writeAsKeeper, readClaimRaw } from "./client";
import { studioCanRead, studioCanWrite } from "./studio-gate";
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

async function loadClaims(): Promise<KeeperClaim[]> {
  const { bookAll } = await import("./book");
  return (await bookAll()).map((c) => ({
    claim_id: c.claim_id,
    state: c.state,
    deadline: c.deadline,
    contested_at: c.contested_at,
    origin_contract: c.origin_contract,
    created_at: c.created_at,
  }));
}

export async function runKeeperTick(): Promise<KeeperTickResult> {
  const result = emptyKeeperTickResult();

  if (!keeperEnabled()) {
    result.skipped.push("keeper disabled");
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
