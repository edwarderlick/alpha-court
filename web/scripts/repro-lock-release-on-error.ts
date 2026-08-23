/**
 * Proves the credit lock reliably releases even when the locked operation
 * throws mid-flight -- the exact guarantee creditResolvedWinners/
 * creditRefundedStakers rely on (acquireLock -> try { ... } finally {
 * releaseLock }). This was already a try/finally before this incident; the
 * real bug turned out to be elsewhere (see scripts/repro-staker-race.ts's
 * sibling investigation notes in the commit this ships with) -- but the
 * task explicitly asked for real proof the lock itself isn't the failure
 * mode, so this exercises the exact acquire/throw/release/reacquire
 * sequence against the real lib/persist lock implementation.
 */
import { acquireLock, releaseLock } from "../lib/persist";

async function creditLikeOperation(shouldThrow: boolean): Promise<string[]> {
  if (shouldThrow) throw new Error("simulated failure mid-credit (e.g. a CANCELED native send)");
  return ["ok"];
}

async function withLock<T>(lockName: string, ttlMs: number, fn: () => Promise<T>): Promise<T | []> {
  if (!(await acquireLock(lockName, ttlMs))) return [];
  try {
    return await fn();
  } finally {
    await releaseLock(lockName);
  }
}

async function main() {
  const lockName = "__repro__lock-release-on-error";
  await releaseLock(lockName); // clean slate

  console.log("\n=== Lock releases even when the wrapped operation throws ===");
  let threw = false;
  try {
    await withLock(lockName, 5_000, () => creditLikeOperation(true));
  } catch (e) {
    threw = true;
    console.log("Operation threw as expected:", (e as Error).message);
  }
  console.log("Caught the simulated failure:", threw);

  const reacquired = await acquireLock(lockName, 5_000);
  console.log("Lock immediately reacquirable after the throw (i.e. NOT stuck):", reacquired);
  await releaseLock(lockName);

  console.log("\n=== Lock still protects a genuinely concurrent second caller ===");
  await acquireLock(lockName, 5_000); // simulate one caller mid-operation
  const blocked = await acquireLock(lockName, 5_000);
  console.log("A second concurrent caller is blocked while the first holds it:", blocked === false);
  await releaseLock(lockName);
  const afterRelease = await acquireLock(lockName, 5_000);
  console.log("Released, and now acquirable again:", afterRelease);
  await releaseLock(lockName);

  const pass = threw && reacquired && blocked === false && afterRelease;
  console.log("\nPASS:", pass);
  if (!pass) process.exit(1);
}

main();
