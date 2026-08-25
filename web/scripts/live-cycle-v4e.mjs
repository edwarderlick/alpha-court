/**
 * Real adversarial proof for "claim discovery must not depend on the book
 * knowing a claim exists": creates a real claim + real stake on the live
 * court, deliberately leaves ZERO book row for it (this script never calls
 * lock_deadline_evidence/resolve_verdict itself -- no keeper.ts code runs
 * locally), and stops. Discovery, locking, resolving, and paying the real
 * winner are all left entirely to the live GitHub Actions keeper running
 * the pushed loadClaims() fix, so the balance delta proves the real
 * end-to-end path, not a locally-simulated one.
 *
 * Ran for real against the live court (0xF9Df5e7b...): created claim id
 * printed below with a guaranteed BROKEN outcome (impossible threshold)
 * and a real 2 GEN stake from wallet B on the winning ("against") side.
 * Confirmed absent from the local book immediately after creation. Left
 * for the live keeper to discover purely via list_claims + get_claim.
 */
import { createAccount, createClient, chains } from "genlayer-js";
import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";

const CONTRACT = "0xF9Df5e7b7E2119FC8186f7f21Dd37E075a4aCe85";
const env = readFileSync(join(process.cwd(), ".env.local"), "utf8");
const keyA = (env.match(/^ALPHA_COURT_SIGNER_PRIVATE_KEY=(.*)$/m) || [])[1].trim();
const keyB = JSON.parse(readFileSync(join(process.cwd(), "_verify", "predeploy", "wallet-b.json"), "utf8")).privateKey;

const accA = createAccount(keyA);
const accB = createAccount(keyB);
const clientA = createClient({ chain: chains.studionet, account: accA, endpoint: "https://studio.genlayer.com/api" });
const clientB = createClient({ chain: chains.studionet, account: accB, endpoint: "https://studio.genlayer.com/api" });

const out = {};
const dir = join(process.cwd(), "_verify", "payout-audit");
mkdirSync(dir, { recursive: true });
function save() {
  writeFileSync(join(dir, "live-cycle-v4e.json"), JSON.stringify(out, (_, v) => (typeof v === "bigint" ? v.toString() : v), 2));
}

const before = await clientB.getBalance({ address: accB.address });
out.walletB = accB.address;
out.balanceBefore = before.toString();
console.log("wallet B real balance BEFORE:", before.toString());

const deadline = new Date(Date.now() + 60_000).toISOString().replace(/\.\d+Z$/, ".000Z");
console.log("creating claim (guaranteed BROKEN), deadline", deadline);
const createHash = await clientA.writeContract({
  address: CONTRACT, functionName: "create_claim", args: ["ETH/USD", "999999", "above", deadline], value: 0n, account: accA,
});
await clientA.waitForTransactionReceipt({ hash: createHash, retries: 80, interval: 3000 });
out.create = { hash: createHash };
save();

const claimId = (await clientA.readContract({ address: CONTRACT, functionName: "list_claims", args: [] })).slice(-1)[0];
out.claimId = claimId;
console.log("claimId:", claimId);

console.log("staking AGAINST from B (2 GEN, will win)...");
const stakeHash = await clientB.writeContract({
  address: CONTRACT, functionName: "stake_against", args: [claimId], value: 2_000_000_000_000_000_000n, account: accB,
});
await clientB.waitForTransactionReceipt({ hash: stakeHash, retries: 80, interval: 3000 });
out.stakeAgainst = { hash: stakeHash };
save();

console.log("done -- no lock/resolve here on purpose. Left for the live keeper to");
console.log("discover + process purely from chain enumeration (no book row exists).");
console.log("REAL_CLAIM_ID:", claimId, "REAL_WINNER_WALLET:", accB.address);
