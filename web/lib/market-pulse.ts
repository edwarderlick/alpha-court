/** Browser-only market pulse: local emits + BroadcastChannel + poll diffs. */

export type MarketPulseKind =
  | "created"
  | "stake_for"
  | "stake_against"
  | "locked"
  | "resolved";

export type MarketPulseTab = "Markets" | "Claims" | "Activity";

export type MarketPulseEvent = {
  id: string;
  kind: MarketPulseKind;
  claimId: string;
  title: string;
  amount?: string;
  verdict?: string;
  href: string;
  tab: MarketPulseTab;
  ts: number;
};

/** Create / stake celebrations belong to the acting session only. Settlement news can be public. */
export function isActorPulse(kind: MarketPulseKind): boolean {
  return kind === "created" || kind === "stake_for" || kind === "stake_against";
}

export type PulseSnap = {
  id: string;
  claimId: string;
  href: string;
  state: string;
  forAmt: number;
  againstAmt: number;
  title: string;
  verdict: string;
};

type Listener = (event: MarketPulseEvent) => void;

const CHANNEL = "alpha-court-pulse";
const MUTE_PREFIX = "ac-pulse-mute:";
const SEEN_KEY = "ac-pulse-seen";

const listeners = new Set<Listener>();
let channel: BroadcastChannel | null = null;

function now() {
  return Date.now();
}

function loadSeen(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = window.sessionStorage.getItem(SEEN_KEY);
    const parsed = raw ? (JSON.parse(raw) as string[]) : [];
    return new Set(parsed.slice(-80));
  } catch {
    return new Set();
  }
}

function persistSeen(seen: Set<string>) {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(SEEN_KEY, JSON.stringify([...seen].slice(-80)));
  } catch {
    /* ignore quota */
  }
}

const seen = loadSeen();

export function markPulseSeen(key: string): boolean {
  if (!key || seen.has(key)) return false;
  seen.add(key);
  persistSeen(seen);
  return true;
}

export function mutePulse(claimKey: string, ms = 28000) {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(MUTE_PREFIX + claimKey, String(now() + ms));
  } catch {
    /* ignore */
  }
}

export function isPulseMuted(claimKey: string): boolean {
  if (typeof window === "undefined") return false;
  try {
    const raw = window.sessionStorage.getItem(MUTE_PREFIX + claimKey);
    const until = raw ? Number(raw) : 0;
    return Number.isFinite(until) && until > now();
  } catch {
    return false;
  }
}

function ensureChannel() {
  if (typeof window === "undefined") return null;
  if (channel) return channel;
  try {
    channel = new BroadcastChannel(CHANNEL);
    channel.onmessage = (msg) => {
      const event = msg.data as MarketPulseEvent | undefined;
      if (!event?.id || !event.kind) return;
      // Actor-scoped events must never arrive over the shared channel.
      if (isActorPulse(event.kind)) return;
      if (!markPulseSeen(event.id)) return;
      listeners.forEach((fn) => fn(event));
    };
  } catch {
    channel = null;
  }
  return channel;
}

export function subscribePulse(fn: Listener): () => void {
  listeners.add(fn);
  ensureChannel();
  return () => {
    listeners.delete(fn);
  };
}

export function emitPulse(partial: Omit<MarketPulseEvent, "id" | "ts"> & { id?: string }) {
  const event: MarketPulseEvent = {
    ...partial,
    id: partial.id ?? `${partial.kind}:${partial.claimId}:${now()}`,
    ts: now(),
  };
  if (partial.claimId) mutePulse(partial.claimId);
  if (partial.kind === "created") mutePulse("create");
  if (!markPulseSeen(event.id)) return;
  listeners.forEach((fn) => fn(event));
  // Create / stake fanfares stay in this tab. Broadcasting them is what
  // made every open viewer see someone else's stake celebration.
  if (isActorPulse(event.kind)) return;
  try {
    ensureChannel()?.postMessage(event);
  } catch {
    /* ignore */
  }
}

export function tabForKind(kind: MarketPulseKind): MarketPulseTab {
  if (kind === "resolved") return "Claims";
  if (kind === "locked") return "Activity";
  return "Markets";
}

export function tabsToPing(kind: MarketPulseKind): MarketPulseTab[] {
  if (kind === "locked" || kind === "resolved") return ["Markets", "Claims", "Activity"];
  if (kind === "created") return ["Markets", "Activity"];
  return ["Markets"];
}

export function hrefForKind(kind: MarketPulseKind, claimId: string): string {
  if (claimId) return `/cases/${claimId}`;
  if (kind === "resolved") return "/my-claims";
  if (kind === "locked") return "/activity";
  return "/browse-cases";
}

export function pulseHeadline(event: MarketPulseEvent): string {
  if (event.kind === "created") return "NEW MARKET";
  if (event.kind === "stake_for") return "FOR FILLED";
  if (event.kind === "stake_against") return "AGAINST FILLED";
  if (event.kind === "locked") return "MARKET CLOSED";
  return "VERDICT IN";
}

export function pulseDetail(event: MarketPulseEvent): string {
  if (event.kind === "created") {
    return event.claimId ? `Claim #${event.claimId} is live on Markets` : "A new claim is live on Markets";
  }
  if (event.kind === "stake_for" || event.kind === "stake_against") {
    const side = event.kind === "stake_for" ? "FOR" : "AGAINST";
    return event.amount ? `${event.amount} GEN ${side}` : side;
  }
  if (event.kind === "locked") {
    return event.claimId ? `Claim #${event.claimId} locked at deadline` : "Evidence is locked";
  }
  const verdict = event.verdict ? event.verdict.replace(/_/g, " ") : "Settled";
  return event.claimId ? `Claim #${event.claimId} · ${verdict}` : verdict;
}

export function isTerminalState(state: string): boolean {
  return state === "RESOLVED" || state === "CONTESTED";
}

export function isClosedState(state: string): boolean {
  return state === "EVIDENCE_LOCKED" || isTerminalState(state);
}
