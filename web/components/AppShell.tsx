"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { WalletChip } from "./WalletChip";
import { OperatorCard } from "./OperatorCard";
import { useDockPing } from "./MarketPulseHost";
import { AlphaMark } from "./AlphaMark";

const TOP_NAV_ITEMS = [
  { href: "/browse-cases", label: "Markets" },
  { href: "/activity", label: "Activity" },
  { href: "/leaderboard", label: "Rankings" },
  { href: "/my-claims", label: "My Claims" },
  { href: "/my-stakes", label: "Stakes" },
  { href: "/alpha-passport", label: "Passport" },
] as const;

const SIDE_NAV_ITEMS = [
  { href: "/browse-cases", label: "Markets", icon: "candlestick_chart" },
  { href: "/activity", label: "Activity", icon: "history" },
  { href: "/my-claims", label: "Claims", icon: "gavel" },
  { href: "/my-stakes", label: "Stakes", icon: "account_balance_wallet" },
  { href: "/leaderboard", label: "Rankings", icon: "leaderboard" },
  { href: "/alpha-passport", label: "Passport", icon: "vignette" },
  { href: "/how-verdicts-work", label: "Rules", icon: "menu_book" },
] as const;

const MOBILE_NAV = [
  { href: "/browse-cases", label: "Markets", icon: "candlestick_chart" },
  { href: "/activity", label: "Activity", icon: "history" },
  { href: "/post-a-claim", label: "New", icon: "add_circle" },
  { href: "/my-claims", label: "Claims", icon: "gavel" },
  { href: "/alpha-passport", label: "Passport", icon: "vignette" },
] as const;

function dockKey(label: string): string {
  if (label === "My Claims" || label === "Claims") return "claims";
  if (label === "Stakes") return "stakes";
  return label.toLowerCase();
}

function DockLink({
  href,
  label,
  active,
  icon,
  variant,
}: {
  href: string;
  label: string;
  active: boolean;
  icon?: string;
  variant: "top" | "side" | "mobile";
}) {
  const ping = useDockPing(label === "My Claims" || label === "Claims" ? "Claims" : label);
  const key = dockKey(label);
  if (variant === "top") {
    return (
      <Link
        href={href}
        data-dock={key}
        className={
          `${ping ? "dock-ping dock-ping-top " : ""}` +
          (active
            ? "relative font-mono text-sm md:text-base font-bold uppercase tracking-wide text-secondary-fixed border-b-2 border-secondary-fixed pb-1"
            : "relative font-mono text-sm md:text-base font-bold uppercase tracking-wide text-on-surface-variant hover:text-on-surface transition-colors")
        }
      >
        {label}
      </Link>
    );
  }
  if (variant === "side") {
    return (
      <Link
        href={href}
        data-dock={key}
        className={
          `${ping ? "dock-ping " : ""}` +
          (active
            ? "bg-secondary-fixed/15 text-secondary-fixed flex items-center gap-3 px-4 py-3.5 border-l-4 border-secondary-fixed font-mono text-sm font-bold uppercase tracking-wide"
            : "text-on-surface-variant flex items-center gap-3 px-4 py-3.5 hover:bg-surface-container-high hover:text-on-surface transition-colors font-mono text-sm font-bold uppercase tracking-wide")
        }
      >
        {icon ? <span className="material-symbols-outlined text-[22px]">{icon}</span> : null}
        {label}
      </Link>
    );
  }
  return (
    <Link
      href={href}
      data-dock-mobile={key}
      className={`${ping ? "dock-ping " : ""}flex flex-col items-center justify-center py-2.5 text-on-surface-variant`}
    >
      {icon ? <span className="material-symbols-outlined text-[24px]">{icon}</span> : null}
      <span className="font-mono text-[11px] font-bold uppercase tracking-wide mt-0.5">{label}</span>
    </Link>
  );
}

export function AppShell({
  activeTop,
  activeSide,
  children,
}: {
  activeTop?: string;
  activeSide?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-[100dvh] bg-background">
      <header className="fixed top-0 inset-x-0 z-50 bg-background/95 backdrop-blur-md border-b border-white/10">
        <div className="h-20 px-5 md:px-8 flex items-center justify-between gap-6">
          <div className="flex items-center gap-8 min-w-0">
            <Link
              href="/"
              className="flex items-center gap-2.5 font-display text-2xl md:text-3xl text-primary uppercase tracking-tight shrink-0"
            >
              <AlphaMark className="h-8 w-8" />
              ALPHA COURT
            </Link>
            <nav className="hidden lg:flex items-center gap-7">
              {TOP_NAV_ITEMS.map((item) => (
                <DockLink
                  key={item.href}
                  href={item.href}
                  label={item.label}
                  active={item.label === activeTop}
                  variant="top"
                />
              ))}
            </nav>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            <WalletChip />
            <Link
              href="/post-a-claim"
              className="hidden sm:inline-flex bg-secondary-fixed text-on-secondary-fixed font-mono text-sm font-bold uppercase tracking-wide px-5 py-2.5 hover:opacity-90 active:scale-[0.98] transition-all"
            >
              New Claim
            </Link>
          </div>
        </div>
      </header>

      <aside className="hidden lg:flex flex-col fixed left-0 top-20 bottom-0 w-64 bg-surface-container-lowest border-r border-white/10 z-40">
        <div className="p-5 border-b border-white/10">
          <OperatorCard />
        </div>
        <nav className="flex-1 flex flex-col gap-1 p-3">
          {SIDE_NAV_ITEMS.map((item) => (
            <DockLink
              key={item.label}
              href={item.href}
              label={item.label}
              active={item.label === activeSide}
              icon={item.icon}
              variant="side"
            />
          ))}
        </nav>
      </aside>

      <main className="flex-1 lg:ml-64 pt-20 pb-20 lg:pb-8 relative min-h-[100dvh] w-full">{children}</main>

      <nav className="lg:hidden fixed bottom-0 inset-x-0 z-50 bg-surface-container-lowest/95 backdrop-blur-md border-t border-white/10 grid grid-cols-5">
        {MOBILE_NAV.map((item) => (
          <DockLink
            key={item.href}
            href={item.href}
            label={item.label}
            active={false}
            icon={item.icon}
            variant="mobile"
          />
        ))}
      </nav>
    </div>
  );
}
