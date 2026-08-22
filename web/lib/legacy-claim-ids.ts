/** Retired Studio deployment. Numeric ids on this address are historical. */
export const RETIRED_COURT_ADDRESS =
  "0xd3cD69C30A4e899bA2D346723bffac066543cF97";

/** First create on 0x65fEF5… was 2026-08-20T14:01:31Z. Ids before this are old. */
export const NEW_COURT_CUTOFF_MS = Date.parse("2026-08-20T14:00:00.000Z");

/** Claim ids that lived on the retired 0xd3cD69… deployment. */
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

export type LegacyClaimHint = {
  claim_id?: string | null;
  origin_contract?: string | null;
  created_at?: string | null;
};

export function originOf(claim: LegacyClaimHint): string {
  if (claim.origin_contract) return claim.origin_contract;
  const created = claim.created_at ? Date.parse(claim.created_at) : Number.NaN;
  if (Number.isFinite(created) && created >= NEW_COURT_CUTOFF_MS) {
    return currentCourtAddress();
  }
  if (LEGACY_CLAIM_IDS.has(String(claim.claim_id ?? ""))) {
    return RETIRED_COURT_ADDRESS;
  }
  return currentCourtAddress();
}

export function isLegacyClaim(claim?: LegacyClaimHint | null): boolean {
  if (!claim) return false;
  const origin = originOf(claim).toLowerCase();
  const current = currentCourtAddress();
  if (!origin || !current) {
    return origin === RETIRED_COURT_ADDRESS.toLowerCase();
  }
  return origin !== current;
}

/** ID-only check. Wrong once the new court reused ids. Prefer isLegacyClaim. */
export function isLegacyClaimId(id?: string | null): boolean {
  if (!id) return false;
  return LEGACY_CLAIM_IDS.has(String(id));
}

export function caseHref(claim: LegacyClaimHint & { claim_id?: string | null }): string {
  const id = String(claim.claim_id ?? "").trim();
  if (!id) return "/browse-cases";
  if (isLegacyClaim(claim)) return `/cases/${encodeURIComponent(id)}?legacy=1`;
  return `/cases/${encodeURIComponent(id)}`;
}

/** React list key. Bare claim_id collides once live ids reuse retired ones. */
export function claimRowKey(claim: LegacyClaimHint & { claim_id?: string | null }): string {
  const id = String(claim.claim_id ?? "");
  return `${originOf(claim).toLowerCase()}::${id}`;
}

export function shortCourt(addr?: string | null): string {
  if (!addr) return "";
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}
