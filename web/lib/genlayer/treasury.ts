/**
 * Published deposit address. Production sets this to the live court
 * itself (`SELF` at deploy): users send GEN here, the contract verifies
 * the transfer by hash, and `_pay_native` pays winners from that same
 * balance. Rotates on every redeploy so spent hashes from a retired
 * court cannot replay.
 *
 * No silent fallback to a hardcoded EOA. A missing env used to resolve
 * to the old keeper address; a deposit sent there is unrecoverable.
 */
function requiredTreasury(): `0x${string}` {
  const raw =
    process.env.NEXT_PUBLIC_TREASURY_ADDRESS ||
    process.env.NEXT_PUBLIC_ALPHA_COURT_CONTRACT_ADDRESS ||
    "";
  if (!/^0x[0-9a-fA-F]{40}$/.test(raw)) {
    throw new Error(
      "NEXT_PUBLIC_TREASURY_ADDRESS (or NEXT_PUBLIC_ALPHA_COURT_CONTRACT_ADDRESS) is required; refusing to fall back to a stale EOA"
    );
  }
  return raw.toLowerCase() as `0x${string}`;
}

export const TREASURY_ADDRESS = requiredTreasury();
