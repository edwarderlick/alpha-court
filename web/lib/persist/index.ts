import "server-only";

import { mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { Redis } from "@upstash/redis";

/**
 * Shared persistence for the claims book, stake positions, payouts, and
 * passport cache. Production (Vercel) is read-only except /tmp, so this
 * never mkdir's on VERCEL.
 *
 * Redis HASH is the production store: one field write cannot clobber a
 * concurrent stake from another serverless instance. Local `next dev`
 * without Redis still uses .data/ JSON files.
 */
export type StorageKind = "redis" | "disk" | "memory";

export type HashName = "claims" | "payouts" | "stakes" | "passports";

/**
 * Last real hashLoad failure, if any. hashLoad itself still returns `{}`
 * on failure (many pages -- passport, stakes, cases/[id] -- read through
 * it and a hard throw there would turn a cache outage into a 500 on
 * every one of them, not just the route this was diagnosed from). What
 * changed: the failure is no longer swallowed silently. It's logged with
 * the real error, and callers that need to tell "genuinely empty" apart
 * from "storage unreachable" (GET /api/claims is the one that actually
 * needs this) can check getLastRedisError() right after the call that
 * returned `{}` and answer honestly instead of pretending Markets is
 * empty. Cleared on the next successful call.
 */
let lastRedisError: string | null = null;

export function getLastRedisError(): string | null {
  return lastRedisError;
}

const REDIS_HASH: Record<HashName, string> = {
  claims: "ac:claims",
  payouts: "ac:payouts",
  stakes: "ac:stakes",
  passports: "ac:passports",
};

const META_KEY = "ac:book-meta";
const DISK_FILE: Record<HashName, string> = {
  claims: "claims-book.json",
  payouts: "payouts-book.json",
  stakes: "stake-positions.json",
  passports: "passports.json",
};

type RedisEnv = { url: string; token: string };

function redisEnv(): RedisEnv | null {
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
  if (!url || !token) return null;
  return { url, token };
}

let redis: Redis | null | undefined;

export function getRedis(): Redis | null {
  if (redis !== undefined) return redis;
  const env = redisEnv();
  if (!env) {
    redis = null;
    if (process.env.VERCEL) {
      console.error(
        "[persist] Redis is not configured. Vercel cannot write .data/. Set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN."
      );
    }
    return null;
  }
  redis = new Redis({ url: env.url, token: env.token });
  return redis;
}

export function storageKind(): StorageKind {
  if (redisEnv()) return "redis";
  if (process.env.VERCEL) return "memory";
  return "disk";
}

/**
 * storageKind() only checks that UPSTASH_REDIS_REST_URL/TOKEN are SET --
 * it reports "redis" whether or not that host actually answers. That's
 * exactly the gap that let this project's own credit-lock safety check
 * (unsafeSignerWithoutRedis, keeper-safety.ts) stay satisfied with a real
 * signer key configured while the URL pointed at an expired, unresolvable
 * Upstash instance: every real op inside the tick was silently failing,
 * but the guard that exists specifically to refuse an unsafe keeper run
 * never fired, because it only asks "is a URL configured," not "does it
 * work." This is a real network round trip (a GET on a throwaway key,
 * not a write) so callers should use it sparingly -- once per keeper
 * run, not per request.
 */
export async function redisReachable(): Promise<{ ok: boolean; error: string | null }> {
  const r = getRedis();
  if (!r) return { ok: false, error: "not configured" };
  try {
    await r.get("ac:health-check");
    return { ok: true, error: null };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

type Mem = {
  hashes: Record<HashName, Record<string, string>>;
  meta: { refreshedAt: number };
  locks: Map<string, number>;
};

const g = globalThis as unknown as { __acPersist?: Mem };

function mem(): Mem {
  if (!g.__acPersist) {
    g.__acPersist = {
      hashes: { claims: {}, payouts: {}, stakes: {}, passports: {} },
      meta: { refreshedAt: 0 },
      locks: new Map(),
    };
  }
  return g.__acPersist;
}

/**
 * Distributed lock so two genuinely concurrent processes (e.g. the GitHub
 * Actions keeper relay racing a manually-triggered emergency /api/keeper/*
 * call) can't both pass a check-then-act idempotency check at once -- see
 * creditResolvedWinners/creditRefundedStakers, which check "already paid?"
 * before sending, then record the payout row only after the send. Redis
 * `SET NX PX` is atomic server-side. The disk/mem fallback is a plain
 * in-process Map, which is safe because Node is single-threaded and this
 * backend is only ever used by one process (local dev, no Redis configured).
 */
export async function acquireLock(name: string, ttlMs: number): Promise<boolean> {
  const key = `ac:lock:${name}`;
  const r = getRedis();
  if (r) {
    const ok = await r.set(key, "1", { nx: true, px: ttlMs });
    return ok === "OK";
  }
  const locks = mem().locks;
  const now = Date.now();
  const expiresAt = locks.get(key);
  if (expiresAt != null && expiresAt > now) return false;
  locks.set(key, now + ttlMs);
  return true;
}

export async function releaseLock(name: string): Promise<void> {
  const key = `ac:lock:${name}`;
  const r = getRedis();
  if (r) {
    await r.del(key);
    return;
  }
  mem().locks.delete(key);
}

function dataDir() {
  return join(process.cwd(), ".data");
}

function diskPath(name: HashName) {
  return join(dataDir(), DISK_FILE[name]);
}

function parseHash(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== "object") return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (v == null) continue;
    out[k] = typeof v === "string" ? v : JSON.stringify(v);
  }
  return out;
}

function fromDisk(name: HashName): { fields: Record<string, string>; refreshedAt?: number } {
  try {
    const parsed = JSON.parse(readFileSync(diskPath(name), "utf8")) as Record<string, unknown>;
    if (name === "claims") {
      const claims = Array.isArray(parsed.claims) ? parsed.claims : [];
      const fields: Record<string, string> = {};
      for (const c of claims) {
        if (!c || typeof c !== "object") continue;
        const row = c as { claim_id?: string; origin_contract?: string };
        if (!row.claim_id) continue;
        const origin = (row.origin_contract || "").toLowerCase();
        fields[`${origin}::${row.claim_id}`] = JSON.stringify(c);
      }
      return {
        fields,
        refreshedAt: typeof parsed.refreshedAt === "number" ? parsed.refreshedAt : 0,
      };
    }
    if (name === "payouts") {
      const transfers = Array.isArray(parsed.transfers) ? parsed.transfers : [];
      const fields: Record<string, string> = {};
      for (const t of transfers) {
        if (!t || typeof t !== "object") continue;
        const row = t as { txHash?: string };
        if (!row.txHash) continue;
        fields[row.txHash.toLowerCase()] = JSON.stringify(t);
      }
      return { fields };
    }
    if (name === "stakes") {
      const positions =
        parsed.positions && typeof parsed.positions === "object"
          ? (parsed.positions as Record<string, unknown>)
          : {};
      const fields: Record<string, string> = {};
      for (const [k, v] of Object.entries(positions)) {
        fields[k] = typeof v === "string" ? v : JSON.stringify(v);
      }
      return { fields };
    }
    const byAddress =
      parsed.byAddress && typeof parsed.byAddress === "object"
        ? (parsed.byAddress as Record<string, unknown>)
        : {};
    const fields: Record<string, string> = {};
    for (const [k, v] of Object.entries(byAddress)) {
      fields[k] = typeof v === "string" ? v : JSON.stringify(v);
    }
    return { fields };
  } catch {
    return { fields: {}, refreshedAt: 0 };
  }
}

function toDisk(name: HashName, fields: Record<string, string>, refreshedAt: number) {
  if (process.env.VERCEL) {
    throw new Error("[persist] refused disk write on Vercel");
  }
  const file = diskPath(name);
  mkdirSync(dirname(file), { recursive: true });
  if (name === "claims") {
    const claims = Object.values(fields).map((v) => JSON.parse(v));
    writeFileSync(file, JSON.stringify({ refreshedAt, claims }, null, 2));
    return;
  }
  if (name === "payouts") {
    const transfers = Object.values(fields).map((v) => JSON.parse(v));
    writeFileSync(file, JSON.stringify({ transfers }, null, 2));
    return;
  }
  if (name === "stakes") {
    const positions: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(fields)) positions[k] = JSON.parse(v);
    writeFileSync(file, JSON.stringify({ positions }, null, 2));
    return;
  }
  const byAddress: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(fields)) byAddress[k] = JSON.parse(v);
  writeFileSync(file, JSON.stringify({ byAddress }, null, 2));
}

