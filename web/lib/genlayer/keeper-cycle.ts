/**
 * Keeper write cycle. Production keeper.ts is the only caller; tests
 * inject a fake write so APPEAL_PENDING / EVIDENCE_LOCKED exits can be
 * forced without Studio.
 */
import { isDeadlinePassed } from "./claim-display";
import { UnconfirmedSubmissionError } from "./errors";

export const APPEAL_WINDOW_MS = 48 * 60 * 60 * 1000;

export type KeeperClaim = {
  claim_id: string;
  state: string;
  deadline: string;
  contested_at?: string;
  origin_contract?: string;
  created_at?: string;
};

export type KeeperTickResult = {
  at: string;
  locked: string[];
  resolved: string[];
  expired: string[];
  appealed: string[];
  refunded: string[];
  skipped: string[];
  errors: { claimId: string; action: string; message: string }[];
};

export type KeeperWriteResult = { txHash: string; receipt: unknown };

export type KeeperLiveClaim = {
  state?: string;
  consensus_result?: string;
};

export type KeeperCycleIO = {
  write: (functionName: string, args: string[]) => Promise<KeeperWriteResult>;
  refreshBook: (id: string, fallbackState: string) => Promise<KeeperLiveClaim | void>;
  indexTransfers: (opts: {
    claimId: string;
    parentTx: string;
    receipt: unknown;
    kind: "payout" | "refund";
  }) => Promise<void>;
  creditWinners: (claimId: string, parentTx: string) => Promise<{ to: string; value: string }[]>;
  creditRefunds: (claimId: string, parentTx: string) => Promise<{ to: string; value: string }[]>;
  now?: () => number;
};

