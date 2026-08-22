"use client";

import { useEffect, useMemo, useState } from "react";
import type { ClaimSummary } from "@/lib/genlayer/claim-display";
import { listLocalDockets, listenLocalDockets, mergeDockets } from "@/lib/local-dockets";

export function useMergedClaims(remote: ClaimSummary[]): ClaimSummary[] {
  const [local, setLocal] = useState<ClaimSummary[]>([]);

  useEffect(() => {
    const sync = () => setLocal(listLocalDockets());
    sync();
    return listenLocalDockets(sync);
  }, []);

  return useMemo(() => mergeDockets(remote, local), [remote, local]);
}

export function writeErrorMessage(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  if (/rate limited|rate limit/i.test(message)) {
    return "Studio is rate-limiting new transactions right now. Check MetaMask Activity. If you already see Sent GEN to the contract, the claim is on-chain. Do not submit again. It will show on Markets from this browser.";
  }
  if (/aborted|timed out|TimeoutError|signal timed out/i.test(message)) {
    return "Studio did not confirm the create in time. Check Markets before submitting again — the claim may already be on-chain.";
  }
  return message;
}
