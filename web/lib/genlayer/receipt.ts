/**
 * Decode a GenLayer write receipt's actual call return (or revert),
 * independent of status_name. Same shape both signing paths already
 * inspect for rollbacks (client.ts / wallet.ts).
 */
export function extractLeaderResult(receipt: unknown): {
  status?: string;
  payload?: unknown;
} | null {
  const rec = receipt as {
    consensus_data?: { leader_receipt?: { result?: { status?: string; payload?: unknown } }[] };
  } | null;
  return rec?.consensus_data?.leader_receipt?.[0]?.result ?? null;
}

export function extractCallReturn(receipt: unknown): unknown {
  const result = extractLeaderResult(receipt);
  if (!result || result.status === "rollback") return undefined;
  return result.payload;
}

function coerceClaimId(value: unknown): string | undefined {
  if (typeof value === "bigint" && value >= 0n) return value.toString();
  if (typeof value === "number" && Number.isInteger(value) && value >= 0) return String(value);
  if (typeof value === "string") {
    const s = value.trim().replace(/^"+|"+$/g, "");
    if (/^\d+$/.test(s)) return s;
  }
  return undefined;
}

/** create_claim / create_* return the new claim_id as a numeric string.
 *  Studio wraps it as `{ readable: "\"23\"" }` — that must parse. */
export function extractClaimId(receipt: unknown): string | undefined {
  const value = extractCallReturn(receipt);
  const direct = coerceClaimId(value);
  if (direct) return direct;
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    return (
      coerceClaimId(obj.readable) ??
      coerceClaimId(obj.claim_id) ??
      coerceClaimId(obj.claimId) ??
      coerceClaimId(obj.value)
    );
  }
  return undefined;
}
