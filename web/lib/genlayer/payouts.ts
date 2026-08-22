import "server-only";
import { mkdirSync, readFileSync, statSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { attoToGenString } from "./atto";
import { readTransaction } from "./client";
import { currentCourtAddress } from "../legacy-claim-ids";

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

type File = { transfers: PayoutTransfer[] };

const FILE = join(process.cwd(), ".data", "payouts-book.json");

let mem: File | null = null;
let memMtime = 0;

function empty(): File {
  return { transfers: [] };
}

function load(): File {
  try {
    const mtime = statSync(FILE).mtimeMs;
    if (mem && mtime === memMtime) return mem;
    const parsed = JSON.parse(readFileSync(FILE, "utf8")) as File;
    mem = { transfers: Array.isArray(parsed.transfers) ? parsed.transfers : [] };
    memMtime = mtime;
    return mem;
  } catch {
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

export function payoutsFor(
  address: string,
  claimId: string,
  originContract?: string | null
): PayoutTransfer[] {
  const addr = address.toLowerCase();
  const originKey = originContract ? originContract.toLowerCase() : "";
  return load().transfers.filter((t) => {
    if (t.to !== addr || t.claimId !== claimId) return false;
    if (!originKey || !t.originContract) return true;
    return t.originContract.toLowerCase() === originKey;
  });
}

export function payoutAddressesForClaim(claimId: string): string[] {
  const seen = new Set<string>();
  for (const t of load().transfers) {
    if (t.claimId === claimId) seen.add(t.to);
  }
  return [...seen];
}

export function recordPayout(row: PayoutTransfer) {
  upsertTransfer(row);
}

function upsertTransfer(row: PayoutTransfer) {
  const data = load();
  data.transfers = [
    row,
    ...data.transfers.filter((t) => t.txHash.toLowerCase() !== row.txHash.toLowerCase()),
  ];
  mem = data;
  persist();
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
  const data = load();
  let flipped = 0;
  let inspected = 0;
  for (const row of data.transfers) {
    if (!row.credited) continue;
    if (inspected >= 12) break;
    inspected += 1;
    if (!row.txHash?.startsWith("0x")) {
      row.credited = false;
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
        flipped += 1;
      }
    } catch {
      /* leave until Studio can answer */
    }
  }
  if (flipped > 0) {
    mem = data;
    persist();
  }
  return flipped;
}
