"use client";

import { useEffect, useRef, useState } from "react";
import type { ClaimSummary } from "@/lib/genlayer/claim-display";
import { isDeadlinePassed } from "@/lib/genlayer/claim-display";
import { subscribePulse } from "@/lib/market-pulse";
import { readClaimInBrowser } from "@/lib/genlayer/browser-read";

const STAKE_EVENT = "ac-stakes-changed";

export function notifyStakesChanged(claimId: string) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(STAKE_EVENT, { detail: { claimId } }));
  burstClaimPoll(claimId);
}

function sameSnapshot(
  a: Partial<ClaimSummary> | null | undefined,
  b: Partial<ClaimSummary> | null | undefined
) {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.state === b.state &&
    a.deadline === b.deadline &&
    a.consensus_result === b.consensus_result &&
    a.stake_for_total === b.stake_for_total &&
    a.stake_against_total === b.stake_against_total &&
    a.origin_contract === b.origin_contract
  );
}

const IDLE_MS = 60_000;
const NEAR_MS = 15_000;
const LOCKED_MS = 20_000;
const SETTLED_MS = 120_000;
const BURST_MS = 8_000;
const BURST_WINDOW_MS = 45_000;
const NEAR_DEADLINE_MS = 2 * 60_000;

function pollDelay(claim: Partial<ClaimSummary> | null, burstUntil: number, readBlockedForMs: number): number {
  if (readBlockedForMs > 0) return Math.max(30_000, Math.min(readBlockedForMs, 120_000));
  if (Date.now() < burstUntil) return BURST_MS;
  const state = claim?.state || "";
  if (state === "RESOLVED" || state === "REFUNDED") return SETTLED_MS;
  if (state === "EVIDENCE_LOCKED" || state === "CONTESTED" || state === "APPEAL_PENDING") return LOCKED_MS;
  if (claim?.deadline && isDeadlinePassed(claim.deadline)) return NEAR_MS;
  const t = claim?.deadline ? Date.parse(claim.deadline) : Number.NaN;
  if (Number.isFinite(t) && t - Date.now() < NEAR_DEADLINE_MS) return NEAR_MS;
  return IDLE_MS;
}

type PollMeta = { cached: boolean; readBlockedForMs: number };

type Channel = {
  listeners: Set<(claim: Partial<ClaimSummary> | null, meta: PollMeta) => void>;
  claim: Partial<ClaimSummary> | null;
  timer: number | null;
  inFlight: boolean;
  burstUntil: number;
  lastMeta: PollMeta;
};

const channels = new Map<string, Channel>();

function channelKey(claimId: string, legacy: boolean) {
  return `${legacy ? "L" : "C"}:${claimId}`;
}

function schedule(key: string, claimId: string, legacy: boolean) {
  const ch = channels.get(key);
  if (!ch) return;
  if (ch.timer != null) window.clearTimeout(ch.timer);
  const delay = pollDelay(ch.claim, ch.burstUntil, ch.lastMeta.readBlockedForMs);
  ch.timer = window.setTimeout(() => {
    void pull(key, claimId, legacy, false);
  }, delay);
}

async function pull(key: string, claimId: string, legacy: boolean, fresh: boolean) {
  const ch = channels.get(key);
  if (!ch || ch.inFlight) return;
  ch.inFlight = true;
  try {
    const qs = new URLSearchParams();
    if (legacy) qs.set("legacy", "1");
    if (fresh) qs.set("fresh", "1");
    const suffix = qs.toString() ? `?${qs}` : "";
    const res = await fetch(`/api/claims/${encodeURIComponent(claimId)}${suffix}`, { cache: "no-store" });
    const data = await res.json().catch(() => null);
    const studio = data?.studio as { canRead?: boolean; readBlockedForMs?: number } | undefined;
    const readBlockedForMs = Number(studio?.readBlockedForMs) || 0;
    ch.lastMeta = { cached: Boolean(data?.cached), readBlockedForMs };
    if (data?.claim) {
      const next = data.claim as ClaimSummary;
      if (!sameSnapshot(ch.claim, next)) {
        ch.claim = next;
        ch.listeners.forEach((fn) => fn(next, ch.lastMeta));
      }
    } else if (!legacy) {
      const next = await readClaimInBrowser(claimId);
      if (next && !sameSnapshot(ch.claim, next)) {
        ch.claim = next;
        ch.listeners.forEach((fn) => fn(next, ch.lastMeta));
      }
    }
  } catch {
    /* keep last snapshot */
  } finally {
    ch.inFlight = false;
    if (channels.has(key)) schedule(key, claimId, legacy);
  }
}

