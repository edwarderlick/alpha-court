import "server-only";

/**
 * Category A -- display-only Surf reads. TypeScript reimplementation of
 * contract/services/surf_display.py for Build Prompt 10's Step 0 item 2:
 * the frontend is Next.js/TypeScript, the original Category A module is
 * Python, and bridging to it (spawning a Python process, an internal RPC
 * to it, etc.) would be more moving parts for no real benefit -- a plain
 * `fetch` call is the natural shape here, so this reimplements the same
 * three endpoints directly rather than bridging.
 *
 * Structural separation from Category B (contract writes), same rule as
 * the Python original enforces there:
 *   - This is the ONLY file in `web/` that talks to api.asksurf.ai. Nothing
 *     here imports `lib/genlayer/client.ts`, and `lib/genlayer/client.ts`
 *     imports nothing from here -- two disjoint module graphs.
 *   - This file makes ordinary `fetch` calls from a normal Node process --
 *     no GenVM, no `gl.*` symbols, not inside `gl.vm.run_nondet`, no
 *     per-validator multiplier. One HTTP call per asset, same as any
 *     display convenience.
 *   - Every caller of this module is a GET-only API route
 *     (`app/api/display/route.ts`) -- there is no write-capable route
 *     anywhere that imports this file, and no function here ever writes to
 *     the contract or returns something a write call could pass straight
 *     back in as an argument. Results are for on-screen display only.
 */

const SURF_BASE_URL = "https://api.asksurf.ai/gateway/v1";
const SURF_PRICE_PATH = "/market/price";
const SURF_ONCHAIN_INDICATOR_PATH = "/market/onchain-indicator";
const SURF_DEFI_METRICS_PATH = "/project/defi/metrics";

function apiKey(): string {
  const key = process.env.SURF_API_KEY;
  if (!key) throw new Error("SURF_API_KEY is not configured");
  return key;
}

export type DisplayPrice = {
  asset: string;
  price: number;
  source: "surf";
  displayOnly: true;
  /** Only if the same /market/price payload already included a series. */
  series?: { t: string; v: number }[];
};

const PRICE_CACHE_MS = 24 * 60 * 60 * 1000;
const priceCache = new Map<string, { at: number; value: DisplayPrice }>();

export async function getDisplayPrice(asset: string): Promise<DisplayPrice> {
  const cached = priceCache.get(asset);
  if (cached && Date.now() - cached.at < PRICE_CACHE_MS) return cached.value;
  const value = await fetchDisplayPrice(asset);
  priceCache.set(asset, { at: Date.now(), value });
  return value;
}

async function fetchDisplayPrice(asset: string): Promise<DisplayPrice> {
  const url = new URL(SURF_BASE_URL + SURF_PRICE_PATH);
  url.searchParams.set("symbol", asset);
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${apiKey()}` },
  });
  if (!res.ok) throw new Error(`Surf price fetch failed: ${res.status}`);
  const payload = await res.json();
  const data = Array.isArray(payload?.data)
    ? payload.data[0]
    : (payload?.data ?? payload);

  if (!data || typeof data !== "object") {
    throw new Error("Unrecognized Surf response shape");
  }
  const rec = data as Record<string, unknown>;
  const series = extractEmbeddedSeries(rec);
  for (const key of ["price", "value", "last", "spot_price", "close"]) {
    if (key in rec) {
      return {
        asset,
        price: Number(rec[key]),
        source: "surf",
        displayOnly: true,
        ...(series ? { series } : {}),
      };
    }
  }
  throw new Error("Unrecognized Surf price response shape");
}

function extractEmbeddedSeries(data: Record<string, unknown>): { t: string; v: number }[] | undefined {
  for (const key of ["history", "prices", "series", "sparkline", "points", "klines"]) {
    const raw = data[key];
    if (!Array.isArray(raw) || raw.length < 2) continue;
    const out: { t: string; v: number }[] = [];
    for (const item of raw) {
      if (typeof item === "number" && Number.isFinite(item)) {
        out.push({ t: String(out.length), v: item });
        continue;
      }
      if (item && typeof item === "object") {
        const o = item as Record<string, unknown>;
        const v = Number(o.price ?? o.value ?? o.close ?? o[1]);
        if (!Number.isFinite(v)) continue;
        out.push({ t: String(o.timestamp ?? o.t ?? o.time ?? out.length), v });
      }
    }
    if (out.length >= 2) return out.slice(-24);
  }
  return undefined;
}



export type DisplayFundamentals = {
  asset: string;
  metric: string;
  value: number;
  asOf: string;
  source: "surf";
  displayOnly: true;
  /** From the same Surf response as `value`. Not a second call. */
  series?: { t: string; v: number }[];
};

const FUNDAMENTALS_METRIC_TVL = "TVL";
const fundamentalsCache = new Map<string, { at: number; value: DisplayFundamentals }>();

export async function getFundamentalsDisplay(
  asset: string,
  metric: string
): Promise<DisplayFundamentals> {
  const cacheKey = `${asset}:${metric}`;
  const cached = fundamentalsCache.get(cacheKey);
  if (cached && Date.now() - cached.at < PRICE_CACHE_MS) return cached.value;

  const url = new URL(
    metric === FUNDAMENTALS_METRIC_TVL
      ? SURF_BASE_URL + SURF_DEFI_METRICS_PATH
      : SURF_BASE_URL + SURF_ONCHAIN_INDICATOR_PATH
  );
  if (metric === FUNDAMENTALS_METRIC_TVL) {
    url.searchParams.set("q", asset);
    url.searchParams.set("metric", "tvl");
  } else {
    url.searchParams.set("symbol", asset);
    url.searchParams.set("metric", metric.toLowerCase());
  }

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${apiKey()}` },
  });
  if (!res.ok) throw new Error(`Surf fundamentals fetch failed: ${res.status}`);
  const payload = await res.json();
  const points: unknown[] = Array.isArray(payload?.data) ? payload.data : [];
  if (points.length === 0) {
    throw new Error("Unrecognized fundamentals response shape: no data points");
  }

  let best: { value: number; timestamp: string } | null = null;
  const series: { t: string; v: number }[] = [];
  for (const point of points) {
    if (
      typeof point === "object" &&
      point !== null &&
      "value" in point &&
      "timestamp" in point
    ) {
      const p = point as { value: number; timestamp: string };
      const v = Number(p.value);
      if (!Number.isFinite(v)) continue;
      series.push({ t: p.timestamp, v });
      if (!best || p.timestamp > best.timestamp) best = p;
    }
  }
  if (!best) throw new Error("Unrecognized fundamentals response shape: no valid data points");
  series.sort((a, b) => (a.t < b.t ? -1 : a.t > b.t ? 1 : 0));

  const value = {
    asset,
    metric,
    value: Number(best.value),
    asOf: best.timestamp,
    source: "surf" as const,
    displayOnly: true as const,
    series: series.slice(-24),
  };
  fundamentalsCache.set(cacheKey, { at: Date.now(), value });
  return value;
}
