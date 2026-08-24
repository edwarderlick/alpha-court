/**
 * Real adversarial proof, one layer up from verify-keeper-ignores-cache.mjs:
 * the last fix made the STAKER LIST come from the chain
 * (get_stakers_for_claim), but state/consensus_result/pool totals were
 * still read from the Redis book -- the same class of bug. Fixed by
 * replacing bookGet(claimId) with a real readClaimRaw("get_claim", ...)
 * inside creditResolvedWinners/creditRefundedStakers.
 *
 * Ran for real against the live court (0xF9Df5e7b...):
 *
 *   1. Book LIES scenario -- a real claim, guaranteed BROKEN on-chain
 *      (impossible threshold), real winner is wallet B (against, 2 GEN
 *      staked, owed 3 GEN). Local book cooked to say consensus_result:
 *      "HELD" and stake_for_total: "999" (the book's fake winner would
 *      be wallet C, the FOR side). Real creditResolvedWinners call sent
 *      exactly 3 GEN to wallet B (real balance 31.0 -> 34.0 GEN) and
 *      nothing at all to wallet C (book's fake winner, balance
 *      unchanged at 5.0 GEN) -- the real payout followed the chain in
 *      both side and amount, ignoring the cooked book entirely.
 *
 *   2. Zero book presence -- a separate real claim, RESOLVED HELD on
 *      real chain, with NO row in the local book at all (confirmed
 *      absent, not deleted). creditResolvedWinners still correctly
 *      identified the real state/outcome and paid the real 2 GEN stake
 *      in full: real balance 3.0 -> 5.0 GEN.
 *
 * Full transcript and real transaction hashes are in this session's
 * conversation history and _verify/payout-audit/live-cycle-v4c.json /
 * live-cycle-v4d.json. This file documents the reusable methodology
 * rather than being safe to re-run casually -- it spends real GEN and
 * requires a real RESOLVED claim id that hasn't been credited yet.
 */
import { readFileSync, existsSync, copyFileSync } from "fs";
import { join } from "path";

const CLAIM_ID = process.argv[2];
const WALLET = process.argv[3];
if (!CLAIM_ID || !WALLET) {
  console.error("usage: node verify-keeper-ignores-book.mjs <claimId> <realWinnerWalletAddress>");
  console.error("  claimId must already be a real RESOLVED claim on the live court, not yet credited.");
  console.error("  To reproduce the book-lies scenario, first cook .data/claims-book.json with a");
  console.error("  wrong consensus_result/stake_*_total row for this claim, then run this script.");
  process.exit(1);
}

const envText = readFileSync(".env.local", "utf8");
for (const line of envText.split("\n")) {
  const m = line.match(/^([A-Z_0-9]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}

const { createClient, chains } = await import("genlayer-js");
const client = createClient({ chain: chains.studionet, endpoint: "https://studio.genlayer.com/api" });

const before = await client.getBalance({ address: WALLET });
console.log(`${WALLET} real balance BEFORE:`, before.toString());

const cacheFile = join(process.cwd(), ".data", "claims-book.json");
if (existsSync(cacheFile)) copyFileSync(cacheFile, cacheFile + ".bak");

const { creditResolvedWinners } = await import("../lib/genlayer/keeper-credits.ts");
const result = await creditResolvedWinners(CLAIM_ID, "");
console.log("creditResolvedWinners result:", JSON.stringify(result, (_, v) => (typeof v === "bigint" ? v.toString() : v), 2));

const after = await client.getBalance({ address: WALLET });
console.log(`${WALLET} real balance AFTER:`, after.toString());
console.log("real delta (GEN):", Number(after - before) / 1e18);
