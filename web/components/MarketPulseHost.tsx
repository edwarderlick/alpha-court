"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties, type RefObject } from "react";
import { useRouter } from "next/navigation";
import { useAppState } from "@/lib/store";
import { AddressMark, addressHue, shortenAddress } from "./AddressMark";
import { claimTitle, type ClaimSummary } from "@/lib/genlayer/claim-display";
import { caseHref, claimRowKey } from "@/lib/legacy-claim-ids";
import {
  emitPulse,
  isPulseMuted,
  isTerminalState,
  pulseDetail,
  pulseHeadline,
  subscribePulse,
  tabForKind,
  tabsToPing,
  type MarketPulseEvent,
  type PulseSnap,
} from "@/lib/market-pulse";

const POLL_MS = 120000;

function toSnap(claim: ClaimSummary): PulseSnap {
  return {
    id: claimRowKey(claim),
    claimId: claim.claim_id,
    href: caseHref(claim),
    state: claim.state,
    forAmt: parseFloat(claim.stake_for_total) || 0,
    againstAmt: parseFloat(claim.stake_against_total) || 0,
    title: claimTitle(claim),
    verdict: claim.consensus_result || claim.verdict_text || "",
  };
}

function diffSnaps(prev: Map<string, PulseSnap>, next: PulseSnap[]): MarketPulseEvent[] {
  const out: MarketPulseEvent[] = [];

  for (const snap of next) {
    const old = prev.get(snap.id);
    if (!old) continue;
    // Create / stake celebrations are emitted only from the acting wallet's
    // own write path. The poller used to turn every pool-size change into a
    // public fanfare, which is how other viewers saw someone else's stake.
    if (old.state !== snap.state) {
      if (isPulseMuted(snap.claimId) || isPulseMuted(snap.id)) continue;
      if (snap.state === "EVIDENCE_LOCKED") {
        out.push({
          id: `locked:${snap.id}`,
          kind: "locked",
          claimId: snap.claimId,
          title: snap.title,
          href: snap.href,
          tab: tabForKind("locked"),
          ts: Date.now(),
        });
      }
      if (isTerminalState(snap.state)) {
        out.push({
          id: `resolved:${snap.id}`,
          kind: "resolved",
          claimId: snap.claimId,
          title: snap.title,
          verdict: snap.verdict || snap.state,
          href: snap.href,
          tab: tabForKind("resolved"),
          ts: Date.now(),
        });
      }
    }
  }

  return out;
}

function pingDock(tab: MarketPulseEvent["tab"]) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent("alpha-dock-ping", { detail: { tab } }));
}

function pingEvent(event: MarketPulseEvent) {
  for (const tab of tabsToPing(event.kind)) pingDock(tab);
}

function findDock(tab: MarketPulseEvent["tab"]): HTMLElement | null {
  if (typeof document === "undefined") return null;
  const key = tab.toLowerCase();
  return (
    document.querySelector<HTMLElement>(`[data-dock="${key}"]`) ??
    document.querySelector<HTMLElement>(`[data-dock-mobile="${key}"]`)
  );
}

function toneFor(kind: MarketPulseEvent["kind"]) {
  if (kind === "stake_against") return "against";
  if (kind === "stake_for") return "for";
  if (kind === "resolved" || kind === "locked") return "end";
  return "new";
}

function MarketTicket({
  event,
  phase,
  ticketRef,
  onOpen,
}: {
  event: MarketPulseEvent;
  phase: "enter" | "hold" | "fly" | "leave";
  ticketRef: RefObject<HTMLButtonElement | null>;
  onOpen: () => void;
}) {
  const tone = toneFor(event.kind);
  const tape = `${pulseHeadline(event)}  ·  ${event.title || "ALPHA COURT"}  ·  `;
  return (
    <button
      ref={ticketRef}
      type="button"
      className={`market-ticket market-ticket-${tone} market-ticket-${phase}`}
      onClick={onOpen}
    >
      <div className="market-ticket-tape" aria-hidden>
        <div className="market-ticket-tape-track">
          <span>{tape.repeat(8)}</span>
          <span>{tape.repeat(8)}</span>
        </div>
      </div>
      <div className="market-ticket-body">
        <div className="flex items-start justify-between gap-4">
          <div className="font-mono text-[11px] font-bold uppercase tracking-[0.22em]">
            {pulseHeadline(event)}
          </div>
          {event.claimId ? (
            <div className="font-mono text-[11px] uppercase tracking-widest opacity-80">#{event.claimId}</div>
          ) : null}
        </div>
        <div className="font-display text-3xl md:text-5xl uppercase leading-[0.9] tracking-tight text-left">
          {event.title || "New docket"}
        </div>
        <div className="flex items-end justify-between gap-4">
          <div className="font-mono text-sm uppercase tracking-wide">{pulseDetail(event)}</div>
          <div className="font-mono text-[10px] uppercase tracking-widest opacity-70">Tap to open {event.tab}</div>
        </div>
      </div>
    </button>
  );
}

