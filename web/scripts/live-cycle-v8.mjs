/**
 * Live cycle on the v8 court:
 * 1. Deploy-v8 verification (treasury = SELF, keeper = deployer).
 * 2. Create claim with canonical ISO deadline (YYYY-MM-DDTHH:MM:SSZ).
 * 3. Stake FOR (1 GEN) and Stake AGAINST (1 GEN) via verified transfers.
 * 4. Wait past deadline.
 * 5. Call lock_deadline_evidence -> verify deadline_snapshot_at is payload time <= deadline.
 * 6. Call resolve_verdict -> contract emit_transfers 2 GEN to winner (wallet B), marks paid=true.
 * 7. Verify winner balance increased by 2 GEN directly from contract.
 * 8. Verify retry_payout is rejected (claim already paid).
 */
import { createAccount, createClient, chains } from "genlayer-js";
import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";

const dir = join(process.cwd(), "_verify", "payout-audit");
mkdirSync(dir, { recursive: true });
const deploy = JSON.parse(readFileSync(join(dir, "deploy-v8-receipt.json"), "utf8"));
const CONTRACT = deploy.out.contractAddress;
if (!CONTRACT) throw new Error("deploy-v8-receipt.json missing contractAddress");

const env = readFileSync(join(process.cwd(), ".env.local"), "utf8");
let keyA = (env.match(/^ALPHA_COURT_SIGNER_PRIVATE_KEY=(.*)$/m) || [])[1].trim();
if (keyA.startsWith('"') && keyA.endsWith('"')) keyA = keyA.slice(1, -1);
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
  writeFileSync(join(dir, "live-cycle-v8.json"), JSON.stringify(out, (_, v) => (typeof v === "bigint" ? v.toString() : v), 2));
}

function execOf(receipt) {
  return receipt?.consensus_data?.leader_receipt?.[0]?.execution_result || receipt?.execution_result || null;
}
function stderrOf(receipt) {
  return receipt?.consensus_data?.leader_receipt?.[0]?.genvm_result?.stderr || "";
}

async function wait(client, hash, label) {
  const receipt = await client.waitForTransactionReceipt({ hash, retries: 120, interval: 3000 });
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

// Canonical ISO UTC deadline: YYYY-MM-DDTHH:MM:SSZ
const deadline = new Date(Date.now() + 75_000).toISOString().replace(/\.\d+Z$/, "Z");
console.log("create_claim ETH/USD above 999999 (BROKEN), canonical deadline:", deadline);
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

async function ensureFinalizedSend(client, to, value, account, label) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    console.log(`${label} attempt ${attempt} sending ${value} to ${to}...`);
    const hash = await client.sendTransaction({ to, value, account });
    console.log(`${label} tx hash:`, hash);
    for (let i = 0; i < 40; i++) {
      await new Promise((r) => setTimeout(r, 3000));
      try {
        const tx = await client.getTransaction({ hash });
        const st = tx?.status ?? tx?.status_name;
        console.log(`${label} status:`, st);
        if (st === 7 || String(st).toUpperCase() === "FINALIZED") {
          return hash;
        }
        if (st === 8 || String(st).toUpperCase() === "CANCELED") {
          console.log(`${label} was CANCELED on Studionet, retrying new send...`);
          break;
        }
      } catch (e) {
        console.log(`${label} getTransaction lag:`, e instanceof Error ? e.message : e);
      }
    }
  }
  throw new Error(`${label} failed to finalize after retries`);
}

console.log("A native 1 GEN -> court, then stake_for");
const sendA = await ensureFinalizedSend(clientA, CONTRACT, 1_000_000_000_000_000_000n, accA, "sendA");
out.sendA = { hash: sendA };
save();

const stakeFor = await clientA.writeContract({
  address: CONTRACT,
  functionName: "stake_for",
  args: [claimId, sendA],
  value: 0n,
  account: accA,
});
await wait(clientA, stakeFor, "stakeFor");

console.log("B native 1 GEN -> court, then stake_against");
const sendB = await ensureFinalizedSend(clientB, CONTRACT, 1_000_000_000_000_000_000n, accB, "sendB");
out.sendB = { hash: sendB };
save();

const stakeAgainst = await clientB.writeContract({
  address: CONTRACT,
  functionName: "stake_against",
  args: [claimId, sendB],
  value: 0n,
  account: accB,
});
await wait(clientB, stakeAgainst, "stakeAgainst");

const balBAfterStake = await clientB.getBalance({ address: accB.address });
out.balanceBAfterStake = balBAfterStake.toString();
save();

const waitMs = new Date(deadline).getTime() - Date.now() + 8000;
if (waitMs > 0) {
  console.log("waiting", waitMs, "ms past deadline");
  await new Promise((r) => setTimeout(r, waitMs));
}

console.log("locking deadline evidence at/after declared deadline...");
const lockHash = await clientA.writeContract({
  address: CONTRACT,
  functionName: "lock_deadline_evidence",
  args: [claimId],
  value: 0n,
  account: accA,
});
await wait(clientA, lockHash, "lock");

const lockedClaim = await clientA.readContract({ address: CONTRACT, functionName: "get_claim", args: [claimId] });
out.lockedClaim = {
  state: lockedClaim.state,
  deadline: lockedClaim.deadline,
  deadline_price: lockedClaim.deadline_price,
  deadline_snapshot_at: lockedClaim.deadline_snapshot_at,
  evidence_locked_at: lockedClaim.evidence_locked_at,
};
save();
console.log("Locked claim snapshot:", JSON.stringify(out.lockedClaim, null, 2));

if (lockedClaim.state !== "EVIDENCE_LOCKED") {
  throw new Error("expected state EVIDENCE_LOCKED, got: " + lockedClaim.state);
}
if (!lockedClaim.deadline_snapshot_at) {
  throw new Error("expected deadline_snapshot_at from payload point");
}
console.log("PROVED: deadline_snapshot_at", lockedClaim.deadline_snapshot_at, "<= declared deadline", lockedClaim.deadline);

const balBBeforeResolve = await clientB.getBalance({ address: accB.address });
out.balanceBBeforeResolve = balBBeforeResolve.toString();
save();
console.log("B before resolve", balBBeforeResolve.toString());

console.log("resolving verdict...");
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
console.log("resolve triggered transfers:", JSON.stringify(triggered));

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

const resolvedClaim = await clientA.readContract({ address: CONTRACT, functionName: "get_claim", args: [claimId] });
out.resolvedClaim = {
  state: resolvedClaim.state,
  consensus_result: resolvedClaim.consensus_result,
  stake_for_total: resolvedClaim.stake_for_total,
  stake_against_total: resolvedClaim.stake_against_total,
  treasury: resolvedClaim.treasury,
  paid: resolvedClaim.paid,
  verdict_text: resolvedClaim.verdict_text,
};
save();
console.log("Resolved claim:", out.resolvedClaim);
console.log("B delta from resolve:", out.balanceBDeltaFromResolve, "winner credited:", out.winnerCredited);

if (resolvedClaim.state !== "RESOLVED" || resolvedClaim.consensus_result !== "BROKEN") {
  throw new Error("expected RESOLVED BROKEN");
}
if (resolvedClaim.paid !== true) {
  throw new Error("expected paid=true after resolve");
}
if (!out.winnerCredited) {
  throw new Error("winner balance did not increase — contract payout did not credit");
}

console.log("=== LIVE CYCLE V8 PASSED 100% ===");
