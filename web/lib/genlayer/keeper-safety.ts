/**
 * Pure guard logic, split out from keeper.ts so it's testable without
 * pulling in client.ts's env-var-gated module (ALPHA_COURT_CONTRACT_ADDRESS
 * etc) or persist/index.ts's server-only import.
 *
 * The credit lock (acquireLock/releaseLock, lib/persist) is backend-scoped:
 * Redis SET NX PX when Redis is configured, an in-process Map otherwise.
 * Two keeper processes on DIFFERENT backends can never see each other's
 * lock -- a real incident confirmed this the hard way: `npm run dev`
 * locally, with .env.local's real ALPHA_COURT_SIGNER_PRIVATE_KEY but no
 * Redis configured, started an in-process keeper that fell back to the
 * disk backend and re-credited a winner the real Redis-backed production
 * keeper had already correctly paid (a real duplicate on-chain send,
 * confirmed via balance/receipt evidence). A real signer key means real
 * chain writes and real GEN leaving the wallet; running that without the
 * one lock mechanism that prevents double-crediting is unsafe regardless
 * of environment. Refuse rather than risk it again.
 */
export function unsafeSignerWithoutRedis(hasSignerKey: boolean, storageKind: string): string | null {
  if (!hasSignerKey) return null;
  if (storageKind === "redis") return null;
  return (
    `refusing to run: a real ALPHA_COURT_SIGNER_PRIVATE_KEY is configured but the ` +
    `persistence backend is "${storageKind}", not "redis" -- the credit lock can't ` +
    `protect against a concurrent real keeper process on a different backend. ` +
    `Configure UPSTASH_REDIS_REST_URL/UPSTASH_REDIS_REST_TOKEN before running the keeper.`
  );
}
