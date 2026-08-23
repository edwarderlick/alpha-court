import "server-only";
import { bookAll, bookGet } from "./book";
import { readClaimRaw } from "./client";
import { studioCanRead, studioNoteError } from "./studio-gate";
import { isOnChainClaimId, type ClaimSummary } from "./claim-display";
import {
  claimRowKey,
  currentCourtAddress,
  isLegacyClaim,
  originOf,
} from "../legacy-claim-ids";
import { attoToGenString } from "./atto";
import { mapPool } from "./pool";
import { payoutAddressesForClaim, payoutsFor, type PayoutTransfer } from "./payouts";
import { hashLoad, hashReplace, hashSet, parseField } from "../persist";

export type StakeRow = {
  claim_id: string;
  title: string;
  asset: string;
  asset_b: string | null;
  side: "for" | "against";
  amount: string;
  amountAtto: string;
  state: string;
  consensus_result: string;
  outcome: "pending" | "won" | "lost" | "refunded";
  payout: string | null;
  payoutAtto: string | null;
  payoutTx: string | null;
  payoutKind: PayoutTransfer["kind"] | null;
  origin_contract?: string;
  created_at?: string;
};

type PosCache = {
  positions: Record<string, { amountAtto: string; at: number; terminal: boolean }>;
};

const OPEN_TTL_MS = 2 * 60 * 1000;

async function loadPos(): Promise<PosCache> {
  const fields = await hashLoad("stakes");
  const positions: PosCache["positions"] = {};
  for (const [key, raw] of Object.entries(fields)) {
    const row = parseField<PosCache["positions"][string] | null>(raw, null);
    if (row) positions[key] = row;
  }
  return { positions };
}

async function persistPos(data: PosCache) {
  await hashReplace("stakes", data.positions);
}

export function posKey(
  address: string,
  claimId: string,
  side: "for" | "against",
  originContract?: string | null
) {
  const origin = (originContract || currentCourtAddress()).toLowerCase();
  return `${address.toLowerCase()}|${origin}|${claimId}|${side}`;
}

export function parsePosKey(
  key: string
): { addr: string; origin: string | null; id: string; side: "for" | "against" } | null {
  if (key.includes("|")) {
    const [addr, origin, id, side] = key.split("|");
    if (!addr || !id || (side !== "for" && side !== "against")) return null;
    return { addr, origin: origin || null, id, side };
  }
  const parts = key.split(":");
  if (parts.length < 3) return null;
  const side = parts[parts.length - 1];
  const id = parts[parts.length - 2];
  const addr = parts.slice(0, -2).join(":");
  if (side !== "for" && side !== "against") return null;
  return { addr, origin: null, id, side };
}

function inferOrigin(
  claims: ClaimSummary[],
  claimId: string,
  observedAt: number | null | undefined
): string {
  const matches = claims.filter((c) => c.claim_id === claimId);
  if (matches.length === 1) return originOf(matches[0]).toLowerCase();
  if (matches.length > 1) {
    const live = matches.find((c) => !isLegacyClaim(c));
    const legacy = matches.find((c) => isLegacyClaim(c));
    const liveCreated = live?.created_at ? Date.parse(live.created_at) : Number.NaN;
    if (live && Number.isFinite(liveCreated) && observedAt && observedAt >= liveCreated - 60_000) {
      return originOf(live).toLowerCase();
    }
    if (legacy) return originOf(legacy).toLowerCase();
    if (live) return originOf(live).toLowerCase();
  }
  return originOf({
    claim_id: claimId,
    created_at: observedAt ? new Date(observedAt).toISOString() : undefined,
  }).toLowerCase();
}

function migratePos(cache: PosCache, claims: ClaimSummary[]): boolean {
  let changed = false;
  const next: PosCache["positions"] = {};
  for (const [key, row] of Object.entries(cache.positions)) {
    const parsed = parsePosKey(key);
    if (!parsed) {
      next[key] = row;
      continue;
    }
    const origin = parsed.origin || inferOrigin(claims, parsed.id, row.at);
    const migrated = posKey(parsed.addr, parsed.id, parsed.side, origin);
    if (migrated !== key) changed = true;
    const prev = next[migrated];
    next[migrated] =
      prev && prev.amountAtto !== "0" && row.amountAtto !== "0"
        ? { ...row, amountAtto: (BigInt(prev.amountAtto) + BigInt(row.amountAtto)).toString() }
        : row;
  }
  if (changed) cache.positions = next;
  return changed;
}

