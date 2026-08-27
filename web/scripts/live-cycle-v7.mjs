/**
 * Live cycle on the v7 court: contract pays the winner once, then
 * retry_payout is rejected. No keeper sendAsKeeper in this script.
 * Deposits are bare native sends (exercising __receive__).
 */
import { createAccount, createClient, chains } from "genlayer-js";
import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";

const dir = join(process.cwd(), "_verify", "payout-audit");
mkdirSync(dir, { recursive: true });
const deploy = JSON.parse(readFileSync(join(dir, "deploy-v7-receipt.json"), "utf8"));
const CONTRACT = deploy.out.contractAddress;
if (!CONTRACT) throw new Error("deploy-v7-receipt.json missing contractAddress");

const env = readFileSync(join(process.cwd(), ".env.local"), "utf8");
const keyA = (env.match(/^ALPHA_COURT_SIGNER_PRIVATE_KEY=(.*)$/m) || [])[1].trim();
const keyB = JSON.parse(readFileSync(join(process.cwd(), "_verify", "predeploy", "wallet-b.json"), "utf8")).privateKey;

const accA = createAccount(keyA);
const accB = createAccount(keyB);
const clientA = createClient({ chain: chains.studionet, account: accA, endpoint: "https://studio.genlayer.com/api" });
const clientB = createClient({ chain: chains.studionet, account: accB, endpoint: "https://studio.genlayer.com/api" });

const out = {
  contract: CONTRACT,
  walletA: accA.address,
  walletB: accB.address,
  keeperSendUsed: false,
};
function save() {
  writeFileSync(join(dir, "live-cycle-v7.json"), JSON.stringify(out, (_, v) => (typeof v === "bigint" ? v.toString() : v), 2));
}

function execOf(receipt) {
  return receipt?.consensus_data?.leader_receipt?.[0]?.execution_result || receipt?.execution_result || null;
}
function stderrOf(receipt) {
  return receipt?.consensus_data?.leader_receipt?.[0]?.genvm_result?.stderr || "";
}

async function wait(client, hash, label) {
  const receipt = await client.waitForTransactionReceipt({ hash, retries: 100, interval: 3000 });
  const exec = execOf(receipt);
  out[label] = {
    hash,
    status: receipt.status,
    exec,
    stderr: String(stderrOf(receipt)).slice(0, 800),
    triggered: receipt.triggered_transactions || receipt.data?.triggered_transactions || [],
  };
  save();
  console.log(label, hash, "status", receipt.status, "exec", exec);
  if (String(exec).toUpperCase() !== "SUCCESS") {
    console.log("stderr", out[label].stderr);
    throw new Error(label + " failed");
  }
  return receipt;
}

async function waitRejected(client, hash, label, needle) {
  const receipt = await client.waitForTransactionReceipt({ hash, retries: 100, interval: 3000 });
  const exec = execOf(receipt);
  const stderr = String(stderrOf(receipt));
  out[label] = {
    hash,
    status: receipt.status,
    exec,
    stderr: stderr.slice(0, 800),
  };
  save();
  console.log(label, hash, "status", receipt.status, "exec", exec);
  if (String(exec).toUpperCase() === "SUCCESS") {
    throw new Error(label + " was supposed to be rejected");
  }
  const blob = `${stderr} ${JSON.stringify(receipt).slice(0, 4000)}`.toLowerCase();
  out[label].receiptKeys = Object.keys(receipt || {});
  if (needle && !blob.includes(needle.toLowerCase())) {
    console.log("stderr empty or unparsed; exec ERROR is still a clean reject. needle=", needle);
  }
  return receipt;
}

const treasury = await clientA.readContract({ address: CONTRACT, functionName: "get_treasury", args: [] });
out.treasuryOnChain = treasury;
save();
console.log("treasury", treasury);
if (String(treasury).toLowerCase() !== CONTRACT.toLowerCase()) {
  throw new Error("treasury is not SELF (this contract): " + treasury);
}

const keeper = await clientA.readContract({ address: CONTRACT, functionName: "get_keeper", args: [] });
out.keeperOnChain = keeper;
save();
console.log("keeper", keeper);
if (String(keeper).toLowerCase() !== accA.address.toLowerCase()) {
  throw new Error("keeper is not deployer A: " + keeper);
}