function subscribeChannel(
  claimId: string,
  legacy: boolean,
  initial: Partial<ClaimSummary> | null,
  fn: (claim: Partial<ClaimSummary> | null, meta: PollMeta) => void
): () => void {
  const key = channelKey(claimId, legacy);
  let ch = channels.get(key);
  if (!ch) {
    ch = {
      listeners: new Set(),
      claim: initial,
      timer: null,
      inFlight: false,
      burstUntil: 0,
      lastMeta: { cached: false, readBlockedForMs: 0 },
    };
    channels.set(key, ch);
    void pull(key, claimId, legacy, false);
  }
  ch.listeners.add(fn);
  if (ch.claim) fn(ch.claim, ch.lastMeta);
  return () => {
    ch!.listeners.delete(fn);
    if (ch!.listeners.size === 0) {
      if (ch!.timer != null) window.clearTimeout(ch!.timer);
      channels.delete(key);
    }
  };
}

function tickClaimPoll(claimId: string, fresh: boolean) {
  for (const [key, ch] of channels) {
    if (!key.endsWith(`:${claimId}`)) continue;
    const legacy = key.startsWith("L:");
    if (fresh) ch.burstUntil = Date.now() + BURST_WINDOW_MS;
    void pull(key, claimId, legacy, fresh);
  }
}

function burstClaimPoll(claimId: string) {
  tickClaimPoll(claimId, true);
}

export function useLiveClaim(
  claimId: string,
  initial: Partial<ClaimSummary> | null,
  opts?: { intervalMs?: number; legacy?: boolean; enabled?: boolean }
) {
  const [claim, setClaim] = useState<Partial<ClaimSummary> | null>(initial);
  const enabled = opts?.enabled !== false;
  const legacy = Boolean(opts?.legacy);
  const claimIdRef = useRef(claimId);

  if (claimIdRef.current !== claimId) {
    claimIdRef.current = claimId;
    setClaim(initial);
  }

  useEffect(() => {
    if (!claimId || !enabled) return;
    return subscribeChannel(claimId, legacy, initial, (next) => {
      setClaim((prev) => (sameSnapshot(prev, next) ? prev : next));
    });
  }, [claimId, legacy, enabled]);

  useEffect(() => {
    if (!claimId || !enabled) return;
    const onStake = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      if (!detail?.claimId || String(detail.claimId) === String(claimId)) burstClaimPoll(claimId);
    };
    window.addEventListener(STAKE_EVENT, onStake);
    const onVis = () => {
      if (document.visibilityState === "visible") tickClaimPoll(claimId, false);
    };
    document.addEventListener("visibilitychange", onVis);
    const unsub = subscribePulse((pulse) => {
      if (pulse.claimId === claimId) tickClaimPoll(claimId, false);
    });
    return () => {
      window.removeEventListener(STAKE_EVENT, onStake);
      document.removeEventListener("visibilitychange", onVis);
      unsub();
    };
  }, [claimId, enabled]);

  return claim;
}

export function useLiveStakers(claimId: string) {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!claimId) return;
    const bump = () => setTick((n) => n + 1);
    const unsub = subscribeChannel(claimId, false, null, bump);
    const onStake = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      if (!detail?.claimId || String(detail.claimId) === String(claimId)) bump();
    };
    window.addEventListener(STAKE_EVENT, onStake);
    const unsubPulse = subscribePulse((pulse) => {
      if (pulse.claimId === claimId && (pulse.kind === "stake_for" || pulse.kind === "stake_against")) bump();
    });
    return () => {
      unsub();
      window.removeEventListener(STAKE_EVENT, onStake);
      unsubPulse();
    };
  }, [claimId]);
  return tick;
}
