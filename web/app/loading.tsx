/**
 * Real incident: a real navigation (clicking "View on Browse Dockets"
 * after a successful create_claim) took 71.8s under real rate-limit
 * pressure from this project's own testing -- the retry logic (Build
 * Prompt 12) correctly kept trying and the navigation DID complete, but
 * with zero loading feedback it looked identical to "the link is
 * broken" from the user's seat (confirmed: that's exactly what got
 * reported). Next.js shows this automatically during any route
 * transition where the destination segment's data fetch hasn't resolved
 * yet -- no per-page wiring needed.
 */
export default function Loading() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-4 bg-background text-on-surface">
      <div className="w-10 h-10 border-2 border-white/20 border-t-primary rounded-full animate-spin" />
      <p className="font-label-mono-sm text-label-mono-sm text-on-surface-variant uppercase tracking-widest">
        Loading real data from Studio...
      </p>
    </div>
  );
}
