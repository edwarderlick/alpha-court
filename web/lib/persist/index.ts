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

type Mem = {
  hashes: Record<HashName, Record<string, string>>;
  meta: { refreshedAt: number };
};

const g = globalThis as unknown as { __acPersist?: Mem };

function mem(): Mem {
  if (!g.__acPersist) {
    g.__acPersist = {
      hashes: { claims: {}, payouts: {}, stakes: {}, passports: {} },
      meta: { refreshedAt: 0 },
    };
  }
  return g.__acPersist;
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
    const raw = await r.hgetall<Record<string, unknown>>(REDIS_HASH[name]);
    return parseHash(raw);
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

export function parseField<T>(raw: string | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}
