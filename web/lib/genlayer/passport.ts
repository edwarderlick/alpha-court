import "server-only";
import { mkdirSync, readFileSync, statSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { readClaimRaw } from "./client";
import { studioCanRead, studioNoteError } from "./studio-gate";

export type OnChainPassport = {
  address: string;
  win_count: number;
  loss_count: number;
  category_breakdown: Record<string, { win_count: number; loss_count: number }>;
  claim_history: string[];
};

type CacheFile = {
  byAddress: Record<string, { at: number; passport: OnChainPassport }>;
};

const FILE = join(process.cwd(), ".data", "passports.json");
const FRESH_MS = 10 * 60 * 1000;

let mem: CacheFile | null = null;
let memMtime = 0;

function empty(): CacheFile {
  return { byAddress: {} };
}

function load(): CacheFile {
  try {
    const mtime = statSync(FILE).mtimeMs;
    if (mem && mtime === memMtime) return mem;
    const parsed = JSON.parse(readFileSync(FILE, "utf8")) as CacheFile;
    mem = {
      byAddress:
        parsed.byAddress && typeof parsed.byAddress === "object" ? parsed.byAddress : {},
    };
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

function asPassport(raw: unknown, fallbackAddress: string): OnChainPassport | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Partial<OnChainPassport>;
  const address = typeof row.address === "string" && row.address ? row.address : fallbackAddress;
  return {
    address,
    win_count: Number(row.win_count) || 0,
    loss_count: Number(row.loss_count) || 0,
    category_breakdown:
      row.category_breakdown && typeof row.category_breakdown === "object" ? row.category_breakdown : {},
    claim_history: Array.isArray(row.claim_history) ? row.claim_history.map(String) : [],
  };
}

/** Book-style cache for get_passport. Live Studio read only on miss/stale and only if the gate allows it. */
export async function getPassportCached(address: string): Promise<OnChainPassport | null> {
  const addr = address.trim();
  if (!addr.startsWith("0x") || addr.length < 10) return null;
  const key = addr.toLowerCase();
  const data = load();
  const cached = data.byAddress[key];
  const fresh = cached && Date.now() - cached.at < FRESH_MS;
  if (fresh) return cached.passport;
  if (!studioCanRead()) return cached?.passport ?? null;
  try {
    const raw = await readClaimRaw("get_passport", [addr]);
    const passport = asPassport(raw, addr);
    if (passport) {
      data.byAddress[key] = { at: Date.now(), passport };
      mem = data;
      persist();
    }
    return passport ?? cached?.passport ?? null;
  } catch (err) {
    studioNoteError(err, "read");
    return cached?.passport ?? null;
  }
}
