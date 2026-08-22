"use client";

import { useEffect, useState } from "react";

function parts(targetIso: string, now: number) {
  const remaining = new Date(targetIso).getTime() - now;
  if (!Number.isFinite(remaining) || remaining <= 0) {
    return { done: true, days: "00", hours: "00", minutes: "00", seconds: "00" };
  }
  const total = Math.floor(remaining / 1000);
  return {
    done: false,
    days: String(Math.floor(total / 86400)).padStart(2, "0"),
    hours: String(Math.floor((total % 86400) / 3600)).padStart(2, "0"),
    minutes: String(Math.floor((total % 3600) / 60)).padStart(2, "0"),
    seconds: String(total % 60).padStart(2, "0"),
  };
}

export function LandingClock({
  targetIso,
  tone = "dark",
}: {
  targetIso: string;
  tone?: "dark" | "light" | "purple";
}) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const t = parts(targetIso, now);
  const colon =
    tone === "purple" ? "text-black/30" : tone === "light" ? "text-red-500" : "text-red-500";
  const num = tone === "purple" ? "text-white" : "text-black";
  const label = tone === "purple" ? "text-white/50" : "text-gray-600";

  if (t.done) {
    return <span className={`font-mono text-xs uppercase tracking-widest ${tone === "purple" ? "text-white" : "text-red-500"}`}>Deadline passed</span>;
  }

  return (
    <div>
      <div className={`flex gap-2 font-display text-2xl tracking-wider ${num}`}>
        <div>
          {t.days}
          <span className={colon}>:</span>
        </div>
        <div>
          {t.hours}
          <span className={colon}>:</span>
        </div>
        <div>
          {t.minutes}
          <span className={colon}>:</span>
        </div>
        <div className={tone === "purple" ? "text-white" : "text-red-500"}>{t.seconds}</div>
      </div>
      <div className={`flex gap-4 font-mono text-[8px] uppercase tracking-widest ${label} -mt-1`}>
        <span>Days</span>
        <span>Hours</span>
        <span>Mins</span>
        <span>Secs</span>
      </div>
    </div>
  );
}
