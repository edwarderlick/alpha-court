"use client";

import { useEffect } from "react";
import Link from "next/link";

/**
 * Pre-launch audit finding: no error boundary existed anywhere in the app
 * before this. Confirmed for real, not hypothetical -- visiting
 * /cases/999 (a claim id that doesn't exist) crashed straight to Next's
 * raw default error page (`id="__next_error__"`, no app chrome, no
 * explanation) instead of anything a real visitor could make sense of.
 * Every Server Component page in this app (browse-cases, cases/[id],
 * alpha-passport, activity, my-claims, leaderboard) reads directly from
 * `lib/genlayer/client.ts`, which this session's own testing has hit real
 * transient failures from more than once (Studio rate limits, connect
 * timeouts, an HTML error page instead of JSON) -- this is the catch-all
 * for any of those reaching render, not just a theoretical safety net.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Real detail stays server-side only -- never shown to the visitor.
    console.error(error);
  }, [error]);

  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-6 px-gutter text-center bg-background text-on-surface">
      <span className="material-symbols-outlined text-6xl text-dispute-red">error</span>
      <h1 className="font-display-lg text-display-lg uppercase tracking-tighter">
        Something went wrong
      </h1>
      <p className="font-body-md text-body-md text-on-surface-variant max-w-md">
        {/rate limit|500 requests/i.test(error.message)
          ? "GenLayer Studio hit its hourly read cap. You do not need to wait a full hour. Open Home. The landing still runs without live chain reads."
          : "This can happen when the Studio network is briefly unavailable or under load. Try again, or head back to the dashboard."}
      </p>
      <div className="flex gap-4">
        <button
          onClick={reset}
          className="bg-primary text-on-primary font-label-mono-bold text-label-mono-bold px-6 py-3 rounded-full uppercase"
        >
          Try again
        </button>
        <Link
          href="/browse-cases"
          className="border border-white/20 text-on-surface font-label-mono-bold text-label-mono-bold px-6 py-3 rounded-full uppercase"
        >
          Browse Dockets
        </Link>
      </div>
    </div>
  );
}
