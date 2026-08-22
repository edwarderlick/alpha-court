"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { SPOT_ASSETS, type SpotAsset } from "@/lib/markets/catalog";
import { AssetMark } from "./AssetMark";

const QUICK = ["BTC/USD", "ETH/USD", "SOL/USD", "DOGE/USD", "SUI/USD"];

export function AssetPicker({
  value,
  onChange,
  disabled,
  exclude,
  label,
}: {
  value: string;
  onChange: (symbol: string) => void;
  disabled?: boolean;
  exclude?: string;
  label?: string;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const selected = SPOT_ASSETS.find((a) => a.symbol === value);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return SPOT_ASSETS.filter((a) => {
      if (exclude && a.symbol === exclude) return false;
      if (!q) return true;
      return a.symbol.toLowerCase().includes(q) || a.name.toLowerCase().includes(q) || a.ticker.toLowerCase().includes(q);
    });
  }, [query, exclude]);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function pick(asset: SpotAsset) {
    onChange(asset.symbol);
    setQuery("");
    setOpen(false);
  }

  return (
    <div ref={rootRef} className="flex flex-col gap-3">
      {label && (
        <span className="font-mono text-xs uppercase tracking-wider text-on-surface-variant">{label}</span>
      )}
      <div className="flex flex-wrap gap-2">
        {QUICK.filter((s) => s !== exclude).map((symbol) => {
          const asset = SPOT_ASSETS.find((a) => a.symbol === symbol);
          if (!asset) return null;
          const active = value === symbol;
          return (
            <button
              key={symbol}
              type="button"
              disabled={disabled}
              suppressHydrationWarning
              onClick={() => {
                onChange(symbol);
                setOpen(false);
              }}
              className={`px-3 py-2 font-mono text-sm font-bold uppercase tracking-wide transition-all duration-200 active:scale-[0.98] disabled:opacity-50 inline-flex items-center gap-2 ${
                active
                  ? "bg-secondary-fixed text-on-secondary-fixed"
                  : "bg-surface-container text-on-surface-variant hover:text-on-surface hover:border-white/20 border border-white/10"
              }`}
            >
              <AssetMark symbol={asset.symbol} size={20} />
              {asset.ticker}
            </button>
          );
        })}
      </div>
      <button
        type="button"
        disabled={disabled}
        suppressHydrationWarning
        onClick={() => setOpen((o) => !o)}
        className="w-full bg-surface-container border border-white/10 px-5 py-4 text-left flex items-center justify-between disabled:opacity-60 hover:border-secondary-fixed/50 transition-colors duration-200"
      >
        <span className="flex items-center gap-3 min-w-0">
          <AssetMark symbol={value} size={32} />
          <span className="flex flex-col gap-0.5 min-w-0">
            <span className="font-mono text-lg text-on-surface">{selected?.ticker ?? value}</span>
            <span className="font-mono text-xs text-on-surface-variant uppercase">{selected?.name ?? "Custom pair"}</span>
          </span>
        </span>
        <span className="material-symbols-outlined text-on-surface-variant">{open ? "expand_less" : "expand_more"}</span>
      </button>
      {open && !disabled && (
        <div className="bg-surface-container-lowest border border-white/10 flex flex-col max-h-56">
          <input
            autoFocus
            value={query}
            suppressHydrationWarning
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search BTC, ETH, Solana..."
            className="bg-surface-container border-0 border-b border-white/10 px-5 py-3 text-on-surface font-mono text-base focus:ring-0"
          />
          <div className="overflow-y-auto">
            {filtered.length === 0 && (
              <p className="px-5 py-6 font-mono text-sm text-on-surface-variant">No matching pair</p>
            )}
            {filtered.map((asset) => (
              <button
                key={asset.symbol}
                type="button"
                suppressHydrationWarning
                onClick={() => pick(asset)}
                className={`w-full px-5 py-3 flex items-center justify-between hover:bg-surface-container-high transition-colors ${
                  asset.symbol === value ? "bg-surface-container" : ""
                }`}
              >
                <span className="flex items-center gap-3">
                  <AssetMark symbol={asset.symbol} size={28} />
                  <span className="flex flex-col items-start">
                    <span className="font-mono text-base text-on-surface">{asset.ticker}</span>
                    <span className="font-mono text-xs text-on-surface-variant uppercase">{asset.name}</span>
                  </span>
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