export async function hashLoad(name: HashName): Promise<Record<string, string>> {
  const r = getRedis();
  if (r) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const raw = await Promise.race([
        r.hgetall<Record<string, unknown>>(REDIS_HASH[name]),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error("redis hashLoad timed out after 1000ms")), 1000);
        }),
      ]);
      lastRedisError = null;
      return parseHash(raw);
    } catch (err) {
      // The old version of this catch returned {} with no trace of why --
      // a dead Redis and a genuinely empty hash were indistinguishable,
      // and GET /api/claims reported "cached":true over an outage. Log
      // the real cause and remember it so a caller that cares (the claims
      // route) can tell the difference; every other page keeps working
      // off {} exactly as before -- a cache outage degrading every read
      // path to a hard 500 would be worse than what shipped.
      const detail = err instanceof Error ? err.message : String(err);
      lastRedisError = `hashLoad(${name}) failed: ${detail}`;
      console.error(`[persist] ${lastRedisError}`);
      return {};
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
  if (storageKind() === "disk") {
    const loaded = fromDisk(name);
    mem().hashes[name] = loaded.fields;
    if (name === "claims" && loaded.refreshedAt != null) {
      mem().meta.refreshedAt = loaded.refreshedAt;
    }
    return { ...loaded.fields };
  }
  return { ...mem().hashes[name] };
}

