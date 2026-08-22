"use client";

import { useEffect, useState } from "react";

/**
 * Build Prompt 10: no real countdown timer existed anywhere in the merged
 * app or any raw Stitch export -- every "12h 45m" / "14:22:09" seen in
 * case_detail_pro_theme and appeal_flow_pro_theme was static decorative
 * text, not a ticking component (checked: no setInterval/Date.now anywhere
 * in components/ before this file). This is the one real countdown,
 * reused everywhere a countdown is needed (the appeal window here and on
 * the case-detail page) rather than adding a second one.
 */
export function Countdown({ targetIso }: { targetIso: string }) {
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    setNow(Date.now());
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);

  if (now == null) {
    return <span className="text-on-surface-variant">--:--:--</span>;
  }

  const targetMs = new Date(targetIso).getTime();
  const remainingMs = targetMs - now;

  if (remainingMs <= 0) {
    return <span className="text-dispute-red">WINDOW ELAPSED</span>;
  }

  const totalSeconds = Math.floor(remainingMs / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  return (
    <span>
      {days > 0 ? `${days}d ` : ""}
      {String(hours).padStart(2, "0")}:{String(minutes).padStart(2, "0")}:
      {String(seconds).padStart(2, "0")}
    </span>
  );
}
