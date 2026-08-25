import "server-only";
import type { Address } from "viem";
import type { ClaimSummary } from "./claim-display";
import { keeperAddress, readClaimRaw, readNativeBalance, sendAsKeeper } from "./client";
import { attoToGenString } from "./atto";
import { payoutsFor, recordPayout, type PayoutTransfer } from "./payouts";
import { currentCourtAddress } from "../legacy-claim-ids";
import { stakersFromChain } from "./onchain-stakers";
import { acquireLock, releaseLock, storageKind } from "../persist";
import { alreadyCredited, creditedCount } from "./payout-credit-rules";
import { unsafeSignerWithoutRedis } from "./keeper-safety";

const CREDIT_LOCK_TTL_MS = 3 * 60 * 1000;

/**
 * The credit lock (acquireLock/releaseLock) is only as trustworthy as the
 * backend it runs on -- a real incident already happened once from
 * runKeeperTick() being called with a real signer key and no Redis (see
 * keeper-safety.ts). That guard only covered runKeeperTick(), but this
 * project's own adversarial-testing convention calls these two credit
 * functions directly, bypassing the tick loop entirely -- which caused a
 * real duplicate send for real: a locally-run test (real signer key, disk
 * backend) recorded a payout only in the local ledger, invisible to
 * production's Redis ledger, which then paid the same claim again once it
 * could see it. Guard here too, not just at the tick entry point.
 */
function creditingGuardReason(): string | null {
  return unsafeSignerWithoutRedis(Boolean(process.env.ALPHA_COURT_SIGNER_PRIVATE_KEY), storageKind());
}

/**
 * Real, fresh contract read for the fields that actually decide a payout:
 * state, consensus_result, both pool totals, and the appeal fields. Same
 * gap as the stake cache, one layer up -- get_stakers_for_claim already
 * made the staker LIST come from the chain, but state/outcome/pools were
 * still read from the Redis book, so a cooked book row could still pay
 * the wrong side or the wrong amount, and a missing book row could make a
 * genuinely RESOLVED claim pay nobody at all. readClaimRaw always targets
 * the live contract (CONTRACT_ADDRESS), so the claim's real origin is
 * simply the current court -- no book lookup needed for that either.
 */
async function readClaimFromChain(claimId: string): Promise<ClaimSummary | null> {
  try {
    return (await readClaimRaw("get_claim", [claimId], { bypass: true })) as ClaimSummary;
  } catch {
    return null;
  }
}

function winningSide(consensus: string): "for" | "against" | null {
  if (consensus === "HELD") return "for";
  if (consensus === "BROKEN") return "against";
  return null;
}

function genStringToAtto(raw: string | null | undefined): bigint {
  if (!raw) return 0n;
  const text = String(raw).trim();
  if (!text) return 0n;
  if (!text.includes(".")) return BigInt(text) * 10n ** 18n;
  const [whole, frac = ""] = text.split(".");
  return BigInt(whole || "0") * 10n ** 18n + BigInt((frac + "000000000000000000").slice(0, 18));
}

function posAtto(raw: string | null | undefined): bigint {
  try {
    return raw ? BigInt(raw) : 0n;
  } catch {
    return 0n;
  }
}


/**
 * After resolve_verdict succeeds on Studionet, credit winners with a
 * native EOA send. Contract IC→EOA transfers do not credit here.
 *
 * The keeper paying itself is a no-op on Studionet (A→A, NO_MAJORITY,
 * balance unchanged). That path is skipped and recorded credited:false.
 * Any other send is credited:true only if getBalance actually increased.
 */
export async function creditResolvedWinners(
  claimId: string,
  parentTx: string
): Promise<PayoutTransfer[]> {
  const unsafeReason = creditingGuardReason();
  if (unsafeReason) {
    console.error(`[keeper-credits] ${unsafeReason}`);
    return [];
  }
  const lockName = `credit:${claimId}`;
  if (!(await acquireLock(lockName, CREDIT_LOCK_TTL_MS))) return [];
  try {
    return await creditResolvedWinnersLocked(claimId, parentTx);
  } finally {
    await releaseLock(lockName);
  }
}

async function creditResolvedWinnersLocked(
  claimId: string,
  parentTx: string
): Promise<PayoutTransfer[]> {
  const claim = await readClaimFromChain(claimId);
  if (!claim || claim.state !== "RESOLVED") return [];
  const side = winningSide(claim.consensus_result);
  if (!side) return [];

  const winPool = genStringToAtto(side === "for" ? claim.stake_for_total : claim.stake_against_total);
  const losePool = genStringToAtto(side === "for" ? claim.stake_against_total : claim.stake_for_total);
  if (winPool <= 0n) return [];

  const claimOrigin = currentCourtAddress();
  const keeper = (keeperAddress() || "").toLowerCase();
  // Real, fresh contract read -- never the Redis stake cache. A fabricated
  // or corrupted cache row cannot change who gets paid or how much, and a
  // deleted cache row cannot cause a real staker to be missed, because the
  // cache is never consulted here at all.
  const onChainStakers = await stakersFromChain(claimId);
  const winners = new Map<string, bigint>();
  for (const staker of onChainStakers) {
    if (staker.side !== side) continue;
    const stake = posAtto(staker.amountAtto);
    if (stake <= 0n) continue;
    winners.set(staker.address, (winners.get(staker.address) ?? 0n) + stake);
  }

  const credited: PayoutTransfer[] = [];
  const addrs = [...winners.keys()].sort();
  let losingLeft = losePool;
  for (let i = 0; i < addrs.length; i++) {
    const addr = addrs[i]!;
    const stake = winners.get(addr)!;
    const already = alreadyCredited(await payoutsFor(addr, claimId, claimOrigin), "payout");
    if (already) {
      const share = (stake * losePool) / winPool;
      losingLeft -= share;
      continue;
    }
    const share = i === addrs.length - 1 ? losingLeft : (stake * losePool) / winPool;
    if (i !== addrs.length - 1) losingLeft -= share;
    const owed = stake + share;
    if (owed <= 0n) continue;
    credited.push(await creditOne({
      claimId,
      to: addr,
      owed,
      parentTx,
      kind: "payout",
      claimOrigin,
      keeper,
    }));
  }

  const extra = claim as ClaimSummary & {
    appeal_outcome?: string;
    appeal_bond?: string;
    appeal_filer?: string | null;
  };
  if (extra.appeal_outcome === "SETTLED" && extra.appeal_filer && extra.appeal_bond) {
    const bond = genStringToAtto(extra.appeal_bond);
    const filer = extra.appeal_filer.toLowerCase();
    if (bond > 0n && !alreadyCredited(await payoutsFor(filer, claimId, claimOrigin), "refund", filer)) {
      credited.push(await creditOne({
        claimId,
        to: filer,
        owed: bond,
        parentTx,
        kind: "refund",
        claimOrigin,
        keeper,
      }));
    }
  }
  return credited;
}