async function positions(): Promise<PosCache> {
  const cache = await loadPos();
  const claims = await bookAll();
  if (migratePos(cache, claims)) await persistPos(cache);
  return cache;
}

export async function allStakePositions(): Promise<PosCache> {
  return positions();
}

function toAttoString(raw: unknown): string {
  if (typeof raw === "bigint") return raw.toString();
  if (typeof raw === "number" && Number.isFinite(raw)) return BigInt(Math.trunc(raw)).toString();
  if (typeof raw === "string" && raw.trim() !== "") return BigInt(raw.trim()).toString();
  return "0";
}

function isTerminal(state: string) {
  return state === "RESOLVED" || state === "REFUNDED";
}

function winningSide(consensus: string): "for" | "against" | null {
  if (consensus === "HELD") return "for";
  if (consensus === "BROKEN") return "against";
  return null;
}

function claimTitle(claim: ClaimSummary): string {
  if (claim.claim_type === "RELATIVE_PERFORMANCE") return `${claim.asset} vs ${claim.asset_b ?? "?"}`;
  if (claim.claim_type === "FUNDAMENTALS_THRESHOLD") {
    return `${claim.metric ?? "metric"} (${claim.asset}) ${claim.direction} ${claim.threshold}`.trim();
  }
  return `${claim.asset} ${claim.direction} ${claim.threshold}`.trim();
}

async function readStakeAtto(claimId: string, side: "for" | "against", address: string): Promise<string> {
  const raw = await readClaimRaw("get_stake", [claimId, side, address], { bypass: true });
  return toAttoString(raw);
}

async function buildRow(
  addr: string,
  claim: ClaimSummary,
  side: "for" | "against",
  amountAtto: string
): Promise<StakeRow | null> {
  if (!amountAtto || amountAtto === "0") return null;
  const transfers = await payoutsFor(addr, claim.claim_id, claim.origin_contract);
  const winner = winningSide(claim.consensus_result);
  let outcome: StakeRow["outcome"] = "pending";
  if (claim.state === "REFUNDED") outcome = "refunded";
  else if (claim.state === "RESOLVED" && winner) {
    outcome = winner === side ? "won" : "lost";
  }
  const payoutRow =
    outcome === "won"
      ? transfers.find((t) => t.kind === "payout") ?? null
      : outcome === "refunded"
        ? transfers.find((t) => t.kind === "refund") ?? null
        : null;
  const credited = payoutRow?.credited === true;
  return {
    claim_id: claim.claim_id,
    title: claimTitle(claim),
    asset: claim.asset,
    asset_b: claim.asset_b,
    side,
    amount: attoToGenString(amountAtto),
    amountAtto,
    state: claim.state,
    consensus_result: claim.consensus_result,
    outcome,
    payout: outcome === "lost" ? "0" : credited ? payoutRow?.value ?? null : null,
    payoutAtto: outcome === "lost" ? "0" : credited ? payoutRow?.valueAtto ?? null : null,
    payoutTx: payoutRow?.txHash ?? null,
    payoutKind: payoutRow?.kind ?? null,
    origin_contract: claim.origin_contract,
    created_at: claim.created_at,
  };
}

/** Same won/lost/payout rules as stakesForAddress, from the position cache + book. No RPC. */
export async function stakeRowsFromCache(address: string): Promise<StakeRow[]> {
  const addr = address.toLowerCase();
  if (!addr.startsWith("0x") || addr.length < 10) return [];
  const cache = await positions();
  const all = await bookAll();
  const claims = new Map(all.map((c) => [claimRowKey(c), c]));
  const rows: StakeRow[] = [];
  for (const [key, pos] of Object.entries(cache.positions)) {
    const parsed = parsePosKey(key);
    if (!parsed || parsed.addr !== addr || pos.amountAtto === "0") continue;
    if (parsed.side !== "for" && parsed.side !== "against") continue;
    const origin = parsed.origin || inferOrigin(all, parsed.id, pos.at);
    const claim = claims.get(`${origin}::${parsed.id}`) ?? (await bookGet(parsed.id, { origin }));
    if (!claim) continue;
    const row = await buildRow(addr, claim, parsed.side, pos.amountAtto);
    if (row) rows.push(row);
  }
  rows.sort((a, b) => {
    const id = Number(b.claim_id) - Number(a.claim_id);
    if (id !== 0) return id;
    return isLegacyClaim(a) === isLegacyClaim(b) ? 0 : isLegacyClaim(a) ? 1 : -1;
  });
  return rows;
}

