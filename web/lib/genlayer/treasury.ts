/**
 * Published deposit address. Production sets this to the live court
 * itself (`SELF` at deploy): users send GEN here, the contract verifies
 * the transfer by hash, and `_pay_native` pays winners from that same
 * balance. Rotates on every redeploy so spent hashes from a retired
 * court cannot replay.
 */
export const TREASURY_ADDRESS = (
  process.env.NEXT_PUBLIC_TREASURY_ADDRESS ||
  process.env.NEXT_PUBLIC_ALPHA_COURT_CONTRACT_ADDRESS ||
  process.env.ALPHA_COURT_SIGNER_ADDRESS ||
  "0x374D46E81973dd8797f14f586AEE94AaC27e39A3"
).toLowerCase() as `0x${string}`;
