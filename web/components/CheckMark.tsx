"use client";

import { useEffect, useRef, useState } from "react";
import { formatSpotPrice } from "@/lib/markets/catalog";

const STORAGE_PREFIX = "surf-mark-v4:";
const TTL_MS = 90 * 1000;
const inflight = new Map<string, Promise<Quote>>();

type Quote = {
  text: string;
  value: number;
  series?: { t: string; v: number }[];
};

type MarkState =
  | { kind: "idle" }
  | { kind: "cached"; quote: Quote }
  | { kind: "loading"; quote?: Quote }
  | { kind: "done"; quote: Quote }
  | { kind: "error"; message: string };

function cacheKey(asset: string, metric?: string): string {
  return metric ? `${asset}|${metric}` : asset;
}

function readCache(key: string): Quote | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_PREFIX + key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { at: number; quote?: Quote; text?: string };
    if (!parsed || Date.now() - parsed.at > TTL_MS) return null;
    if (parsed.quote?.text && Number.isFinite(parsed.quote.value)) return parsed.quote;
    return null;
  } catch {
    return null;
  }
}

function writeCache(key: string, quote: Quote) {
  try {
    window.localStorage.setItem(STORAGE_PREFIX + key, JSON.stringify({ at: Date.now(), quote }));
  } catch {
    /* private mode */
  }
}

async function fetchMark(asset: string, metric?: string, force = false): Promise<Quote> {
  const key = cacheKey(asset, metric);
  if (!force) {
    const cached = readCache(key);
    if (cached) return cached;
  }
  const existing = inflight.get(key);
  if (existing) return existing;

  const params = new URLSearchParams();
  params.set("asset", asset);
  if (metric) params.set("metric", metric);
  const pending = fetch(`/api/display?${params}`)
    .then(async (res) => {
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error ?? res.statusText);
      const n = metric ? Number(data.value) : Number(data.price);
      if (!Number.isFinite(n)) throw new Error("unrecognized quote");
      const series = Array.isArray(data.series)
        ? (data.series as { t: string; v: number }[]).filter((p) => Number.isFinite(p.v))
        : undefined;
      const quote: Quote = {
        text: formatSpotPrice(n),
        value: n,
        series: series && series.length >= 2 ? series : undefined,
      };
      writeCache(key, quote);
      return quote;
    })
    .finally(() => inflight.delete(key));
  inflight.set(key, pending);
  return pending;
}

function Sparkline({ series }: { series: { t: string; v: number }[] }) {
  const vals = series.map((p) => p.v);
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const span = max - min || 1;
  const w = 160;
  const h = 36;
  const pts = series
    .map((p, i) => {
      const x = (i / (series.length - 1)) * w;
      const y = h - ((p.v - min) / span) * (h - 4) - 2;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="mark-spark" aria-hidden>
      <polyline fill="none" stroke="currentColor" strokeWidth="1.5" points={pts} />
    </svg>
  );
}

function TickValue({ value, text }: { value: number; text: string }) {
  const [shown, setShown] = useState("0");
  const fromRef = useRef(0);

  useEffect(() => {
    const from = fromRef.current;
    const start = performance.now();
    const dur = 700;
    let raf = 0;
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / dur);
      const eased = 1 - Math.pow(1 - t, 3);
      const n = from + (value - from) * eased;
      setShown(formatSpotPrice(n));
      if (t < 1) raf = requestAnimationFrame(step);
      else {
        setShown(text);
        fromRef.current = value;
      }
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value, text]);

  return <span className="mark-tick">{shown}</span>;
}

/**
 * Opt-in Category A quote. Never fires on mount or on picker change.
 * One Surf call per click. Visualization uses only that response.
 */
export function CheckMark({
  asset,
  metric,
  onValue,
}: {
  asset: string;
  metric?: string;
  onValue?: (value: number) => void;
}) {
  const key = cacheKey(asset, metric);
  const [state, setState] = useState<MarkState>({ kind: "idle" });

  useEffect(() => {
    const cached = readCache(key);
    setState(cached ? { kind: "cached", quote: cached } : { kind: "idle" });
  }, [key]);

  async function check() {
    setState((prev) => ({
      kind: "loading",
      quote: prev.kind === "cached" || prev.kind === "done" ? prev.quote : undefined,
    }));
    try {
      const quote = await fetchMark(asset, metric, true);
      setState({ kind: "done", quote });
      onValue?.(quote.value);
    } catch (err) {
      setState({ kind: "error", message: err instanceof Error ? err.message : "unavailable" });
    }
  }

  const quote =
    state.kind === "cached" || state.kind === "done" || state.kind === "loading" ? state.quote : undefined;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-3 min-h-[1.5rem] flex-wrap">
        <button
          type="button"
          onClick={check}
          disabled={state.kind === "loading"}
          className="px-4 py-2 border border-white/15 font-mono text-xs font-bold uppercase tracking-wide text-on-surface-variant hover:border-secondary-fixed hover:text-secondary-fixed disabled:opacity-50 transition-colors"
        >
          {state.kind === "loading" ? "Checking..." : quote ? "Check again" : "Check this mark"}
        </button>
        {state.kind === "error" && (
          <span className="font-mono text-[11px] text-dispute-red">{state.message}</span>
        )}
      </div>
      {quote ? (
        <div className="mark-live border border-secondary-fixed/30 bg-secondary-fixed/5 px-3 py-2 flex items-center gap-3 min-w-0">
          <span className="mark-live-dot" aria-hidden />
          <div className="min-w-0 flex-1">
            <div className="font-mono text-[10px] uppercase tracking-widest text-on-surface-variant">
              {metric ? `${asset} ${metric}` : asset}
            </div>
            <div className="font-mono text-lg text-secondary-fixed leading-none mt-1">
              <TickValue value={quote.value} text={quote.text} />
            </div>
          </div>
          {quote.series ? (
            <Sparkline series={quote.series} />
          ) : (
            <div className="mark-needle" aria-hidden />
          )}
        </div>
      ) : null}
    </div>
  );
}
