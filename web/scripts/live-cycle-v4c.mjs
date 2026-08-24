import { createAccount, createClient, chains } from "genlayer-js";
import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";

const CONTRACT = "0xF9Df5e7b7E2119FC8186f7f21Dd37E075a4aCe85";
const env = readFileSync(join(process.cwd(), ".env.local"), "utf8");
const keyA = (env.match(/^ALPHA_COURT_SIGNER_PRIVATE_KEY=(.*)$/m) || [])[1].trim();
const keyB = JSON.parse(readFileSync(join(process.cwd(), "_verify", "predeploy", "wallet-b.json"), "utf8")).privateKey;
const keyC = JSON.parse(readFileSync(join(process.cwd(), "_verify", "predeploy", "wallet-c.json"), "utf8")).privateKey;

const accA = createAccount(keyA);
const accB = createAccount(keyB);
const accC = createAccount(keyC);
const clientA = createClient({ chain: chains.studionet, account: accA, endpoint: "https://studio.genlayer.com/api" });
const clientB = createClient({ chain: chains.studionet, account: accB, endpoint: "https://studio.genlayer.com/api" });
const clientC = createClient({ chain: chains.studionet, account: accC, endpoint: "https://studio.genlayer.com/api" });

const out = {};
const dir = join(process.cwd(), "_verify", "payout-audit");
mkdirSync(dir, { recursive: true });
function save() {
  writeFileSync(join(dir, "live-cycle-v4c.json"), JSON.stringify(out, (_, v) => (typeof v === "bigint" ? v.toString() : v), 2));
}

// Threshold deliberately impossible ("above 999999") -> guaranteed BROKEN,
// so "against" wins for real. Used to prove a book cooked to say HELD
// with a fake 999 GEN pool cannot flip the real payout's side or amount.
const deadline = new Date(Date.now() + 90_000).toISOString().replace(/\.\d+Z$/, ".000Z");
console.log("creating claim (guaranteed BROKEN), deadline", deadline);
const createHash = await clientA.writeContract({
  address: CONTRACT,
  functionName: "create_claim",
  args: ["ETH/USD", "999999", "above", deadline],
  value: 0n,
  account: accA,
});
const createReceipt = await clientA.waitForTransactionReceipt({ hash: createHash, retries: 80, interval: 3000 });
out.create = { hash: createHash, exec: createReceipt.consensus_data?.leader_receipt?.[0]?.execution_result };
console.log("create:", out.create);
save();

const claimId = (await clientA.readContract({ address: CONTRACT, functionName: "list_claims", args: [] })).slice(-1)[0];
out.claimId = claimId;
console.log("claimId:", claimId);

console.log("staking FOR from C (1 GEN, will lose)...");
const stakeForHash = await clientC.writeContract({
  address: CONTRACT, functionName: "stake_for", args: [claimId], value: 1_000_000_000_000_000_000n, account: accC,
});
await clientC.waitForTransactionReceipt({ hash: stakeForHash, retries: 80, interval: 3000 });
out.stakeFor = { hash: stakeForHash };
save();

console.log("staking AGAINST from B (2 GEN, will win)...");
const stakeAgainstHash = await clientB.writeContract({
  address: CONTRACT, functionName: "stake_against", args: [claimId], value: 2_000_000_000_000_000_000n, account: accB,
});
await clientB.waitForTransactionReceipt({ hash: stakeAgainstHash, retries: 80, interval: 3000 });
out.stakeAgainst = { hash: stakeAgainstHash };
save();

const waitMs = new Date(deadline).getTime() - Date.now() + 5000;
console.log(`waiting ${waitMs}ms for deadline to actually pass...`);
await new Promise((r) => setTimeout(r, Math.max(0, waitMs)));

console.log("locking evidence...");
const lockHash = await clientA.writeContract({
  address: CONTRACT, functionName: "lock_deadline_evidence", args: [claimId], value: 0n, account: accA,
});
await clientA.waitForTransactionReceipt({ hash: lockHash, retries: 100, interval: 4000 });
out.lock = { hash: lockHash };
save();

console.log("resolving verdict...");
const resolveHash = await clientA.writeContract({
  address: CONTRACT, functionName: "resolve_verdict", args: [claimId], value: 0n, account: accA,
});
await clientA.waitForTransactionReceipt({ hash: resolveHash, retries: 100, interval: 4000 });
out.resolve = { hash: resolveHash };
save();

const claim = await clientA.readContract({ address: CONTRACT, functionName: "get_claim", args: [claimId] });
out.finalClaim = claim;
console.log("final claim state:", claim.state, claim.consensus_result, "for=" + claim.stake_for_total, "against=" + claim.stake_against_total);
save();