export async function stakesForAddress(address: string): Promise<StakeRow[]> {
  const addr = address.toLowerCase();
  if (!addr.startsWith("0x") || addr.length < 10) return [];

  const claims = (await bookAll())
    .filter((c) => isOnChainClaimId(c.claim_id))
    .filter((c) => (parseFloat(c.stake_for_total) || 0) + (parseFloat(c.stake_against_total) || 0) > 0)
    .slice(0, 24);

  const cache = await positions();
  const now = Date.now();
  const canRead = studioCanRead();
  const rows: StakeRow[] = [];

  await mapPool(claims, 2, async (claim) => {
    for (const side of ["for", "against"] as const) {
      const key = posKey(addr, claim.claim_id, side, claim.origin_contract);
      const cached = cache.positions[key];
      let amountAtto: string | null = null;
      const cacheOk = cached && (cached.terminal || now - cached.at < OPEN_TTL_MS);
      if (cacheOk) amountAtto = cached.amountAtto;
      else if (canRead) {
        try {
          amountAtto = await readStakeAtto(claim.claim_id, side, addr);
          cache.positions[key] = {
            amountAtto,
            at: now,
            terminal: isTerminal(claim.state),
          };
        } catch (err) {
          studioNoteError(err, "read");
          amountAtto = cached?.amountAtto ?? null;
        }
      } else {
        amountAtto = cached?.amountAtto ?? null;
      }
      const row = amountAtto ? await buildRow(addr, claim, side, amountAtto) : null;
      if (row) rows.push(row);
    }
  });

  await persistPos(cache);
  rows.sort((a, b) => Number(b.claim_id) - Number(a.claim_id));
  return rows;
}

export type StakeRecord = {
  wins: number;
  losses: number;
  pending: number;
  winRatePct: number | null;
};

/** Same won/lost rules as stakesForAddress, from the position cache + book. No extra RPC. */
export async function stakeRecordFromCache(address: string): Promise<StakeRecord> {
  const addr = address.toLowerCase();
  const cache = await positions();
  const all = await bookAll();
  const claims = new Map(all.map((c) => [claimRowKey(c), c]));
  let wins = 0;
  let losses = 0;
  let pending = 0;
  for (const [key, pos] of Object.entries(cache.positions)) {
    const parsed = parsePosKey(key);
    if (!parsed || parsed.addr !== addr || pos.amountAtto === "0") continue;
    const origin = parsed.origin || inferOrigin(all, parsed.id, pos.at);
    const claim = claims.get(`${origin}::${parsed.id}`) ?? (await bookGet(parsed.id, { origin }));
    if (!claim) continue;
    const side = parsed.side;
    if (claim.state === "REFUNDED") continue;
    const winner = winningSide(claim.consensus_result);
    if (claim.state === "RESOLVED" && winner) {
      if (winner === side) wins += 1;
      else losses += 1;
    } else {
      pending += 1;
    }
  }
  const decided = wins + losses;
  return {
    wins,
    losses,
    pending,
    winRatePct: decided === 0 ? null : Math.round((wins / decided) * 100),
  };
}

export async function rememberStakePosition(opts: {
  address: string;
  claimId: string;
  side: "for" | "against";
  amountAtto: string;
  terminal?: boolean;
  stakedAt?: number;
  originContract?: string | null;
}) {
  const origin = opts.originContract || currentCourtAddress();
  const key = posKey(opts.address, opts.claimId, opts.side, origin);
  const cache = await positions();
  const prev = cache.positions[key];
  const nextAtto =
    prev && prev.amountAtto !== "0"
      ? (BigInt(prev.amountAtto) + BigInt(opts.amountAtto || "0")).toString()
      : opts.amountAtto;
  const row = {
    amountAtto: nextAtto,
    at: opts.stakedAt ?? Date.now(),
    terminal: opts.terminal ?? false,
  };
  cache.positions[key] = row;
  await hashSet("stakes", key, row);
}

