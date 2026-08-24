/**
 * Real adversarial proof for the steward's Part A review finding:
 * "Derive or verify every keeper recipient and amount against contract
 * state instead of trusting the unauthenticated stake cache."
 *
 * Ran for real against the live court (0xF9Df5e7b...): a genuine claim,
 * a genuine stake, then two adversarial local-cache states before calling
 * the real creditResolvedWinners:
 *
 *   1. A FABRICATED/corrupted cache row (999 GEN instead of the real 2
 *      GEN staked) -- the real payout was exactly 3 GEN (2 GEN stake +
 *      1 GEN losing-pool share), computed from the real on-chain stake.
 *      Real balance: 30.0 -> 33.0 GEN. The fabricated 999 GEN row had no
 *      effect at all.
 *
 *   2. A completely MISSING cache row (no entry ever existed for that
 *      staker/claim, simulating a deleted row) -- the keeper still
 *      correctly identified the real staker via get_stakers_for_claim
 *      and paid them their real 3 GEN stake in full. Real balance:
 *      3.0 -> 6.0 GEN.
 *
 * Full transcript and real transaction hashes are in this session's
 * conversation history and _verify/payout-audit/live-cycle-v4*.json.
 * This file documents the reusable methodology (seed a claim + a
 * corrupted/absent cache row locally, call the real crediting function,
 * check real getBalance before/after) rather than being safe to re-run
 * casually -- it spends real GEN and requires a real RESOLVED claim id
 * that hasn't been credited yet. Adjust CLAIM_ID / WALLET / EXPECTED_GEN
 * to a fresh real claim before running again.
 */
import { readFileSync, writeFileSync, existsSync, copyFileSync } from "fs";
import { join } from "path";

const CLAIM_ID = process.argv[2];
const WALLET = process.argv[3];
if (!CLAIM_ID || !WALLET) {
  console.error("usage: node verify-keeper-ignores-cache.mjs <claimId> <walletAddress>");
  console.error("  claimId must already be a real RESOLVED claim on the live court, not yet credited.");
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

const dataDir = join(process.cwd(), ".data");
const cacheFile = join(dataDir, "stake-positions.json");
if (existsSync(cacheFile)) copyFileSync(cacheFile, cacheFile + ".bak");

const { creditResolvedWinners } = await import("../lib/genlayer/keeper-credits.ts");
const result = await creditResolvedWinners(CLAIM_ID, "");
console.log("creditResolvedWinners result:", JSON.stringify(result, (_, v) => (typeof v === "bigint" ? v.toString() : v), 2));

const after = await client.getBalance({ address: WALLET });
console.log(`${WALLET} real balance AFTER:`, after.toString());
console.log("real delta (GEN):", Number(after - before) / 1e18);

if (existsSync(cacheFile + ".bak")) {
  copyFileSync(cacheFile + ".bak", cacheFile);
  writeFileSync(cacheFile, readFileSync(cacheFile + ".bak"));
}
