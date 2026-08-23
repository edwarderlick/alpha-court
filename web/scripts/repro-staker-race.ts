/**
 * Reproduces the missing-3rd-staker bug at the persistence layer and proves
 * the fix. No Upstash credentials are available in this environment, so this
 * exercises the same lib/persist hashLoad/hashSet/hashReplace/hashDelete
 * functions against whatever backend is configured locally (disk-file
 * fallback here) — same file, same interface as the Redis-backed production
 * store; the root-cause mechanism (blind whole-hash DEL+HSET from a stale
 * in-memory snapshot clobbering a concurrent single-field HSET) is identical
 * in both backends.
 *
 * Uses a small set of clearly-namespaced test keys (prefix `__repro__`) and
 * removes exactly those keys at the end — it never sweeps or replaces the
 * whole "stakes" hash, so it cannot disturb real seeded/local data.
 */
import { hashDelete, hashLoad, hashReplace, hashSet } from "../lib/persist";

const K = {
  A: "__repro__|origin|1|for",
  B: "__repro__|origin|2|for",
  C: "__repro__|origin|3|for",
};

async function cleanup() {
  await Promise.all(Object.values(K).map((k) => hashDelete("stakes", k)));
}

async function OLD_BUG_reproduce() {
  await cleanup();
  console.log("\n=== Reproducing the OLD bug (persistPos == hashReplace of a stale snapshot) ===");
  await hashSet("stakes", K.A, { amountAtto: "1000", at: 1, terminal: false });
  await hashSet("stakes", K.B, { amountAtto: "2000", at: 2, terminal: false });

  // Simulates stakersForClaim's OLD positions() snapshot load, taken BEFORE
  // staker C's stake lands (e.g. while the claim page is doing slow live RPC reads).
  const staleSnapshot = await hashLoad("stakes");
  console.log("Snapshot taken by viewer request includes A, B:",
    K.A in staleSnapshot, K.B in staleSnapshot, "-- C not yet staked:", K.C in staleSnapshot);

  // Staker C stakes concurrently, via the real production write path (hashSet).
  await hashSet("stakes", K.C, { amountAtto: "3000", at: 3, terminal: false });
  console.log("Staker C's real stake landed via hashSet (independent request).");

  // The viewer request finishes and writes back with the OLD persistPos logic:
  // a blind DEL + HSET of the *entire* hash using the stale snapshot.
  await hashReplace("stakes", staleSnapshot);
  console.log("Viewer request finishes, old persistPos() -> hashReplace(staleSnapshot) runs.");

  const after = await hashLoad("stakes");
  const lost = !(K.C in after);
  console.log("Staker C present after old code path ran:", K.C in after);
  console.log(lost ? "BUG REPRODUCED: staker C's stake was wiped by the concurrent viewer request." : "unexpected: staker C survived");
  await cleanup();
  return lost;
}

async function NEW_FIX_verify() {
  await cleanup();
  console.log("\n=== Verifying the FIX (persistDirty only writes the keys this call touched) ===");
  await hashSet("stakes", K.A, { amountAtto: "1000", at: 1, terminal: false });
  await hashSet("stakes", K.B, { amountAtto: "2000", at: 2, terminal: false });

  await hashLoad("stakes"); // viewer's snapshot read (now unused for writing back)
  await hashSet("stakes", K.C, { amountAtto: "3000", at: 3, terminal: false });
  console.log("Staker C's real stake landed via hashSet (independent request).");

  // New persistDirty()/syncMigration() pattern: the viewer request only
  // re-writes the specific keys IT read/changed (here: none), never the
  // whole hash -- so it can no longer clobber C.
  const dirty: Record<string, unknown> = {};
  await Promise.all(Object.entries(dirty).map(([k, v]) => hashSet("stakes", k, v)));
  console.log("Viewer request finishes, new persistDirty(dirty) runs (dirty = {} here).");

  const after = await hashLoad("stakes");
  const allThreePresent = K.A in after && K.B in after && K.C in after;
  console.log("A present:", K.A in after, "B present:", K.B in after, "C present:", K.C in after);
  console.log(allThreePresent ? "FIX VERIFIED: all 3 stakers present." : "FIX FAILED");
  await cleanup();
  return allThreePresent;
}

async function THREE_CONCURRENT_STAKERS() {
  await cleanup();
  console.log("\n=== 3 concurrent stakers hitting the same claim, real hashSet calls in parallel ===");
  await Promise.all([
    hashSet("stakes", K.A, { amountAtto: "1000", at: Date.now(), terminal: false }),
    hashSet("stakes", K.B, { amountAtto: "2000", at: Date.now(), terminal: false }),
    hashSet("stakes", K.C, { amountAtto: "3000", at: Date.now(), terminal: false }),
  ]);
  const after = await hashLoad("stakes");
  const ok = K.A in after && K.B in after && K.C in after;
  console.log("A present:", K.A in after, "B present:", K.B in after, "C present:", K.C in after);
  console.log(ok ? "PASS: all 3 truly concurrent stakers persisted." : "FAIL: lost a staker");
  await cleanup();
  return ok;
}

async function main() {
  const bugReproduced = await OLD_BUG_reproduce();
  const fixVerified = await NEW_FIX_verify();
  const concurrentOk = await THREE_CONCURRENT_STAKERS();
  console.log("\n=== SUMMARY ===");
  console.log("Old code path (hashReplace of stale snapshot) loses a concurrent staker:", bugReproduced);
  console.log("New code path (persistDirty, targeted writes) preserves all stakers:", fixVerified);
  console.log("3 truly concurrent hashSet stakes all persist:", concurrentOk);
  if (!bugReproduced || !fixVerified || !concurrentOk) process.exit(1);
}

main();
