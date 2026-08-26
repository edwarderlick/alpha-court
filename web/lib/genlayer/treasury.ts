/**
 * Published treasury EOA. Users send GEN here directly. The contract
 * never takes custody; it only verifies the transfer by hash.
 * This is the same wallet the keeper pays winners from.
 */
export const TREASURY_ADDRESS = (
  process.env.NEXT_PUBLIC_TREASURY_ADDRESS ||
  process.env.ALPHA_COURT_SIGNER_ADDRESS ||
  "0x374D46E81973dd8797f14f586AEE94AaC27e39A3"
).toLowerCase() as `0x${string}`;
