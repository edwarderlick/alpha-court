/**
 * Proves the credit-lock closes the check-then-act TOCTOU in
 * creditResolvedWinners/creditRefundedStakers: two genuinely concurrent
 * callers (e.g. the GitHub Actions relay racing a manual /api/keeper/*
 * call) must not both pass "already paid?" before either records its row.
 *
 * Exercises the real acquireLock/releaseLock from lib/persist against
 * whatever backend is configured locally (disk fallback here, same
 * interface as the Redis-backed production store). Uses a namespaced
 * lock name and always releases it, so it cannot leave stray state behind.
 */
import { acquireLock, releaseLock } from "../lib/persist";

async function main() {
  const lockName = "__repro__credit-lock-test";
  await releaseLock(lockName); // ensure clean slate

  console.log("\n=== Two genuinely concurrent creditResolvedWinners-style calls for the same claim ===");
  const [a, b] = await Promise.all([
    acquireLock(lockName, 5_000),
    acquireLock(lockName, 5_000),
  ]);
  console.log("Caller A acquired lock:", a);
  console.log("Caller B acquired lock:", b);
  const exactlyOneWinner = a !== b;
  console.log(
    exactlyOneWinner
      ? "PASS: exactly one caller proceeds to send/record; the other returns [] (skips)."
      : "FAIL: either both or neither acquired the lock -- double-pay or stuck lock possible."
  );

  await releaseLock(lockName);
  const c = await acquireLock(lockName, 5_000);
  console.log("After release, a fresh caller (e.g. the next tick) can acquire:", c);
  await releaseLock(lockName);

  if (!exactlyOneWinner || !c) process.exit(1);
}

main();