export function emptyKeeperTickResult(at = new Date().toISOString()): KeeperTickResult {
  return {
    at,
    locked: [],
    resolved: [],
    expired: [],
    appealed: [],
    refunded: [],
    skipped: [],
    errors: [],
  };
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

async function creditAfterResolve(
  io: KeeperCycleIO,
  result: KeeperTickResult,
  claimId: string,
  parentTx: string,
) {
  try {
    const credited = await io.creditWinners(claimId, parentTx);
    if (credited.length > 0) {
      console.log(
        `[keeper] native payout #${claimId}`,
        credited.map((c) => `${c.to}:${c.value}`).join(","),
      );
    }
  } catch (payErr) {
    result.errors.push({
      claimId,
      action: "payout",
      message: errorMessage(payErr),
    });
  }
}

export async function runKeeperCycle(
  claims: KeeperClaim[],
  io: KeeperCycleIO,
  result: KeeperTickResult = emptyKeeperTickResult(),
): Promise<KeeperTickResult> {
  const now = io.now?.() ?? Date.now();
  const maxLocks = 1;
  const maxResolves = 1;
  const maxExpires = 1;
  const maxAppeals = 1;
  const maxRefunds = 1;

  for (const claim of claims) {
    if (result.locked.length >= maxLocks) break;
    if (claim.state !== "OPEN" || !isDeadlinePassed(claim.deadline, now)) continue;
    try {
      console.log(`[keeper] lock_deadline_evidence #${claim.claim_id}`);
      await io.write("lock_deadline_evidence", [claim.claim_id]);
      await io.refreshBook(claim.claim_id, "EVIDENCE_LOCKED");
      result.locked.push(claim.claim_id);
    } catch (err) {
      const message = errorMessage(err);
      if (/claim is not OPEN/i.test(message)) {
        await io.refreshBook(claim.claim_id, "EVIDENCE_LOCKED");
      }
      result.errors.push({
        claimId: claim.claim_id,
        action: "lock",
        message,
      });
    }
  }

  for (const claim of claims) {
    if (result.resolved.length >= maxResolves) break;
    // Leave newly locked claims in EVIDENCE_LOCKED until the next tick
    // so the UI can show real consensus-in-progress, and so resolve is
    // a distinct write rather than the same minute as the freeze.
    if (result.locked.includes(claim.claim_id)) continue;
    if (claim.state !== "EVIDENCE_LOCKED") continue;
    try {
      console.log(`[keeper] resolve_verdict #${claim.claim_id}`);
      const resolved = await io.write("resolve_verdict", [claim.claim_id]);
      await io.indexTransfers({
        claimId: claim.claim_id,
        parentTx: resolved.txHash,
        receipt: resolved.receipt,
        kind: "payout",
      });
      await io.refreshBook(claim.claim_id, "RESOLVED");
      await creditAfterResolve(io, result, claim.claim_id, resolved.txHash);
      result.resolved.push(claim.claim_id);
    } catch (err) {
      const message = errorMessage(err);
      if (/claim is not EVIDENCE_LOCKED/i.test(message) || err instanceof UnconfirmedSubmissionError) {
        const live = (await io.refreshBook(claim.claim_id, "RESOLVED")) ?? {};
        if (live.state === "RESOLVED") {
          const parentTx = err instanceof UnconfirmedSubmissionError ? err.txHash : "";
          try {
            await io.creditWinners(claim.claim_id, parentTx);
            result.resolved.push(claim.claim_id);
          } catch (payErr) {
            result.errors.push({
              claimId: claim.claim_id,
              action: "payout",
              message: errorMessage(payErr),
            });
          }
        }
      }
      result.errors.push({
        claimId: claim.claim_id,
        action: "resolve",
        message,
      });
    }
  }

  for (const claim of claims) {
    if (result.expired.length >= maxExpires) break;
    if (claim.state !== "CONTESTED" || !claim.contested_at) continue;
    const closeAt = new Date(claim.contested_at).getTime() + APPEAL_WINDOW_MS;
    if (!Number.isFinite(closeAt) || now < closeAt) continue;
    try {
      console.log(`[keeper] expire_appeal #${claim.claim_id}`);
      const expired = await io.write("expire_appeal", [claim.claim_id]);
      await io.indexTransfers({
        claimId: claim.claim_id,
        parentTx: expired.txHash,
        receipt: expired.receipt,
        kind: "refund",
      });
      await io.refreshBook(claim.claim_id, "REFUNDED");
      try {
        const credited = await io.creditRefunds(claim.claim_id, expired.txHash);
        if (credited.length > 0) {
          console.log(
            `[keeper] native refund #${claim.claim_id}`,
            credited.map((c) => `${c.to}:${c.value}`).join(","),
          );
        }
      } catch (payErr) {
        result.errors.push({
          claimId: claim.claim_id,
          action: "refund",
          message: errorMessage(payErr),
        });
      }
      result.expired.push(claim.claim_id);
    } catch (err) {
      result.errors.push({
        claimId: claim.claim_id,
        action: "expire",
        message: errorMessage(err),
      });
    }
  }

  for (const claim of claims) {
    if (result.appealed.length >= maxAppeals) break;
    if (claim.state !== "APPEAL_PENDING") continue;
    try {
      console.log(`[keeper] resolve_appeal #${claim.claim_id}`);
      const appealed = await io.write("resolve_appeal", [claim.claim_id]);
      const live = (await io.refreshBook(claim.claim_id, "RESOLVED")) ?? { state: "RESOLVED" };
      const refunded = live.state === "REFUNDED";
      await io.indexTransfers({
        claimId: claim.claim_id,
        parentTx: appealed.txHash,
        receipt: appealed.receipt,
        kind: refunded ? "refund" : "payout",
      });
      if (refunded) {
        try {
          const credited = await io.creditRefunds(claim.claim_id, appealed.txHash);
          if (credited.length > 0) {
            console.log(
              `[keeper] native refund #${claim.claim_id}`,
              credited.map((c) => `${c.to}:${c.value}`).join(","),
            );
          }
        } catch (payErr) {
          result.errors.push({
            claimId: claim.claim_id,
            action: "refund",
            message: errorMessage(payErr),
          });
        }
      } else {
        await creditAfterResolve(io, result, claim.claim_id, appealed.txHash);
      }
      result.appealed.push(claim.claim_id);
    } catch (err) {
      const message = errorMessage(err);
      if (/claim is not APPEAL_PENDING/i.test(message) || err instanceof UnconfirmedSubmissionError) {
        const live = (await io.refreshBook(claim.claim_id, "RESOLVED")) ?? {};
        const terminal = live.state === "RESOLVED" || live.state === "REFUNDED";
        if (terminal) {
          const parentTx = err instanceof UnconfirmedSubmissionError ? err.txHash : "";
          if (live.state === "RESOLVED") {
            await creditAfterResolve(io, result, claim.claim_id, parentTx);
          } else if (live.state === "REFUNDED") {
            try {
              await io.creditRefunds(claim.claim_id, parentTx);
            } catch (payErr) {
              result.errors.push({
                claimId: claim.claim_id,
                action: "refund",
                message: errorMessage(payErr),
              });
            }
          }
          result.appealed.push(claim.claim_id);
        }
      }
      result.errors.push({
        claimId: claim.claim_id,
        action: "appeal",
        message,
      });
    }
  }

  // Drain REFUNDED claims that arrived without this tick's expire/appeal
  // write (a human called expire_appeal / resolve_appeal, or a prior
  // creditRefunds failed). Independent of who flipped the state.
  for (const claim of claims) {
    if (result.refunded.length >= maxRefunds) break;
    if (claim.state !== "REFUNDED") continue;
    if (result.expired.includes(claim.claim_id) || result.appealed.includes(claim.claim_id)) {
      continue;
    }
    try {
      console.log(`[keeper] creditRefunds #${claim.claim_id}`);
      const credited = await io.creditRefunds(claim.claim_id, "");
      if (credited.length > 0) {
        console.log(
          `[keeper] native refund #${claim.claim_id}`,
          credited.map((c) => `${c.to}:${c.value}`).join(","),
        );
        result.refunded.push(claim.claim_id);
      }
    } catch (err) {
      result.errors.push({
        claimId: claim.claim_id,
        action: "refund",
        message: errorMessage(err),
      });
    }
  }

  return result;
}