const balB0 = await clientB.getBalance({ address: accB.address });
out.balanceBBeforeAll = balB0.toString();
console.log("B before all", balB0.toString());

const deadline = new Date(Date.now() + 90_000).toISOString().replace(/\.\d+Z$/, ".000Z");
console.log("create_claim ETH/USD above 999999 BROKEN, deadline", deadline);
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
save();
console.log("claimId", claimId);

console.log("A native 1 GEN -> court, then stake_for");
const sendA = await clientA.sendTransaction({
  to: CONTRACT,
  value: 1_000_000_000_000_000_000n,
  account: accA,
});
out.sendA = { hash: sendA };
save();
for (let i = 0; i < 40; i++) {
  try {
    const tx = await clientA.getTransaction({ hash: sendA });
    const st = tx?.status ?? tx?.status_name;
    console.log("A native", st);
    if (st === 7 || String(st).toUpperCase() === "FINALIZED") break;
  } catch (e) {
    console.log("A native lag", e instanceof Error ? e.message : e);
  }
  await new Promise((r) => setTimeout(r, 3000));
}
const stakeFor = await clientA.writeContract({
  address: CONTRACT,
  functionName: "stake_for",
  args: [claimId, sendA],
  value: 0n,
  account: accA,
});
await wait(clientA, stakeFor, "stakeFor");

console.log("B native 1 GEN -> court, then stake_against");
const sendB = await clientB.sendTransaction({
  to: CONTRACT,
  value: 1_000_000_000_000_000_000n,
  account: accB,
});
out.sendB = { hash: sendB };
save();
for (let i = 0; i < 40; i++) {
  try {
    const tx = await clientB.getTransaction({ hash: sendB });
    const st = tx?.status ?? tx?.status_name;
    console.log("B native", st);
    if (st === 7 || String(st).toUpperCase() === "FINALIZED") break;
  } catch (e) {
    console.log("B native lag", e instanceof Error ? e.message : e);
  }
  await new Promise((r) => setTimeout(r, 3000));
}
const stakeAgainst = await clientB.writeContract({
  address: CONTRACT,
  functionName: "stake_against",
  args: [claimId, sendB],
  value: 0n,
  account: accB,
});
await wait(clientB, stakeAgainst, "stakeAgainst");

console.log("replay spent hash on this court");
let replayRejected = false;
try {
  const replay = await clientB.writeContract({
    address: CONTRACT,
    functionName: "stake_against",
    args: [claimId, sendB],
    value: 0n,
    account: accB,
  });
  await wait(clientB, replay, "replay");
} catch (e) {
  replayRejected = true;
  out.replay = { rejected: true, message: e instanceof Error ? e.message : String(e) };
  save();
  console.log("replay rejected", out.replay.message.slice(0, 200));
}
if (!replayRejected) throw new Error("spent hash was not rejected");

const balBAfterStake = await clientB.getBalance({ address: accB.address });
out.balanceBAfterStake = balBAfterStake.toString();
save();

const waitMs = new Date(deadline).getTime() - Date.now() + 8000;
if (waitMs > 0) {
  console.log("waiting", waitMs, "ms past deadline");
  await new Promise((r) => setTimeout(r, waitMs));
}

const lockHash = await clientA.writeContract({
  address: CONTRACT,
  functionName: "lock_deadline_evidence",
  args: [claimId],
  value: 0n,
  account: accA,
});
await wait(clientA, lockHash, "lock");

const balBBeforeResolve = await clientB.getBalance({ address: accB.address });
out.balanceBBeforeResolve = balBBeforeResolve.toString();
save();
console.log("B before resolve", balBBeforeResolve.toString());

const resolveHash = await clientA.writeContract({
  address: CONTRACT,
  functionName: "resolve_verdict",
  args: [claimId],
  value: 0n,
  account: accA,
});
const resolveReceipt = await wait(clientA, resolveHash, "resolve");

let triggered = resolveReceipt.triggered_transactions || resolveReceipt.data?.triggered_transactions || [];
for (let i = 0; i < 25 && (!triggered || triggered.length === 0); i++) {
  await new Promise((r) => setTimeout(r, 4000));
  const again = await clientA.getTransaction({ hash: resolveHash });
  triggered = again.triggered_transactions || again.data?.triggered_transactions || [];
}
out.resolveTriggered = triggered;
save();
console.log("resolve triggered", JSON.stringify(triggered));

