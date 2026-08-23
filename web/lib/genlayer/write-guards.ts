import "server-only";

import { readOneClaim } from "./client";
import { bookUpsert } from "./book";
import {
  isOnChainClaimId,
  stakingWindowOpen,
  type ClaimSummary,
} from "./claim-display";

export async function loadLiveClaim(id: string): Promise<ClaimSummary> {
  if (!isOnChainClaimId(id)) {
    throw new Error("[EXPECTED] unknown claim_id");
  }
  const claim = (await readOneClaim(id.trim())) as ClaimSummary;
  await bookUpsert(claim);
  return claim;
}

export async function requireStakeOpen(id: string): Promise<ClaimSummary> {
  const claim = await loadLiveClaim(id);
  if (!stakingWindowOpen(claim.state, claim.deadline)) {
    if (claim.state !== "OPEN") {
      throw new Error(`[EXPECTED] claim is not OPEN (on-chain state is ${claim.state})`);
    }
    throw new Error("[EXPECTED] staking window closed — deadline has passed");
  }
  return claim;
}
