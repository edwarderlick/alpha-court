import "server-only";
import { attoToGenString } from "./atto";
import { readTransaction } from "./client";
import { currentCourtAddress, originOf } from "../legacy-claim-ids";
import { hashLoad, hashSet, parseField } from "../persist";

export type PayoutTransfer = {
  claimId: string;
  to: string;
  valueAtto: string;
  value: string;
  txHash: string;
  parentTx: string;
  kind: "payout" | "refund";
  credited: boolean;
  originContract?: string;
};

/**
 * Backfills originContract on payout rows written before that field
 * existed. Without a real origin, `t.claimId === "19"` can match a row from
 * a completely different court's own claim #19 -- a real incident (see the
 * claim #19 payout-key-collision investigation this session). The row's
 * txHash is a real on-chain hash, so its real created_at is fetchable and
 * gives an exact answer via the same originOf() cutoff logic every other
 * store uses, rather than a guess. Self-healing: once a row has
 * originContract, it's never re-fetched.
 */
async function migrateOriginlessPayouts(transfers: PayoutTransfer[]): Promise<boolean> {
  let changed = false;
  for (const row of transfers) {
    if (row.originContract) continue;
    try {
      const tx = (await readTransaction(row.txHash)) as { created_at?: string };
      row.originContract = originOf({ claim_id: row.claimId, created_at: tx.created_at }).toLowerCase();
      await upsertTransfer(row);
      changed = true;
    } catch {
      /* real chain read failed transiently; retry on the next load */
    }
  }
  return changed;
}

async function loadTransfers(): Promise<PayoutTransfer[]> {
  const fields = await hashLoad("payouts");
  const transfers: PayoutTransfer[] = [];
  for (const raw of Object.values(fields)) {
    const row = parseField<PayoutTransfer | null>(raw, null);
    if (row?.txHash) transfers.push(row);
  }
  await migrateOriginlessPayouts(transfers);
  return transfers;
}

export async function payoutsFor(
  address: string,
  claimId: string,
  originContract?: string | null
): Promise<PayoutTransfer[]> {
  const addr = address.toLowerCase();
  const originKey = originContract ? originContract.toLowerCase() : "";
  return (await loadTransfers()).filter((t) => {
    if (t.to !== addr || t.claimId !== claimId) return false;
    // Caller didn't ask to scope by origin -- match on claimId alone.
    if (!originKey) return true;
    // Caller DID ask to scope by origin: a row with no known origin (or a
    // different one) is NOT a match. A missing origin used to auto-pass
    // here -- that fail-open behavior is exactly what let an unrelated
    // court's same-numbered claim satisfy an "already paid?" check.
    return (t.originContract ?? "").toLowerCase() === originKey;
  });
}

export async function payoutAddressesForClaim(claimId: string, originContract?: string | null): Promise<string[]> {
  const originKey = originContract ? originContract.toLowerCase() : "";
  const seen = new Set<string>();
  for (const t of await loadTransfers()) {
    if (t.claimId !== claimId) continue;
    if (originKey && (t.originContract ?? "").toLowerCase() !== originKey) continue;
    seen.add(t.to);
  }
  return [...seen];
}

export async function recordPayout(row: PayoutTransfer) {
  await upsertTransfer(row);
}

async function upsertTransfer(row: PayoutTransfer) {
  await hashSet("payouts", row.txHash.toLowerCase(), row);
}

function triggeredHashes(receipt: unknown): string[] {
  const rec = receipt as { triggered_transactions?: unknown };
  const raw = rec?.triggered_transactions;
  if (!Array.isArray(raw)) return [];
  return raw.filter((h): h is string => typeof h === "string" && h.startsWith("0x"));
}

export async function indexTriggeredTransfers(opts: {
  claimId: string;
  parentTx: string;
  receipt: unknown;
  kind: "payout" | "refund";
}) {
  let hashes = triggeredHashes(opts.receipt);
  if (hashes.length === 0 && opts.parentTx) {
    try {
      hashes = triggeredHashes(await readTransaction(opts.parentTx));
    } catch {
      hashes = [];
    }
  }
  for (const hash of hashes) {
    try {
      const tx = (await readTransaction(hash)) as {
        to_address?: string;
        to?: string;
        value?: bigint | string | number;
      };
      const to = (tx.to_address ?? tx.to ?? "").toLowerCase();
      if (!to.startsWith("0x")) continue;
      const valueAtto = tx.value == null ? "0" : String(tx.value);
      // Trail only. credited:true requires a verified native-balance
      // increase in creditResolvedWinners — Studio's value_credited flag
      // has been true on no-op self-sends.
      upsertTransfer({
        claimId: opts.claimId,
        to,
        valueAtto,
        value: attoToGenString(valueAtto),
        txHash: hash,
        parentTx: opts.parentTx,
        kind: opts.kind,
        credited: false,
        originContract: currentCourtAddress() || undefined,
      });
    } catch {
      /* keep going; page will show unindexed rather than a guessed number */
    }
  }
}

/** Flip booked successes that were never a real credit (self-send / NO_MAJORITY). */
export async function reclassifyUnverifiedPayouts(): Promise<number> {
  const transfers = await loadTransfers();
  let flipped = 0;
  let inspected = 0;
  for (const row of transfers) {
    if (!row.credited) continue;
    if (inspected >= 12) break;
    inspected += 1;
    if (!row.txHash?.startsWith("0x")) {
      row.credited = false;
      await upsertTransfer(row);
      flipped += 1;
      continue;
    }
    try {
      const tx = (await readTransaction(row.txHash)) as {
        from_address?: string;
        from?: string;
        to_address?: string;
        to?: string;
        value_credited?: boolean;
        result_name?: string;
      };
      const from = (tx.from_address ?? tx.from ?? "").toLowerCase();
      const to = (tx.to_address ?? tx.to ?? "").toLowerCase();
      // Only a self-send is proof the wallet did not get paid. Studio's
      // value_credited / NO_MAJORITY flags have been true on those no-ops
      // and false on real third-party credits.
      if (from && to && from === to && row.credited) {
        row.credited = false;
        await upsertTransfer(row);
        flipped += 1;
      }
    } catch {
      /* leave until Studio can answer */
    }
  }
  return flipped;
}
