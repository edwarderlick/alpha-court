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
  writeFileSync(join(dir, "live-cycle-v4.json"), JSON.stringify(out, (_, v) => (typeof v === "bigint" ? v.toString() : v), 2));
}

const deadline = new Date(Date.now() + 90_000).toISOString().replace(/\.\d+Z$/, ".000Z");
console.log("creating claim, deadline", deadline);
const createHash = await clientA.writeContract({
  address: CONTRACT,
  functionName: "create_claim",
  args: ["ETH/USD", "100", "above", deadline],
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

console.log("staking FOR from B (2 GEN)...");
const stakeForHash = await clientB.writeContract({
  address: CONTRACT,
  functionName: "stake_for",
  args: [claimId],
  value: 2_000_000_000_000_000_000n,
  account: accB,
});
const stakeForReceipt = await clientB.waitForTransactionReceipt({ hash: stakeForHash, retries: 80, interval: 3000 });
out.stakeFor = { hash: stakeForHash, exec: stakeForReceipt.consensus_data?.leader_receipt?.[0]?.execution_result };
console.log("stakeFor:", out.stakeFor);
save();

console.log("staking AGAINST from C (1 GEN)...");
const stakeAgainstHash = await clientC.writeContract({
  address: CONTRACT,
  functionName: "stake_against",
  args: [claimId],
  value: 1_000_000_000_000_000_000n,
  account: accC,
});
const stakeAgainstReceipt = await clientC.waitForTransactionReceipt({ hash: stakeAgainstHash, retries: 80, interval: 3000 });
out.stakeAgainst = { hash: stakeAgainstHash, exec: stakeAgainstReceipt.consensus_data?.leader_receipt?.[0]?.execution_result };
console.log("stakeAgainst:", out.stakeAgainst);
save();

// Real evidence for Part A's fix too: read the on-chain enumeration
// straight from the deployed contract before any lock/resolve happens.
const onChainStakers = await clientA.readContract({ address: CONTRACT, functionName: "get_stakers_for_claim", args: [claimId] });
out.onChainStakersBeforeLock = onChainStakers;
console.log("get_stakers_for_claim:", onChainStakers);
save();

const waitMs = new Date(deadline).getTime() - Date.now() + 5000;
console.log(`waiting ${waitMs}ms for deadline to actually pass...`);
await new Promise((r) => setTimeout(r, Math.max(0, waitMs)));

console.log("locking evidence...");
const lockHash = await clientA.writeContract({
  address: CONTRACT,
  functionName: "lock_deadline_evidence",
  args: [claimId],
  value: 0n,
  account: accA,
});
const lockReceipt = await clientA.waitForTransactionReceipt({ hash: lockHash, retries: 100, interval: 4000 });
out.lock = { hash: lockHash, exec: lockReceipt.consensus_data?.leader_receipt?.[0]?.execution_result };
console.log("lock:", out.lock);
save();

console.log("resolving verdict...");
const resolveHash = await clientA.writeContract({
  address: CONTRACT,
  functionName: "resolve_verdict",
  args: [claimId],
  value: 0n,
  account: accA,
});
const resolveReceipt = await clientA.waitForTransactionReceipt({ hash: resolveHash, retries: 100, interval: 4000 });
out.resolve = { hash: resolveHash, exec: resolveReceipt.consensus_data?.leader_receipt?.[0]?.execution_result };
console.log("resolve:", out.resolve);
save();

const claim = await clientA.readContract({ address: CONTRACT, functionName: "get_claim", args: [claimId] });
out.finalClaim = claim;
console.log("final claim state:", claim.state, claim.consensus_result);
console.log("verdict_text:", claim.verdict_text);
save();
