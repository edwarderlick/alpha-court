"use client";

import { useState } from "react";
import { assetVisual } from "@/lib/markets/catalog";

export function AssetMark({
  symbol,
  size = 32,
  title,
}: {
  symbol: string | null | undefined;
  size?: number;
  title?: string;
}) {
  const visual = assetVisual(symbol ?? "");
  const [failed, setFailed] = useState(0);
  const src = visual.icons[failed];

  if (!src) {
    return (
      <span
        title={title ?? visual.name}
        className="inline-flex items-center justify-center rounded-full bg-surface-container-highest text-on-surface font-mono font-bold shrink-0"
        style={{ width: size, height: size, fontSize: Math.max(10, size * 0.38) }}
      >
        {visual.ticker.slice(0, 1)}
      </span>
    );
  }

  return (
    <img
      src={src}
      alt={visual.ticker}
      title={title ?? visual.name}
      width={size}
      height={size}
      className="rounded-full bg-white shrink-0 object-contain"
      style={{ width: size, height: size }}
      onError={() => setFailed((n) => n + 1)}
    />
  );
}

export function AssetPairMark({
  a,
  b,
  size = 36,
}: {
  a: string;
  b?: string | null;
  size?: number;
}) {
  if (!b) return <AssetMark symbol={a} size={size} />;
  return (
    <span className="relative inline-flex shrink-0" style={{ width: size * 1.55, height: size }}>
      <span className="absolute left-0 top-0 z-10">
        <AssetMark symbol={a} size={size} />
      </span>
      <span className="absolute right-0 top-0">
        <AssetMark symbol={b} size={size} />
      </span>
    </span>
  );
}
