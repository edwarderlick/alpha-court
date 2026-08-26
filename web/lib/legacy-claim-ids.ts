/**
 * Retired Studio deployments, oldest first. A claim id has been reused
 * across every one of these (each court restarts numbering from 1), so any
 * lookup that isn't already origin_contract-scoped MUST disambiguate by
 * court, never by bare claim_id alone -- see claimRowKey/posKey/payoutsFor
 * and this session's payout-key-collision fix for why that matters in
 * practice, not just in theory.
 */
export type RetiredCourt = {
  /** Lowercase 0x address. */
  address: string;
  /** Shown in the UI wherever a retired claim's origin is labeled. */
  label: string;
  /** Claims created on/after this ms (until the next entry's cutoff, or
   * CURRENT_COURT_CUTOFF_MS for the last entry) belong to this court. Only
   * used as a fallback for claims stored without an origin_contract field
   * (pre-dating multi-court tracking) -- every claim written since then
   * carries its own origin_contract and never needs this at all. */
  cutoffMs: number;
};

export const RETIRED_COURTS: RetiredCourt[] = [
  {
    address: "0xd3cD69C30A4e899bA2D346723bffac066543cF97".toLowerCase(),
    label: "Legacy docket",
    cutoffMs: 0,
  },
  {
    address: "0x8b2fF616d26Cb9bE48f4484BD5F8E7Cdaeca7902".toLowerCase(),
    label: "Legacy docket",
    cutoffMs: Date.parse("2026-08-20T14:00:00.000Z"),
  },
  {
    address: "0x22Cf7A9eA315e6EcE6C2BCBF60F0f656C39CCEE4".toLowerCase(),
    label: "Legacy docket",
    cutoffMs: Date.parse("2026-08-23T17:25:00.000Z"),
  },
  {
    address: "0xF9Df5e7b7E2119FC8186f7f21Dd37E075a4aCe85".toLowerCase(),
    label: "Legacy docket",
    cutoffMs: Date.parse("2026-08-24T18:20:00.000Z"),
  },
];

/** When the CURRENT live court (currentCourtAddress()) took over from the
 * last entry in RETIRED_COURTS above. Update this alongside RETIRED_COURTS
 * every time the live court is redeployed and the prior one retired. */
export const CURRENT_COURT_CUTOFF_MS = Date.parse("2026-08-27T12:00:00.000Z");

/** Claim ids that lived on the oldest retired deployment, from before this
 * app tracked origin_contract or created_at reliably enough to disambiguate
 * by timestamp alone. Only ever consulted for that one court -- every later
 * court's claims already carry a real origin_contract. */
export const LEGACY_CLAIM_IDS = new Set([
  "1",
  "2",
  "3",
  "4",
  "5",
  "6",
  "7",
  "8",
  "9",
  "10",
  "11",
  "12",
  "13",
  "14",
  "15",
  "16",
  "17",
  "18",
  "19",
  "21",
  "24",
  "25",
  "26",
  "27",
  "28",
  "29",
  "30",
  "31",
  "32",
  "33",
]);

export function currentCourtAddress(): string {
  return (
    process.env.NEXT_PUBLIC_ALPHA_COURT_CONTRACT_ADDRESS ||
    process.env.ALPHA_COURT_CONTRACT_ADDRESS ||
    ""
  ).toLowerCase();
}

export function isRetiredCourtAddress(addr?: string | null): boolean {
  if (!addr) return false;
  const lower = addr.toLowerCase();
  return RETIRED_COURTS.some((c) => c.address === lower);
}

export function retiredCourtLabel(addr?: string | null): string | null {
  if (!addr) return null;
  const lower = addr.toLowerCase();
  return RETIRED_COURTS.find((c) => c.address === lower)?.label ?? null;
}

export type LegacyClaimHint = {
  claim_id?: string | null;
  origin_contract?: string | null;
  created_at?: string | null;
};

export function originOf(claim: LegacyClaimHint): string {
  if (claim.origin_contract) return claim.origin_contract;
  const created = claim.created_at ? Date.parse(claim.created_at) : Number.NaN;
  if (Number.isFinite(created)) {
    if (created >= CURRENT_COURT_CUTOFF_MS) return currentCourtAddress();
    for (let i = RETIRED_COURTS.length - 1; i >= 0; i--) {
      if (created >= RETIRED_COURTS[i]!.cutoffMs) return RETIRED_COURTS[i]!.address;
    }
  }
  if (LEGACY_CLAIM_IDS.has(String(claim.claim_id ?? ""))) {
    return RETIRED_COURTS[0]!.address;
  }
  return currentCourtAddress();
}

export function isLegacyClaim(claim?: LegacyClaimHint | null): boolean {
  if (!claim) return false;
  const origin = originOf(claim).toLowerCase();
  const current = currentCourtAddress();
  if (!origin || !current) {
    return isRetiredCourtAddress(origin);
  }
  return origin !== current;
}

/** ID-only check. Wrong once a later court reused ids -- prefer isLegacyClaim. */
export function isLegacyClaimId(id?: string | null): boolean {
  if (!id) return false;
  return LEGACY_CLAIM_IDS.has(String(id));
}

export function caseHref(claim: LegacyClaimHint & { claim_id?: string | null }): string {
  const id = String(claim.claim_id ?? "").trim();
  if (!id) return "/browse-cases";
  if (isLegacyClaim(claim)) {
    // `origin` disambiguates WHICH retired court -- with more than one
    // retired court, `legacy=1` alone is ambiguous: claim ids repeat across
    // every retired court, and a bare boolean can't say which one this link
    // means. Kept alongside `legacy=1` for back-compat with any existing
    // bookmarked/shared links that only have the boolean.
    return `/cases/${encodeURIComponent(id)}?legacy=1&origin=${encodeURIComponent(originOf(claim).toLowerCase())}`;
  }
  return `/cases/${encodeURIComponent(id)}`;
}

/** React list key. Bare claim_id collides once a later court reuses retired ids. */
export function claimRowKey(claim: LegacyClaimHint & { claim_id?: string | null }): string {
  const id = String(claim.claim_id ?? "");
  return `${originOf(claim).toLowerCase()}::${id}`;
}

export function shortCourt(addr?: string | null): string {
  if (!addr) return "";
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}