export async function hashSet(name: HashName, field: string, value: unknown): Promise<void> {
  const encoded = typeof value === "string" ? value : JSON.stringify(value);
  const r = getRedis();
  if (r) {
    await r.hset(REDIS_HASH[name], { [field]: encoded });
    return;
  }
  const fields = await hashLoad(name);
  fields[field] = encoded;
  mem().hashes[name] = fields;
  if (storageKind() === "disk") toDisk(name, fields, mem().meta.refreshedAt);
}

export async function hashDelete(name: HashName, field: string): Promise<void> {
  const r = getRedis();
  if (r) {
    await r.hdel(REDIS_HASH[name], field);
    return;
  }
  const fields = await hashLoad(name);
  delete fields[field];
  mem().hashes[name] = fields;
  if (storageKind() === "disk") toDisk(name, fields, mem().meta.refreshedAt);
}

export async function hashReplace(name: HashName, fields: Record<string, unknown>): Promise<void> {
  const encoded: Record<string, string> = {};
  for (const [k, v] of Object.entries(fields)) {
    encoded[k] = typeof v === "string" ? v : JSON.stringify(v);
  }
  const r = getRedis();
  if (r) {
    await r.del(REDIS_HASH[name]);
    if (Object.keys(encoded).length > 0) await r.hset(REDIS_HASH[name], encoded);
    return;
  }
  mem().hashes[name] = encoded;
  if (storageKind() === "disk") toDisk(name, encoded, mem().meta.refreshedAt);
}

export async function metaGet(): Promise<{ refreshedAt: number }> {
  const r = getRedis();
  if (r) {
    const raw = await r.get<{ refreshedAt?: number } | string>(META_KEY);
    if (!raw) return { refreshedAt: 0 };
    if (typeof raw === "string") {
      try {
        const parsed = JSON.parse(raw) as { refreshedAt?: number };
        return { refreshedAt: parsed.refreshedAt ?? 0 };
      } catch {
        return { refreshedAt: 0 };
      }
    }
    return { refreshedAt: raw.refreshedAt ?? 0 };
  }
  if (storageKind() === "disk") {
    return { refreshedAt: fromDisk("claims").refreshedAt ?? 0 };
  }
  return { ...mem().meta };
}

export async function metaSet(refreshedAt: number): Promise<void> {
  const r = getRedis();
  if (r) {
    await r.set(META_KEY, { refreshedAt });
    return;
  }
  mem().meta.refreshedAt = refreshedAt;
  if (storageKind() === "disk") {
    const fields = await hashLoad("claims");
    toDisk("claims", fields, refreshedAt);
  }
}

const LAST_TICK_KEY = "ac:last-tick";
let memLastTick: string | null = null;

/**
 * Last keeper tick result, shared across whichever process asks --
 * the Next.js API route AND the GitHub Actions keeper loop write here.
 * Replaces an in-memory `let lastTick` that lived inside one Vercel
 * isolate: every isolate starts cold with its own copy, so
 * GET /api/keeper/tick read `null` almost always regardless of whether
 * the real keeper (GitHub Actions, not Vercel) was healthy -- a false
 * "keeper looks dead" signal on a keeper that was ticking fine. This
 * uses the same Redis (or disk/mem fallback) the book already uses, so
 * it's real across isolates and across the two processes that actually
 * run ticks.
 */
export async function keeperTickSet(value: unknown): Promise<void> {
  const encoded = JSON.stringify(value);
  const r = getRedis();
  if (r) {
    try {
      await r.set(LAST_TICK_KEY, encoded);
      return;
    } catch (err) {
      console.error(
        `[persist] keeperTickSet failed (in-memory only for this isolate): ${
          err instanceof Error ? err.message : String(err)
        }`
      );
      // Fall through to the in-process copy so a dead Redis doesn't also
      // erase the one signal an operator watching *this* isolate has.
    }
  }
  memLastTick = encoded;
}

export async function keeperTickGet<T>(): Promise<T | null> {
  const r = getRedis();
  if (r) {
    try {
      const raw = await r.get<T | string>(LAST_TICK_KEY);
      if (raw == null) return null;
      if (typeof raw === "string") {
        try {
          return JSON.parse(raw) as T;
        } catch {
          return null;
        }
      }
      return raw;
    } catch (err) {
      console.error(
        `[persist] keeperTickGet failed: ${err instanceof Error ? err.message : String(err)}`
      );
      // Fall through to whatever this isolate has locally rather than
      // reporting "no keeper info" over a storage blip.
    }
  }
  if (!memLastTick) return null;
  try {
    return JSON.parse(memLastTick) as T;
  } catch {
    return null;
  }
}

export function parseField<T>(raw: string | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}