function CastFanfare({
  kind,
  address,
  amount,
}: {
  kind: "created" | "won";
  address?: string | null;
  amount?: string | null;
}) {
  const fig = kind === "created" ? "/cast/claimant.jpg" : "/cast/challenger.jpg";
  const hue = address ? addressHue(address) : 80;
  return (
    <div
      className={`cast-fanfare cast-fanfare-${kind}`}
      style={kind === "won" ? ({ ["--you-hue"]: String(hue) } as CSSProperties) : undefined}
    >
      <img src={fig} alt="" className="cast-fanfare-fig" />
      {kind === "won" && address ? (
        <div className="cast-fanfare-you">
          <div className="cast-fanfare-medal">
            <AddressMark address={address} size={72} />
          </div>
          <div className="font-mono text-[11px] uppercase tracking-[0.28em] opacity-80">Your payout</div>
          <div className="font-display text-4xl uppercase leading-none tracking-tight">
            {shortenAddress(address)}
          </div>
          {amount ? (
            <div className="font-mono text-lg font-bold uppercase tracking-widest">{amount} GEN</div>
          ) : (
            <div className="font-mono text-sm uppercase tracking-widest">stake paid out</div>
          )}
        </div>
      ) : (
        <div className="cast-fanfare-you">
          <img src="/cast/judge.jpg" alt="" className="cast-fanfare-judge" />
          <div className="font-display text-3xl uppercase leading-none">Docket live</div>
        </div>
      )}
    </div>
  );
}

