/**
 * Custody-free cycle driven by the LIVE production URL.
 * Contract + treasury are read from https://alpha-court.vercel.app/api/keeper/tick
 * (not from local env). Writes go to Studio the same way a visitor wallet
 * does; each step is then observed via the production API.
 */
import { createAccount, createClient, chains } from "genlayer-js";
import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";

const PROD = "https://alpha-court.vercel.app";
const env = readFileSync(join(process.cwd(), ".env.local"), "utf8");
const keyA = (env.match(/^ALPHA_COURT_SIGNER_PRIVATE_KEY=(.*)$/m) || [])[1].trim();
const keyB = JSON.parse(readFileSync(join(process.cwd(), "_verify", "predeploy", "wallet-b.json"), "utf8")).privateKey;

const accA = createAccount(keyA);
const accB = createAccount(keyB);
const clientA = createClient({ chain: chains.studionet, account: accA, endpoint: "https://studio.genlayer.com/api" });
const clientB = createClient({ chain: chains.studionet, account: accB, endpoint: "https://studio.genlayer.com/api" });

const out = { startedAt: new Date().toISOString() };
const dir = join(process.cwd(), "_verify", "payout-audit");
mkdirSync(dir, { recursive: true });
function save() {
  writeFileSync(join(dir, "prod-live-cycle.json"), JSON.stringify(out, (_, v) => (typeof v === "bigint" ? v.toString() : v), 2));
}

async function prodGet(path) {
  const res = await fetch(PROD + path, { cache: "no-store", headers: { "cache-control": "no-cache" } });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* empty 500s */ }
  return { status: res.status, date: res.headers.get("date"), json, text: text.slice(0, 500) };
}

function execOf(receipt) {
  return receipt?.consensus_data?.leader_receipt?.[0]?.execution_result || null;
}

async function wait(client, hash, label) {
  const receipt = await client.waitForTransactionReceipt({ hash, retries: 80, interval: 3000 });
  out[label] = { hash, status: receipt.status, exec: execOf(receipt) };
  save();
  console.log(label, hash, "status", receipt.status, "exec", execOf(receipt));
  return receipt;
}

const tick = await prodGet("/api/keeper/tick?t=" + Date.now());
out.prodTick = tick;
console.log("production tick", tick.status, tick.date, tick.json);
if (!tick.json?.contract) throw new Error("production did not return a contract");
const CONTRACT = tick.json.contract;
const TREASURY = tick.json.treasury;
if (CONTRACT.toLowerCase() !== "0x219e753176d1157bc22376e10d06e4e21e401417") {
  throw new Error("production is not serving the new court: " + CONTRACT);
}
if (TREASURY.toLowerCase() !== "0x374d46e81973dd8797f14f586aee94aac27e39a3") {
  throw new Error("production treasury mismatch: " + TREASURY);
}

const deadline = new Date(Date.now() + 90_000).toISOString().replace(/\.\d+Z$/, ".000Z");
console.log("create_claim on production-served court", CONTRACT, "deadline", deadline);
const createHash = await clientA.writeContract({
  address: CONTRACT,
  functionName: "create_claim",
  args: ["ETH/USD", "999997", "above", deadline, ""],
  value: 0n,
  account: accA,
});
await wait(clientA, createHash, "create");
const ids = await clientA.readContract({ address: CONTRACT, functionName: "list_claims", args: [] });
const claimId = ids.slice(-1)[0];
out.claimId = claimId;
save();
console.log("claimId", claimId);

out.prodAfterCreate = await prodGet(`/api/claims/${claimId}?fresh=1`);
console.log("prod after create", out.prodAfterCreate.status, out.prodAfterCreate.json?.claim?.threshold || out.prodAfterCreate.text);

console.log("native 1 GEN B -> production treasury");
const sendHash = await clientB.sendTransaction({
  to: TREASURY,
  value: 1_000_000_000_000_000_000n,
  account: accB,
});
out.nativeSend = { hash: sendHash };
save();
for (let i = 0; i < 40; i++) {
  try {
    const tx = await clientB.getTransaction({ hash: sendHash });
    const st = tx?.status ?? tx?.status_name;
    console.log("native status", st);
    if (st === 7 || String(st).toUpperCase() === "FINALIZED") {
      out.nativeSend.status = st;
      break;
    }
  } catch (e) {
    console.log("native lag", i, e instanceof Error ? e.message : e);
  }
  await new Promise((r) => setTimeout(r, 3000));
}

const stakeHash = await clientB.writeContract({
  address: CONTRACT,
  functionName: "stake_against",
  args: [claimId, sendHash],
  value: 0n,
  account: accB,
});
await wait(clientB, stakeHash, "stakeAgainst");
const stakers = await clientA.readContract({ address: CONTRACT, functionName: "get_stakers_for_claim", args: [claimId] });
out.stakers = stakers;
save();
console.log("stakers", JSON.stringify(stakers, (_, v) => typeof v === "bigint" ? v.toString() : v));

out.prodAfterStake = await prodGet(`/api/claims/${claimId}?fresh=1`);
console.log("prod after stake", out.prodAfterStake.status, out.prodAfterStake.json?.claim?.stake_against_total || out.prodAfterStake.text);

const waitMs = new Date(deadline).getTime() - Date.now() + 5000;
if (waitMs > 0) {
  console.log("waiting", waitMs, "ms past deadline");
  await new Promise((r) => setTimeout(r, waitMs));
}

const lockHash = await clientA.writeContract({
  address: CONTRACT, functionName: "lock_deadline_evidence", args: [claimId], value: 0n, account: accA,
});
await wait(clientA, lockHash, "lock");
const resolveHash = await clientA.writeContract({
  address: CONTRACT, functionName: "resolve_verdict", args: [claimId], value: 0n, account: accA,
});
await wait(clientA, resolveHash, "resolve");
const claim = await clientA.readContract({ address: CONTRACT, functionName: "get_claim", args: [claimId] });
out.claim = claim;
save();
console.log("on-chain", claim.state, claim.consensus_result, "threshold", claim.threshold);

out.prodAfterResolve = await prodGet(`/api/claims/${claimId}?fresh=1`);
console.log("prod after resolve", out.prodAfterResolve.status, JSON.stringify(out.prodAfterResolve.json)?.slice(0, 400) || out.prodAfterResolve.text);

out.finishedAt = new Date().toISOString();
save();
console.log("PROD_LIVE_CYCLE_DONE claim", claimId);