export type ClaimStaker = {
  address: string;
  side: "for" | "against";
  amount: string;
  amountAtto: string;
  stakedAt: number | null;
  stakedAtSource: "claim" | "observed";
  wins: number;
  losses: number;
  winRatePct: number | null;
  won: boolean;
};

export async function stakersForClaim(
  claimId: string,
  opts?: { preferLegacy?: boolean }
): Promise<{
  stakers: ClaimStaker[];
  winningSide: "for" | "against" | null;
}> {
  const claim = (await bookGet(claimId, { preferLegacy: opts?.preferLegacy })) ?? null;
  const winner = claim ? winningSide(claim.consensus_result) : null;
  const claimOrigin = claim ? originOf(claim).toLowerCase() : currentCourtAddress();
  const candidates = new Set<string>();
  if (claim?.poster) candidates.add(claim.poster.toLowerCase());
  for (const addr of await payoutAddressesForClaim(claimId)) candidates.add(addr);
  const cache = await positions();
  const allClaims = await bookAll();
  for (const [key, row] of Object.entries(cache.positions)) {
    const parsed = parsePosKey(key);
    if (!parsed || parsed.id !== claimId || row.amountAtto === "0") continue;
    const origin = parsed.origin || inferOrigin(allClaims, parsed.id, row.at);
    if (origin !== claimOrigin) continue;
    candidates.add(parsed.addr);
  }

  const canRead = studioCanRead();
  const now = Date.now();
  const stakers: ClaimStaker[] = [];
  const hasCache = Object.keys(cache.positions).some((key) => {
    const parsed = parsePosKey(key);
    if (!parsed || parsed.id !== claimId || cache.positions[key].amountAtto === "0") return false;
    const origin = parsed.origin || inferOrigin(allClaims, parsed.id, cache.positions[key].at);
    return origin === claimOrigin;
  });
  const skipLive = hasCache || isLegacyClaim(claim) || !canRead;

  await mapPool([...candidates], 2, async (addr) => {
    for (const side of ["for", "against"] as const) {
      const key = posKey(addr, claimId, side, claimOrigin);
      const cached = cache.positions[key];
      let amountAtto: string | null = null;
      const cacheOk = cached && (cached.terminal || now - cached.at < OPEN_TTL_MS || skipLive);
      if (cacheOk) amountAtto = cached.amountAtto;
      else if (!skipLive && canRead) {
        try {
          amountAtto = await readStakeAtto(claimId, side, addr);
          cache.positions[key] = {
            amountAtto,
            at: cached?.at ?? now,
            terminal: claim ? isTerminal(claim.state) : false,
          };
        } catch (err) {
          studioNoteError(err, "read");
          amountAtto = cached?.amountAtto ?? null;
        }
      } else {
        amountAtto = cached?.amountAtto ?? null;
      }
      if (!amountAtto || amountAtto === "0") continue;
      const rec = await stakeRecordFromCache(addr);
      const observed = cache.positions[key]?.at ?? null;
      const fromCreate =
        claim && side === "for" && claim.poster && claim.poster.toLowerCase() === addr
          ? new Date(claim.created_at).getTime()
          : null;
      const stakedAt = Number.isFinite(fromCreate) ? fromCreate : observed;
      stakers.push({
        address: addr,
        side,
        amount: attoToGenString(amountAtto),
        amountAtto,
        stakedAt: Number.isFinite(stakedAt) ? stakedAt : null,
        stakedAtSource: fromCreate && Number.isFinite(fromCreate) ? "claim" : "observed",
        wins: rec.wins,
        losses: rec.losses,
        winRatePct: rec.winRatePct,
        won: Boolean(winner && winner === side && claim?.state === "RESOLVED"),
      });
    }
  });

  await persistPos(cache);
  stakers.sort((a, b) => Number(BigInt(b.amountAtto) - BigInt(a.amountAtto)));
  return { stakers, winningSide: winner };
}
