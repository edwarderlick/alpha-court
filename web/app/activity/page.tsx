import { AppShell } from "@/components/AppShell";
import { ActivityBoard } from "@/components/ActivityBoard";
import { MyActivity } from "@/components/MyActivity";
import { getAllClaimsSafe } from "@/lib/genlayer/claims";

export default async function ActivityPage() {
  const claims = await getAllClaimsSafe();

  return (
    <AppShell activeTop="Activity" activeSide="Activity">
      <div className="px-5 md:px-8 py-6 md:py-8">
        <MyActivity />
        <header className="flex flex-col md:flex-row md:items-end justify-between gap-3 mb-2">
          <h1 className="font-display text-4xl md:text-6xl text-primary uppercase tracking-tight leading-none">
            Live Verdicts
          </h1>
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 bg-secondary-fixed rounded-full animate-pulse" />
            <span className="font-mono text-sm font-bold text-on-surface-variant uppercase tracking-wide">
              Local book + chain snapshot
            </span>
          </div>
        </header>
        <ActivityBoard claims={claims} />
      </div>
    </AppShell>
  );
}