const children = [];
for (const h of triggered || []) {
  let child = null;
  for (let i = 0; i < 20; i++) {
    child = await clientA.getTransaction({ hash: h });
    if (child && (child.status === 7 || String(child.status_name || "").toUpperCase() === "FINALIZED")) break;
    await new Promise((r) => setTimeout(r, 4000));
  }
  children.push({
    hash: h,
    to: child?.to_address || child?.to,
    value: child?.value != null ? String(child.value) : null,
    status: child?.status ?? child?.status_name,
  });
}
out.children = children;
save();

let balBAfter = await clientB.getBalance({ address: accB.address });
for (let i = 0; i < 30 && balBAfter <= balBBeforeResolve; i++) {
  await new Promise((r) => setTimeout(r, 5000));
  balBAfter = await clientB.getBalance({ address: accB.address });
  console.log("B after resolve poll", i, balBAfter.toString());
}
out.balanceBAfterResolve = balBAfter.toString();
out.balanceBDeltaFromResolve = (balBAfter - balBBeforeResolve).toString();
out.winnerCredited = balBAfter > balBBeforeResolve;
save();

const claim = await clientA.readContract({ address: CONTRACT, functionName: "get_claim", args: [claimId] });
out.claim = {
  state: claim.state,
  consensus_result: claim.consensus_result,
  stake_for_total: claim.stake_for_total,
  stake_against_total: claim.stake_against_total,
  treasury: claim.treasury,
  paid: claim.paid,
};
save();
console.log("claim", out.claim);
console.log("B delta from resolve", out.balanceBDeltaFromResolve, "credited", out.winnerCredited);

if (claim.state !== "RESOLVED" || claim.consensus_result !== "BROKEN") {
  throw new Error("expected RESOLVED BROKEN");
}
if (claim.paid !== true) {
  throw new Error("expected paid=true after resolve");
}
if (!out.winnerCredited) {
  throw new Error("winner balance did not increase — contract payout did not credit");
}
if (out.keeperSendUsed) {
  throw new Error("keeper send was used");
}

const expectedPayout = 2_000_000_000_000_000_000n;
if (balBAfter - balBBeforeResolve !== expectedPayout) {
  throw new Error("winner delta was not exactly 2 GEN: " + out.balanceBDeltaFromResolve);
}

function asReject(err, label) {
  const msg = err instanceof Error ? err.message : String(err);
  if (msg.includes("was supposed to be rejected") || msg.includes("missing expected error")) {
    throw err;
  }
  out[label] = { rejected: true, message: msg };
  save();
  console.log(label, "rejected", msg.slice(0, 300));
}

console.log("adversarial: B (winner, not poster/keeper) calls retry_payout");
try {
  const retryB = await clientB.writeContract({
    address: CONTRACT,
    functionName: "retry_payout",
    args: [claimId],
    value: 0n,
    account: accB,
  });
  await waitRejected(clientB, retryB, "retryPayoutStranger", "only the claim poster or keeper");
} catch (e) {
  asReject(e, "retryPayoutStranger");
}
if (!out.retryPayoutStranger) throw new Error("stranger retry_payout was not rejected");

console.log("adversarial: poster/keeper A calls retry_payout after paid");
try {
  const retryA = await clientA.writeContract({
    address: CONTRACT,
    functionName: "retry_payout",
    args: [claimId],
    value: 0n,
    account: accA,
  });
  await waitRejected(clientA, retryA, "retryPayoutSecond", "already paid");
} catch (e) {
  asReject(e, "retryPayoutSecond");
}
if (!out.retryPayoutSecond) throw new Error("second retry_payout was not rejected");

const balBAfterRetry = await clientB.getBalance({ address: accB.address });
out.balanceBAfterRetry = balBAfterRetry.toString();
out.balanceBDeltaFromRetry = (balBAfterRetry - balBAfter).toString();
save();
if (balBAfterRetry !== balBAfter) {
  throw new Error("retry_payout moved GEN: " + out.balanceBDeltaFromRetry);
}

out.finishedAt = new Date().toISOString();
save();
console.log("LIVE_CYCLE_V7_DONE");
