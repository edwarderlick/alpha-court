export function OddsBar({
  forTotal,
  againstTotal,
}: {
  forTotal: number;
  againstTotal: number;
}) {
  const total = forTotal + againstTotal;
  const forPct = total > 0 ? (forTotal / total) * 100 : 50;
  const againstPct = 100 - forPct;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex justify-between font-mono text-[11px] uppercase tracking-wider">
        <span className="text-secondary-fixed">For {forPct.toFixed(0)}%</span>
        <span className="text-dispute-red">Against {againstPct.toFixed(0)}%</span>
      </div>
      <div className="h-1.5 w-full bg-surface-container-lowest overflow-hidden flex">
        <div className="h-full bg-secondary-fixed transition-[width] duration-500" style={{ width: `${forPct}%` }} />
        <div className="h-full bg-dispute-red transition-[width] duration-500" style={{ width: `${againstPct}%` }} />
      </div>
      <div className="flex justify-between font-mono text-[10px] text-on-surface-variant">
        <span>{Number.isFinite(forTotal) ? forTotal : 0} GEN</span>
        <span>{Number.isFinite(againstTotal) ? againstTotal : 0} GEN</span>
      </div>
    </div>
  );
}
