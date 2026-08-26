/**
 * Live non-custodial cycle on 0x219e7531…:
 *   1. create_claim with empty tx_hash (no posting stake, not payable)
 *   2. fabricated hash rejected
 *   3. real native send to treasury, then stake_against(tx_hash)
 *   4. same hash replayed — rejected
 *   5. wait past deadline, lock, resolve, keeper payout
 */
import { createAccount, createClient, chains } from "genlayer-js";
import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";

const CONTRACT = "0x219e753176D1157bC22376e10d06e4E21E401417";
const TREASURY = "0x374D46E81973dd8797f14f586AEE94AaC27e39A3";
const env = readFileSync(join(process.cwd(), ".env.local"), "utf8");
const keyA = (env.match(/^ALPHA_COURT_SIGNER_PRIVATE_KEY=(.*)$/m) || [])[1].trim();
const keyB = JSON.parse(readFileSync(join(process.cwd(), "_verify", "predeploy", "wallet-b.json"), "utf8")).privateKey;

const accA = createAccount(keyA);
const accB = createAccount(keyB);
const clientA = createClient({ chain: chains.studionet, account: accA, endpoint: "https://studio.genlayer.com/api" });
const clientB = createClient({ chain: chains.studionet, account: accB, endpoint: "https://studio.genlayer.com/api" });

const out = { contract: CONTRACT, treasury: TREASURY, walletA: accA.address, walletB: accB.address };
const dir = join(process.cwd(), "_verify", "payout-audit");
mkdirSync(dir, { recursive: true });
function save() {
  writeFileSync(join(dir, "live-cycle-v5.json"), JSON.stringify(out, (_, v) => (typeof v === "bigint" ? v.toString() : v), 2));
}

function execOf(receipt) {
  return receipt?.consensus_data?.leader_receipt?.[0]?.execution_result
    || receipt?.execution_result
    || null;
}
function stderrOf(receipt) {
  return receipt?.consensus_data?.leader_receipt?.[0]?.genvm_result?.stderr || "";
}

async function wait(client, hash, label) {
  const receipt = await client.waitForTransactionReceipt({ hash, retries: 80, interval: 3000 });
  const exec = execOf(receipt);
  out[label] = { hash, status: receipt.status, exec, stderr: String(stderrOf(receipt)).slice(0, 400) };
  save();
  console.log(label, hash, "status", receipt.status, "exec", exec);
  return receipt;
}

const treasuryOnChain = await clientA.readContract({ address: CONTRACT, functionName: "get_treasury", args: [] });
out.treasuryOnChain = treasuryOnChain;
console.log("on-chain treasury", treasuryOnChain);
if (String(treasuryOnChain).toLowerCase() !== TREASURY.toLowerCase()) {
  throw new Error("treasury mismatch");
}

const balBBefore = await clientB.getBalance({ address: accB.address });
out.balanceBBefore = balBBefore.toString();
console.log("wallet B before", balBBefore.toString());

const deadline = new Date(Date.now() + 90_000).toISOString().replace(/\.\d+Z$/, ".000Z");
console.log("create_claim ETH/USD above 999999 (guaranteed BROKEN), deadline", deadline);
const createHash = await clientA.writeContract({
  address: CONTRACT,
  functionName: "create_claim",
  args: ["ETH/USD", "999999", "above", deadline, ""],
  value: 0n,
  account: accA,
});
await wait(clientA, createHash, "create");
const claimId = (await clientA.readContract({ address: CONTRACT, functionName: "list_claims", args: [] })).slice(-1)[0];
out.claimId = claimId;
console.log("claimId", claimId);

