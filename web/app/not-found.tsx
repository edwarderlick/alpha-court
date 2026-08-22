import Link from "next/link";

/** Pre-launch audit: no 404 page existed either -- same gap as error.tsx, for a bad route/id instead of a crash. */
export default function NotFound() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-6 px-gutter text-center bg-background text-on-surface">
      <span className="material-symbols-outlined text-6xl text-on-surface-variant">search_off</span>
      <h1 className="font-display-lg text-display-lg uppercase tracking-tighter">Not found</h1>
      <p className="font-body-md text-body-md text-on-surface-variant max-w-md">
        This claim or page doesn&apos;t exist on the deployed contract.
      </p>
      <Link
        href="/browse-cases"
        className="bg-primary text-on-primary font-label-mono-bold text-label-mono-bold px-6 py-3 rounded-full uppercase"
      >
        Browse Dockets
      </Link>
    </div>
  );
}
