/**
 * Pure "is this transfer actually done?" rules, split out from
 * keeper-credits.ts so they're testable without pulling in client.ts's
 * env-var-gated module (ALPHA_COURT_CONTRACT_ADDRESS etc).
 */
export type CreditableTransfer = {
  kind: "payout" | "refund";
  to: string;
  credited: boolean;
  txHash: string;
};

/**
 * A recorded row only counts as "done" if it actually credited the winner,
 * or is the keeper-paying-itself no-op (which will never credit -- Studio
 * can't self-credit a same-address transfer, so retrying it is pointless).
 * A real `0x...`-hash send that came back uncredited (e.g. the transaction
 * was CANCELED) must NOT count as done -- see the #16/#18/#19/#21 incident:
 * treating a merely-attempted, never-succeeded send as final permanently
 * blocked retries.
 */
export function isDone(t: CreditableTransfer): boolean {
  return t.credited || t.txHash.startsWith("uncredited:self:");
}

export function alreadyCredited<T extends CreditableTransfer>(
  transfers: T[],
  kind: "payout" | "refund",
  to?: string
): boolean {
  return transfers.some((t) => t.kind === kind && (!to || t.to === to) && isDone(t));
}

export function creditedCount<T extends CreditableTransfer>(transfers: T[], kind: "payout" | "refund"): number {
  return transfers.filter((t) => t.kind === kind && isDone(t)).length;
}