console.log("adversarial: fabricated hash");
const fake = "0x" + "ab".repeat(32);
let fakeReverted = false;
try {
  const fakeHash = await clientB.writeContract({
    address: CONTRACT,
    functionName: "stake_against",
    args: [claimId, fake],
    value: 0n,
    account: accB,
  });
  const rec = await wait(clientB, fakeHash, "fabricated");
  const err = stderrOf(rec) + JSON.stringify(rec?.consensus_data?.leader_receipt?.[0]?.result || {});
  fakeReverted = /tx not found|not FINALIZED|does not match/i.test(err) || execOf(rec) !== "SUCCESS";
} catch (e) {
  fakeReverted = true;
  out.fabricated = { error: e instanceof Error ? e.message : String(e) };
}
out.fabricatedRejected = fakeReverted;
save();
console.log("fabricated rejected", fakeReverted);

console.log("native send 2 GEN B -> treasury");
const sendHash = await clientB.sendTransaction({
  to: TREASURY,
  value: 2_000_000_000_000_000_000n,
  account: accB,
});
out.nativeSend = { hash: sendHash };
save();
console.log("native send", sendHash);

let visible = false;
for (let i = 0; i < 40; i++) {
  try {
    const tx = await clientB.getTransaction({ hash: sendHash });
    const st = tx?.status ?? tx?.status_name;
    console.log("native status", st);
    if (st === 7 || st === "FINALIZED" || String(st).toUpperCase() === "FINALIZED") {
      visible = true;
      out.nativeSend.status = st;
      break;
    }
  } catch (e) {
    console.log("native not visible yet", i, e instanceof Error ? e.message : e);
  }
  await new Promise((r) => setTimeout(r, 3000));
}
if (!visible) throw new Error("native send never FINALIZED");
save();

console.log("register stake_against with real tx_hash");
const stakeHash = await clientB.writeContract({
  address: CONTRACT,
  functionName: "stake_against",
  args: [claimId, sendHash],
  value: 0n,
  account: accB,
});
const stakeRec = await wait(clientB, stakeHash, "stakeAgainst");
if (execOf(stakeRec) !== "SUCCESS") {
  throw new Error("real stake register failed: " + stderrOf(stakeRec));
}

const stakers = await clientA.readContract({
  address: CONTRACT,
  functionName: "get_stakers_for_claim",
  args: [claimId],
});
out.stakers = stakers;
console.log("stakers", JSON.stringify(stakers, (_, v) => typeof v === "bigint" ? v.toString() : v));

console.log("adversarial: replay same hash");
let replayRejected = false;
try {
  const replayHash = await clientB.writeContract({
    address: CONTRACT,
    functionName: "stake_against",
    args: [claimId, sendHash],
    value: 0n,
    account: accB,
  });
  const rec = await wait(clientB, replayHash, "replay");
  const err = stderrOf(rec);
  replayRejected = /already consumed/i.test(err) || execOf(rec) !== "SUCCESS";
} catch (e) {
  replayRejected = true;
  out.replay = { error: e instanceof Error ? e.message : String(e) };
}
out.replayRejected = replayRejected;
save();
console.log("replay rejected", replayRejected);

const spent = await clientA.readContract({ address: CONTRACT, functionName: "is_spent_tx", args: [sendHash] });
out.spent = spent;
console.log("is_spent_tx", spent);

console.log("waiting past deadline...");
const waitMs = new Date(deadline).getTime() - Date.now() + 5000;
if (waitMs > 0) await new Promise((r) => setTimeout(r, waitMs));

console.log("lock_deadline_evidence");
const lockHash = await clientA.writeContract({
  address: CONTRACT,
  functionName: "lock_deadline_evidence",
  args: [claimId],
  value: 0n,
  account: accA,
});
await wait(clientA, lockHash, "lock");

console.log("resolve_verdict");
const resolveHash = await clientA.writeContract({
  address: CONTRACT,
  functionName: "resolve_verdict",
  args: [claimId],
  value: 0n,
  account: accA,
});
await wait(clientA, resolveHash, "resolve");

const claim = await clientA.readContract({ address: CONTRACT, functionName: "get_claim", args: [claimId] });
out.claim = claim;
console.log("claim state", claim.state, "result", claim.consensus_result);

save();
console.log("LIVE_CYCLE_V5_DONE claim", claimId);
console.log("fabricatedRejected", fakeReverted, "replayRejected", replayRejected);