/**
 * After expire_appeal or resolve_appeal NO_AGREEMENT, credit each original
 * staker their exact stake (and, on NO_AGREEMENT, an even share of the
 * forfeited bond). Same Studionet native-send path as winners.
 */
export async function creditRefundedStakers(
  claimId: string,
  parentTx: string
): Promise<PayoutTransfer[]> {
  const unsafeReason = creditingGuardReason();
  if (unsafeReason) {
    console.error(`[keeper-credits] ${unsafeReason}`);
    return [];
  }
  const lockName = `credit:${claimId}`;
  if (!(await acquireLock(lockName, CREDIT_LOCK_TTL_MS))) return [];
  try {
    return await creditRefundedStakersLocked(claimId, parentTx);
  } finally {
    await releaseLock(lockName);
  }
}

async function creditRefundedStakersLocked(
  claimId: string,
  parentTx: string
): Promise<PayoutTransfer[]> {
  const claim = await readClaimFromChain(claimId);
  if (!claim || claim.state !== "REFUNDED") return [];

  const claimOrigin = currentCourtAddress();
  const keeper = (keeperAddress() || "").toLowerCase();
  const extra = claim as ClaimSummary & {
    appeal_outcome?: string;
    appeal_bond?: string;
  };
  // Real, fresh contract read -- never the Redis stake cache. See
  // creditResolvedWinnersLocked for the full reasoning.
  const onChainStakers = await stakersFromChain(claimId);
  const stakes = new Map<string, bigint>();
  for (const staker of onChainStakers) {
    const stake = posAtto(staker.amountAtto);
    if (stake <= 0n) continue;
    stakes.set(staker.address, (stakes.get(staker.address) ?? 0n) + stake);
  }

  const credited: PayoutTransfer[] = [];
  for (const [addr, stake] of stakes) {
    if (alreadyCredited(await payoutsFor(addr, claimId, claimOrigin), "refund")) continue;
    credited.push(await creditOne({
      claimId,
      to: addr,
      owed: stake,
      parentTx,
      kind: "refund",
      claimOrigin,
      keeper,
    }));
  }

  if (extra.appeal_outcome === "NO_AGREEMENT" && extra.appeal_bond) {
    const bond = genStringToAtto(extra.appeal_bond);
    const addrs = [...stakes.keys()].sort();
    if (bond > 0n && addrs.length > 0) {
      const n = BigInt(addrs.length);
      const share = bond / n;
      const remainder = bond % n;
      for (let i = 0; i < addrs.length; i++) {
        const addr = addrs[i]!;
        const extraBond = share + (i === addrs.length - 1 ? remainder : 0n);
        if (extraBond <= 0n) continue;
        const doneCount = creditedCount(await payoutsFor(addr, claimId, claimOrigin), "refund");
        if (doneCount >= 2) continue;
        credited.push(await creditOne({
          claimId,
          to: addr,
          owed: extraBond,
          parentTx,
          kind: "refund",
          claimOrigin,
          keeper,
        }));
      }
    }
  }
  return credited;
}

async function creditOne(opts: {
  claimId: string;
  to: string;
  owed: bigint;
  parentTx: string;
  kind: "payout" | "refund";
  claimOrigin: string;
  keeper: string;
}): Promise<PayoutTransfer> {
  const { claimId, to, owed, parentTx, kind, claimOrigin, keeper } = opts;
  if (keeper && to === keeper) {
    const row: PayoutTransfer = {
      claimId,
      to,
      valueAtto: owed.toString(),
      value: attoToGenString(owed.toString()),
      txHash: `uncredited:self:${claimId}:${to}:${kind}`,
      parentTx,
      kind,
      credited: false,
      originContract: claimOrigin,
    };
    await recordPayout(row);
    return row;
  }
  const before = await readNativeBalance(to);
  const { txHash } = await sendAsKeeper(to as Address, owed);
  const after = await readNativeBalance(to);
  const row: PayoutTransfer = {
    claimId,
    to,
    valueAtto: owed.toString(),
    value: attoToGenString(owed.toString()),
    txHash,
    parentTx,
    kind,
    credited: after > before,
    originContract: claimOrigin,
  };
  await recordPayout(row);
  return row;
}
