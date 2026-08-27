/**
 * Continuation: claim #1 on v7 is already RESOLVED/paid with a real 2 GEN
 * credit. Prove retry_payout from poster/keeper is also rejected and GEN
 * does not move again.
 */
import { createAccount, createClient, chains } from "genlayer-js";
import { readFileSync, writeFileSync } from "fs";
import { join } from "path";

const dir = join(process.cwd(), "_verify", "payout-audit");
const out = JSON.parse(readFileSync(join(dir, "live-cycle-v7.json"), "utf8"));
const CONTRACT = out.contract;
const claimId = out.claimId;

const env = readFileSync(join(process.cwd(), ".env.local"), "utf8");
const keyA = (env.match(/^ALPHA_COURT_SIGNER_PRIVATE_KEY=(.*)$/m) || [])[1].trim();
const keyB = JSON.parse(readFileSync(join(process.cwd(), "_verify", "predeploy", "wallet-b.json"), "utf8")).privateKey;
const accA = createAccount(keyA);
const accB = createAccount(keyB);
const clientA = createClient({ chain: chains.studionet, account: accA, endpoint: "https://studio.genlayer.com/api" });
const clientB = createClient({ chain: chains.studionet, account: accB, endpoint: "https://studio.genlayer.com/api" });

function save() {
  writeFileSync(join(dir, "live-cycle-v7.json"), JSON.stringify(out, (_, v) => (typeof v === "bigint" ? v.toString() : v), 2));
}
function execOf(receipt) {
  return receipt?.consensus_data?.leader_receipt?.[0]?.execution_result || receipt?.execution_result || null;
}
function stderrOf(receipt) {
  const lr = receipt?.consensus_data?.leader_receipt?.[0];
  return lr?.genvm_result?.stderr || lr?.stderr || receipt?.stderr || "";
}
function stdoutOf(receipt) {
  const lr = receipt?.consensus_data?.leader_receipt?.[0];
  return lr?.genvm_result?.stdout || lr?.execution_result || "";
}

async function rejectCall(client, account, label) {
  const hash = await client.writeContract({
    address: CONTRACT,
    functionName: "retry_payout",
    args: [claimId],
    value: 0n,
    account,
  });
  const receipt = await client.waitForTransactionReceipt({ hash, retries: 100, interval: 3000 });
  const exec = execOf(receipt);
  const stderr = String(stderrOf(receipt));
  const stdout = String(stdoutOf(receipt)).slice(0, 500);
  const leader = receipt?.consensus_data?.leader_receipt?.[0] || null;
  out[label] = {
    hash,
    status: receipt.status,
    exec,
    stderr: stderr.slice(0, 800),
    stdout,
    result: leader?.result || leader?.genvm_result?.result || null,
    execution_result: leader?.execution_result || null,
  };
  save();
  console.log(label, hash, "status", receipt.status, "exec", exec);
  if (String(exec).toUpperCase() === "SUCCESS") {
    throw new Error(label + " was supposed to be rejected");
  }
  return receipt;
}

const balBefore = await clientB.getBalance({ address: accB.address });
out.balanceBBeforeSecondRetry = balBefore.toString();
save();
console.log("B before second retry", balBefore.toString());

if (!out.retryPayoutStranger || out.retryPayoutStranger.exec !== "ERROR") {
  console.log("re-check stranger retry");
  await rejectCall(clientB, accB, "retryPayoutStranger");
} else {
  console.log("stranger retry already ERROR", out.retryPayoutStranger.hash);
}

console.log("poster/keeper retry_payout");
await rejectCall(clientA, accA, "retryPayoutSecond");

const balAfter = await clientB.getBalance({ address: accB.address });
out.balanceBAfterRetry = balAfter.toString();
out.balanceBDeltaFromRetry = (balAfter - balBefore).toString();
save();
console.log("B after retry", balAfter.toString(), "delta", out.balanceBDeltaFromRetry);
if (balAfter !== balBefore) {
  throw new Error("retry_payout moved GEN: " + out.balanceBDeltaFromRetry);
}

const claim = await clientA.readContract({ address: CONTRACT, functionName: "get_claim", args: [claimId] });
out.claimAfterRetry = {
  state: claim.state,
  consensus_result: claim.consensus_result,
  paid: claim.paid,
};
save();
if (claim.paid !== true) throw new Error("paid flag cleared");
if (claim.state !== "RESOLVED") throw new Error("state changed");

out.finishedAt = new Date().toISOString();
save();
console.log("LIVE_CYCLE_V7_RETRY_DONE");