export function MarketPulseHost() {
  const router = useRouter();
  const { wallet } = useAppState();
  const [queue, setQueue] = useState<MarketPulseEvent[]>([]);
  const [active, setActive] = useState<MarketPulseEvent | null>(null);
  const [win, setWin] = useState<{ amount: string | null } | null>(null);
  const [phase, setPhase] = useState<"enter" | "hold" | "fly" | "leave">("enter");
  const snapsRef = useRef<Map<string, PulseSnap> | null>(null);
  const ticketRef = useRef<HTMLButtonElement | null>(null);
  const seeded = useRef(false);

  const enqueue = useCallback((event: MarketPulseEvent) => {
    setQueue((q) => {
      if (q.some((e) => e.id === event.id) || (active && active.id === event.id)) return q;
      return [...q, event].slice(-6);
    });
  }, [active]);

  useEffect(() => {
    return subscribePulse(enqueue);
  }, [enqueue]);

  useEffect(() => {
    if (process.env.NODE_ENV !== "development") return;
    (window as Window & { __alphaPulse?: typeof emitPulse }).__alphaPulse = emitPulse;
    return () => {
      delete (window as Window & { __alphaPulse?: typeof emitPulse }).__alphaPulse;
    };
  }, []);

  useEffect(() => {
    if (active || queue.length === 0) return;
    setActive(queue[0]);
    setQueue((q) => q.slice(1));
    setPhase("enter");
    setWin(null);
  }, [active, queue]);

  useEffect(() => {
    if (!active || active.kind !== "resolved" || !wallet.address) {
      setWin(null);
      return;
    }
    let cancelled = false;
    fetch(`/api/payouts/lookup?address=${encodeURIComponent(wallet.address)}&claimId=${encodeURIComponent(active.claimId)}`)
      .then((res) => res.json())
      .then((data) => {
        if (cancelled) return;
        if (data?.won) setWin({ amount: data.amount ?? null });
      })
      .catch(() => {
        if (!cancelled) setWin(null);
      });
    return () => {
      cancelled = true;
    };
  }, [active, wallet.address]);

  useEffect(() => {
    if (!active) return;
    const reduce =
      typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const hasDock = Boolean(findDock(active.tab));
    const holdMs = reduce
      ? 1600
      : active.kind === "created" || active.kind === "resolved"
        ? 3400
        : hasDock
          ? 2000
          : 2400;
    const t1 = window.setTimeout(() => setPhase(hasDock ? "fly" : "leave"), holdMs);
    return () => window.clearTimeout(t1);
  }, [active]);

  useEffect(() => {
    if (!active || (phase !== "fly" && phase !== "leave")) return;
    const ticket = ticketRef.current;
    const dock = phase === "fly" ? findDock(active.tab) : null;
    if (phase === "fly" && ticket && dock) {
      const a = ticket.getBoundingClientRect();
      const b = dock.getBoundingClientRect();
      const dx = b.left + b.width / 2 - (a.left + a.width / 2);
      const dy = b.top + b.height / 2 - (a.top + a.height / 2);
      ticket.style.setProperty("--fly-x", `${dx}px`);
      ticket.style.setProperty("--fly-y", `${dy}px`);
      pingEvent(active);
    } else if (phase === "fly") {
      pingEvent(active);
    }
    const t = window.setTimeout(() => {
      if (active) pingEvent(active);
      setActive(null);
    }, phase === "fly" ? 720 : 420);
    return () => window.clearTimeout(t);
  }, [active, phase]);

  useEffect(() => {
    let cancelled = false;
    let timer: number | null = null;

    async function tick() {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      try {
        const res = await fetch("/api/claims", { cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json()) as { claims?: ClaimSummary[] };
        const claims = data.claims ?? [];
        const snaps = claims.map(toSnap);
        if (cancelled) return;
        if (!seeded.current) {
          snapsRef.current = new Map(snaps.map((s) => [s.id, s]));
          seeded.current = true;
          return;
        }
        const prev = snapsRef.current ?? new Map();
        const events = diffSnaps(prev, snaps);
        snapsRef.current = new Map(snaps.map((s) => [s.id, s]));
        for (const event of events) emitPulse(event);
      } catch {
        /* studio blip */
      }
    }

    const first = window.setTimeout(() => {
      void tick();
      timer = window.setInterval(tick, POLL_MS);
    }, 45000);
    const onVis = () => {
      if (document.visibilityState === "visible") void tick();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      cancelled = true;
      window.clearTimeout(first);
      if (timer) window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, []);

  function openActive() {
    if (!active) return;
    pingEvent(active);
    router.push(active.href);
    setActive(null);
  }

  if (!active) return null;

  const closed = active.kind === "locked" || active.kind === "resolved";

  return (
    <div className="market-pulse-root" role="status" aria-live="polite">
      <div className={`market-pulse-flash market-pulse-flash-${toneFor(active.kind)}`} />
      <div className="market-pulse-layer">
        {active.kind === "created" ? <CastFanfare kind="created" /> : null}
        {active.kind === "resolved" && win ? (
          <CastFanfare kind="won" address={wallet.address} amount={win.amount} />
        ) : null}
        <MarketTicket event={active} phase={phase} ticketRef={ticketRef} onOpen={openActive} />
        {closed ? (
          <p className="market-pulse-hint font-mono text-[10px] uppercase tracking-widest">
            Routing to {active.tab}
          </p>
        ) : null}
      </div>
    </div>
  );
}

export function useDockPing(activeLabel: string | undefined) {
  const [ping, setPing] = useState(false);

  useEffect(() => {
    function onPing(ev: Event) {
      const tab = (ev as CustomEvent<{ tab?: string }>).detail?.tab;
      if (!tab || tab !== activeLabel) return;
      setPing(true);
      window.setTimeout(() => setPing(false), 8000);
    }
    window.addEventListener("alpha-dock-ping", onPing);
    return () => window.removeEventListener("alpha-dock-ping", onPing);
  }, [activeLabel]);

  return ping;
}
