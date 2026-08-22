import { AppShell } from "@/components/AppShell";
import { MarketBoard } from "@/components/MarketBoard";
import { getAllClaimsSafe } from "@/lib/genlayer/claims";

export default async function BrowseCasesPage() {
  const claims = await getAllClaimsSafe();

  return (
    <AppShell activeTop="Markets" activeSide="Markets">
      <div className="px-4 md:px-8 py-8 max-w-7xl mx-auto flex flex-col gap-8">
        <header className="flex flex-col md:flex-row md:items-end justify-between gap-4 border-b border-white/10 pb-6">
          <div>
            <h1 className="font-display text-5xl md:text-7xl text-on-surface uppercase tracking-tight leading-none">
              Markets
            </h1>
            <p className="mt-3 font-mono text-[11px] uppercase tracking-widest text-on-surface-variant">
              Live court plus retired-court history, plus any claims saved on this browser
            </p>
          </div>
        </header>
        <MarketBoard claims={claims} />
      </div>
    </AppShell>
  );
}
